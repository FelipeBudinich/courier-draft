import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { removeAwarenessStates } from 'y-protocols/awareness';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { logger } from '../../config/logger.js';
import { emitToNoteRoom } from '../realtime/broadcaster.js';
import { materializeTextFromNoteYDoc } from './yjs-note-adapter.js';
import { persistNoteSessionHead } from './note-session-persistence.js';

export const NOTE_PERSIST_DEBOUNCE_MS = 3_000;
export const NOTE_SAFETY_FLUSH_MS = 30_000;
export const NOTE_CLEAN_IDLE_TTL_MS = 15_000;
export const NOTE_PERSIST_RETRY_MS = 5_000;

const extractAwarenessClientIds = (payload) => {
  const decoder = decoding.createDecoder(payload);
  const length = decoding.readVarUint(decoder);
  const clientIds = [];

  for (let index = 0; index < length; index += 1) {
    clientIds.push(decoding.readVarUint(decoder));
    decoding.readVarUint(decoder);
    decoding.readVarString(decoder);
  }

  return clientIds;
};

const encodeReply = (encoder) =>
  encoding.hasContent(encoder) ? encoding.toUint8Array(encoder) : null;

export class NoteSession {
  constructor({
    note,
    onDispose,
    createYDoc
  }) {
    this.noteObjectId = note._id;
    this.notePublicId = note.publicId;
    this.currentMajorVersionId = note.currentMajorVersionId
      ? String(note.currentMajorVersionId)
      : null;
    this.latestMajorVersionId = this.currentMajorVersionId;
    this.ydoc = null;
    this.awareness = null;
    this.createYDoc = createYDoc;
    this.members = new Map();
    this.dirty = false;
    this.updateSequence = 0;
    this.lastEditor = null;
    this.lastPersistedAt = note.headUpdatedAt;
    this.lastPersistedRevision = note.headRevision ?? 0;
    this.lastPersistError = null;
    this.flushPromise = null;
    this.persistTimer = null;
    this.safetyTimer = null;
    this.cleanupTimer = null;
    this.retryTimer = null;
    this.onDispose = onDispose;
  }

  static create({
    note,
    text,
    onDispose,
    createYDoc
  }) {
    const session = new NoteSession({
      note,
      onDispose,
      createYDoc
    });

    session.ydoc = createYDoc(text);
    session.awareness = new awarenessProtocol.Awareness(session.ydoc);
    session.awareness.setLocalState(null);

    return session;
  }

  materializeText() {
    return materializeTextFromNoteYDoc(this.ydoc);
  }

  updateVersionState({ currentMajorVersionId = null } = {}) {
    this.currentMajorVersionId = currentMajorVersionId
      ? String(currentMajorVersionId)
      : null;
    this.latestMajorVersionId = this.currentMajorVersionId;
  }

  replaceText({
    text,
    currentMajorVersionId = null,
    headUpdatedAt = new Date(),
    headRevision = this.lastPersistedRevision
  }) {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.awareness?.destroy();
    this.ydoc?.destroy();

    this.ydoc = this.createYDoc(text);
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    this.awareness.setLocalState(null);
    this.members.forEach((member) => {
      member.awarenessClientIds.clear();
    });
    this.updateVersionState({
      currentMajorVersionId
    });
    this.dirty = false;
    this.lastPersistError = null;
    this.flushPromise = null;
    this.lastPersistedAt = headUpdatedAt;
    this.lastPersistedRevision = headRevision;
  }

  hasMembers() {
    return this.members.size > 0;
  }

  isLive() {
    return (
      this.hasMembers() ||
      this.dirty ||
      Boolean(this.lastPersistError) ||
      Boolean(this.flushPromise)
    );
  }

  addMember({ socketId, user, canEdit }) {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.members.set(socketId, {
      socketId,
      userId: user.publicId,
      actorId: user._id,
      canEdit,
      awarenessClientIds: new Set()
    });
  }

  getMember(socketId) {
    return this.members.get(socketId) ?? null;
  }

  buildSyncReply(payload, transactionOrigin) {
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();
    let sawStep1 = false;

    while (decoding.hasContent(decoder)) {
      const messageType = syncProtocol.readSyncMessage(
        decoder,
        encoder,
        this.ydoc,
        transactionOrigin,
        (error) => {
          throw error;
        }
      );

      if (messageType === syncProtocol.messageYjsSyncStep1) {
        sawStep1 = true;
      }
    }

    if (sawStep1) {
      syncProtocol.writeSyncStep1(encoder, this.ydoc);
    }

    return encodeReply(encoder);
  }

  applyTextUpdate(payload, { socketId, actor }) {
    Y.applyUpdate(this.ydoc, payload, {
      type: 'note:yjs-update',
      socketId
    });
    this.dirty = true;
    this.updateSequence += 1;
    this.lastEditor = {
      actorId: actor._id,
      userId: actor.publicId
    };
    this.lastPersistError = null;
    this.schedulePersist();
  }

  applyAwarenessUpdate(payload, { socketId }) {
    const member = this.getMember(socketId);
    if (!member) {
      return;
    }

    const clientIds = extractAwarenessClientIds(payload);
    clientIds.forEach((clientId) => {
      member.awarenessClientIds.add(clientId);
    });

    awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, {
      socketId
    });
  }

  removeMember(socketId) {
    const member = this.members.get(socketId);
    if (!member) {
      return null;
    }

    this.members.delete(socketId);

    if (!member.awarenessClientIds.size) {
      return null;
    }

    const awarenessClientIds = [...member.awarenessClientIds];
    removeAwarenessStates(this.awareness, awarenessClientIds, {
      socketId,
      type: 'note:leave'
    });

    return awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      awarenessClientIds
    );
  }

  schedulePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      void this.flush('debounced');
    }, NOTE_PERSIST_DEBOUNCE_MS);

    if (!this.safetyTimer) {
      this.safetyTimer = setTimeout(() => {
        void this.flush('safety');
      }, NOTE_SAFETY_FLUSH_MS);
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  scheduleCleanup() {
    if (
      this.cleanupTimer ||
      this.hasMembers() ||
      this.dirty ||
      this.lastPersistError ||
      this.flushPromise
    ) {
      return;
    }

    this.cleanupTimer = setTimeout(() => {
      if (this.hasMembers() || this.dirty || this.lastPersistError) {
        this.cleanupTimer = null;
        return;
      }

      this.destroy();
    }, NOTE_CLEAN_IDLE_TTL_MS);
  }

  scheduleRetry() {
    if (this.retryTimer) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush('retry');
    }, NOTE_PERSIST_RETRY_MS);
  }

  async flush(reason = 'manual') {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    if (!this.dirty || !this.lastEditor?.actorId) {
      if (!this.hasMembers()) {
        this.scheduleCleanup();
      }
      return null;
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }

    const sequenceAtFlush = this.updateSequence;
    const actorIdAtFlush = this.lastEditor.actorId;
    const text = this.materializeText();

    this.flushPromise = persistNoteSessionHead({
      noteObjectId: this.noteObjectId,
      actorId: actorIdAtFlush,
      text
    })
      .then((result) => {
        this.lastPersistError = null;
        this.lastPersistedAt = result.headUpdatedAt;
        this.lastPersistedRevision = result.headRevision;

        if (this.updateSequence === sequenceAtFlush) {
          this.dirty = false;
        } else {
          this.dirty = true;
          this.schedulePersist();
        }

        emitToNoteRoom(this.notePublicId, 'note:head-persisted', {
          noteId: this.notePublicId,
          persistedAt: result.headUpdatedAt,
          latestHeadRevision: result.headRevision
        });

        return result;
      })
      .catch((error) => {
        this.lastPersistError = error;
        this.dirty = true;
        logger.error(
          {
            noteId: this.notePublicId,
            reason,
            error
          },
          'Realtime note persistence failed.'
        );

        emitToNoteRoom(this.notePublicId, 'server:error', {
          noteId: this.notePublicId,
          code: 'PERSISTENCE_FAILED',
          message: 'Realtime note persistence failed. Changes remain live and will retry.'
        });

        this.scheduleRetry();
        throw error;
      })
      .finally(() => {
        this.flushPromise = null;

        if (!this.hasMembers()) {
          this.scheduleCleanup();
        }
      });

    return this.flushPromise;
  }

  async leave(socketId) {
    const awarenessRemoval = this.removeMember(socketId);

    if (!this.hasMembers()) {
      try {
        await this.flush('last-disconnect');
      } catch {
        // Session retries until persistence succeeds.
      }

      this.scheduleCleanup();
    }

    return awarenessRemoval;
  }

  destroy() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
    }

    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.members.clear();
    this.awareness?.destroy();
    this.ydoc?.destroy();
    this.onDispose?.(this.notePublicId);
  }
}

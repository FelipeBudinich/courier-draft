import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { getSceneXmlFragment } from '../../../src/services/collab/yjs-scene-adapter.js';

const COLLABORATOR_COLORS = [
  '#D9485F',
  '#1E6B52',
  '#2A6F97',
  '#C97C10',
  '#7353BA',
  '#A03E99',
  '#00798C',
  '#8A5A44'
];

const emitWithAck = (socket, eventName, payload) =>
  new Promise((resolve, reject) => {
    socket.emit(eventName, payload, (ack) => {
      if (ack?.ok) {
        resolve(ack.data);
        return;
      }

      const error = new Error(
        ack?.error?.message ?? `Socket event ${eventName} failed.`
      );
      error.code = ack?.error?.code ?? 'SERVER_ERROR';
      error.details = ack?.error?.details ?? null;
      reject(error);
    });
  });

const toUint8Array = (payload) => {
  if (payload instanceof Uint8Array) {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  return new Uint8Array(payload);
};

const hashString = (value) =>
  [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0);

const buildAwarenessUser = (currentUser, canEdit) => ({
  id: currentUser.id,
  name: currentUser.displayName ?? currentUser.username ?? currentUser.id,
  color: COLLABORATOR_COLORS[hashString(currentUser.id) % COLLABORATOR_COLORS.length],
  mode: canEdit ? 'editing' : 'viewing'
});

const createSyncStep1 = (ydoc) => {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return encoding.toUint8Array(encoder);
};

export class SceneRealtimeProvider {
  constructor({
    socket,
    projectId,
    scriptId,
    sceneId,
    currentUser,
    canEdit,
    onLocalChange,
    onPersisted,
    onPersistenceError,
    onServerError
  }) {
    this.socket = socket;
    this.projectId = projectId;
    this.scriptId = scriptId;
    this.sceneId = sceneId;
    this.currentUser = currentUser;
    this.canEdit = canEdit;
    this.onLocalChange = onLocalChange;
    this.onPersisted = onPersisted;
    this.onPersistenceError = onPersistenceError;
    this.onServerError = onServerError;
    this.ydoc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    this.awareness.setLocalState(null);
    this.xmlFragment = getSceneXmlFragment(this.ydoc);
    this.remoteOrigin = Symbol(`scene:${sceneId}:remote`);
    this.remoteAwarenessOrigin = Symbol(`scene:${sceneId}:awareness`);
    this.syncResolved = false;
    this.syncTimeoutId = null;
    this.disposed = false;
    this.boundListeners = null;
    this.documentUpdateHandler = this.handleDocumentUpdate.bind(this);
    this.awarenessUpdateHandler = this.handleAwarenessUpdate.bind(this);
    this.ydoc.on('update', this.documentUpdateHandler);
    this.awareness.on('update', this.awarenessUpdateHandler);
  }

  getXmlFragment() {
    return this.xmlFragment;
  }

  async connect() {
    this.boundListeners = {
      sync: (payload) => this.handleSyncEvent(payload),
      update: (payload) => this.handleRemoteUpdate(payload),
      awareness: (payload) => this.handleRemoteAwareness(payload),
      persisted: (payload) => this.handlePersisted(payload),
      serverError: (payload) => this.handleServerError(payload)
    };

    this.socket.on('scene:yjs-sync', this.boundListeners.sync);
    this.socket.on('scene:yjs-update', this.boundListeners.update);
    this.socket.on('scene:yjs-awareness', this.boundListeners.awareness);
    this.socket.on('scene:head-persisted', this.boundListeners.persisted);
    this.socket.on('server:error', this.boundListeners.serverError);

    const joinData = await emitWithAck(this.socket, 'scene:join', {
      projectId: this.projectId,
      scriptId: this.scriptId,
      sceneId: this.sceneId
    });

    this.canEdit = joinData.canEdit;
    this.awareness.setLocalState({
      user: buildAwarenessUser(this.currentUser, this.canEdit),
      mode: this.canEdit ? 'editing' : 'viewing',
      cursor: null
    });

    this.syncPromise = new Promise((resolve, reject) => {
      this.resolveSync = resolve;
      this.rejectSync = reject;
      this.syncTimeoutId = window.setTimeout(() => {
        reject(new Error('Timed out while syncing realtime scene state.'));
      }, 5_000);
    });

    this.socket.emit('scene:yjs-sync', {
      sceneId: this.sceneId,
      payload: createSyncStep1(this.ydoc)
    });

    await this.syncPromise;

    return joinData;
  }

  processSyncPayload(payload) {
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();

    while (decoding.hasContent(decoder)) {
      syncProtocol.readSyncMessage(
        decoder,
        encoder,
        this.ydoc,
        this.remoteOrigin,
        (error) => {
          throw error;
        }
      );
    }

    if (encoding.hasContent(encoder)) {
      this.socket.emit('scene:yjs-sync', {
        sceneId: this.sceneId,
        payload: encoding.toUint8Array(encoder)
      });
    }
  }

  handleSyncEvent({ sceneId, payload }) {
    if (this.disposed || sceneId !== this.sceneId) {
      return;
    }

    try {
      this.processSyncPayload(toUint8Array(payload));

      if (!this.syncResolved) {
        this.syncResolved = true;
        window.clearTimeout(this.syncTimeoutId);
        this.resolveSync?.();
      }
    } catch (error) {
      this.rejectSync?.(error);
      this.onServerError?.(error.message);
    }
  }

  handleRemoteUpdate({ sceneId, payload }) {
    if (this.disposed || sceneId !== this.sceneId) {
      return;
    }

    try {
      Y.applyUpdate(this.ydoc, toUint8Array(payload), this.remoteOrigin);
    } catch {
      this.onServerError?.('Remote scene update could not be applied.');
    }
  }

  handleRemoteAwareness({ sceneId, payload }) {
    if (this.disposed || sceneId !== this.sceneId) {
      return;
    }

    try {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        toUint8Array(payload),
        this.remoteAwarenessOrigin
      );
    } catch {
      this.onServerError?.('Remote awareness update could not be applied.');
    }
  }

  handlePersisted({ sceneId, persistedAt }) {
    if (this.disposed || sceneId !== this.sceneId) {
      return;
    }

    this.onPersisted?.(persistedAt);
  }

  handleServerError(payload) {
    if (this.disposed) {
      return;
    }

    if (payload?.sceneId && payload.sceneId !== this.sceneId) {
      return;
    }

    if (payload?.code === 'PERSISTENCE_FAILED') {
      this.onPersistenceError?.(payload.message);
      return;
    }

    this.onServerError?.(payload?.message ?? 'Realtime collaboration failed.');
  }

  handleDocumentUpdate(update, origin) {
    if (this.disposed || origin === this.remoteOrigin) {
      return;
    }

    this.onLocalChange?.();

    this.socket.emit(
      'scene:yjs-update',
      {
        sceneId: this.sceneId,
        payload: update
      },
      (ack) => {
        if (!ack?.ok) {
          this.onServerError?.(
            ack?.error?.message ?? 'Scene update could not be sent.'
          );
        }
      }
    );
  }

  handleAwarenessUpdate({ added, updated, removed }, origin) {
    if (this.disposed || origin === this.remoteAwarenessOrigin) {
      return;
    }

    const changedClients = [...added, ...updated, ...removed];

    if (!changedClients.length) {
      return;
    }

    this.socket.emit(
      'scene:yjs-awareness',
      {
        sceneId: this.sceneId,
        payload: awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          changedClients
        )
      },
      (ack) => {
        if (!ack?.ok) {
          this.onServerError?.(
            ack?.error?.message ?? 'Scene awareness could not be sent.'
          );
        }
      }
    );
  }

  async dispose({ leaveScene = true } = {}) {
    if (this.disposed) {
      return;
    }

    if (this.syncTimeoutId) {
      window.clearTimeout(this.syncTimeoutId);
    }

    if (leaveScene) {
      this.awareness.setLocalState(null);

      try {
        await emitWithAck(this.socket, 'scene:leave', {
          sceneId: this.sceneId
        });
      } catch {
        // Best-effort leave; disconnect cleanup on the server covers the rest.
      }
    }

    this.disposed = true;

    if (this.boundListeners) {
      this.socket.off('scene:yjs-sync', this.boundListeners.sync);
      this.socket.off('scene:yjs-update', this.boundListeners.update);
      this.socket.off('scene:yjs-awareness', this.boundListeners.awareness);
      this.socket.off('scene:head-persisted', this.boundListeners.persisted);
      this.socket.off('server:error', this.boundListeners.serverError);
    }

    this.ydoc.off('update', this.documentUpdateHandler);
    this.awareness.off('update', this.awarenessUpdateHandler);
    this.awareness.destroy();
    this.ydoc.destroy();
  }
}

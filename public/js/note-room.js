import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

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

const createSyncStep1 = (ydoc) => {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return encoding.toUint8Array(encoder);
};

export class NoteRealtimeProvider {
  constructor({
    socket,
    projectId,
    noteId,
    currentUser,
    canEdit,
    onPersisted,
    onServerError
  }) {
    this.socket = socket;
    this.projectId = projectId;
    this.noteId = noteId;
    this.currentUser = currentUser;
    this.canEdit = canEdit;
    this.onPersisted = onPersisted;
    this.onServerError = onServerError;
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('content');
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    this.awareness.setLocalState(null);
    this.remoteOrigin = Symbol(`note:${noteId}:remote`);
    this.remoteAwarenessOrigin = Symbol(`note:${noteId}:awareness`);
    this.syncResolved = false;
    this.syncTimeoutId = null;
    this.disposed = false;
    this.textarea = null;
    this.boundListeners = null;
    this.boundInputHandler = null;
    this.boundFocusHandler = null;
    this.boundBlurHandler = null;
    this.documentUpdateHandler = this.handleDocumentUpdate.bind(this);
    this.awarenessUpdateHandler = this.handleAwarenessUpdate.bind(this);
    this.ydoc.on('update', this.documentUpdateHandler);
    this.awareness.on('update', this.awarenessUpdateHandler);
    this.textObserver = () => {
      this.syncTextareaValue();
    };
    this.ytext.observe(this.textObserver);
  }

  async connect() {
    this.boundListeners = {
      sync: (payload) => this.handleSyncEvent(payload),
      update: (payload) => this.handleRemoteUpdate(payload),
      awareness: (payload) => this.handleRemoteAwareness(payload),
      persisted: (payload) => this.handlePersisted(payload),
      serverError: (payload) => this.handleServerError(payload)
    };

    this.socket.on('note:yjs-sync', this.boundListeners.sync);
    this.socket.on('note:yjs-update', this.boundListeners.update);
    this.socket.on('note:yjs-awareness', this.boundListeners.awareness);
    this.socket.on('note:head-persisted', this.boundListeners.persisted);
    this.socket.on('server:error', this.boundListeners.serverError);

    const joinData = await emitWithAck(this.socket, 'note:join', {
      projectId: this.projectId,
      noteId: this.noteId
    });

    this.canEdit = joinData.canEdit;
    this.awareness.setLocalState({
      user: {
        id: this.currentUser.id,
        name: this.currentUser.displayName ?? this.currentUser.id
      },
      mode: this.canEdit ? 'editing' : 'viewing'
    });

    this.syncPromise = new Promise((resolve, reject) => {
      this.resolveSync = resolve;
      this.rejectSync = reject;
      this.syncTimeoutId = window.setTimeout(() => {
        reject(new Error('Timed out while syncing realtime note state.'));
      }, 5_000);
    });

    this.socket.emit('note:yjs-sync', {
      noteId: this.noteId,
      payload: createSyncStep1(this.ydoc)
    });

    await this.syncPromise;
    this.syncTextareaValue();
    return joinData;
  }

  bindTextarea(textarea) {
    this.textarea = textarea;
    this.textarea.readOnly = !this.canEdit;
    this.syncTextareaValue();

    this.boundInputHandler = () => {
      if (!this.canEdit) {
        return;
      }

      const nextValue = this.textarea.value;
      const previousValue = this.ytext.toString();

      if (nextValue === previousValue) {
        return;
      }

      this.ydoc.transact(() => {
        if (previousValue.length) {
          this.ytext.delete(0, previousValue.length);
        }

        if (nextValue.length) {
          this.ytext.insert(0, nextValue);
        }
      });
    };
    this.boundFocusHandler = () => {
      this.setAwarenessMode(this.canEdit ? 'editing' : 'viewing');
    };
    this.boundBlurHandler = () => {
      this.setAwarenessMode('viewing');
    };

    textarea.addEventListener('input', this.boundInputHandler);
    textarea.addEventListener('focus', this.boundFocusHandler);
    textarea.addEventListener('blur', this.boundBlurHandler);
  }

  syncTextareaValue() {
    if (!this.textarea) {
      return;
    }

    const nextValue = this.ytext.toString();
    if (this.textarea.value === nextValue) {
      return;
    }

    const selectionStart = this.textarea.selectionStart ?? nextValue.length;
    const selectionEnd = this.textarea.selectionEnd ?? nextValue.length;
    this.textarea.value = nextValue;
    const clampedStart = Math.min(selectionStart, nextValue.length);
    const clampedEnd = Math.min(selectionEnd, nextValue.length);
    this.textarea.setSelectionRange(clampedStart, clampedEnd);
  }

  setAwarenessMode(mode) {
    const current = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({
      ...current,
      mode
    });
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
      this.socket.emit('note:yjs-sync', {
        noteId: this.noteId,
        payload: encoding.toUint8Array(encoder)
      });
    }
  }

  handleSyncEvent({ noteId, payload }) {
    if (this.disposed || noteId !== this.noteId) {
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

  handleRemoteUpdate({ noteId, payload }) {
    if (this.disposed || noteId !== this.noteId) {
      return;
    }

    try {
      Y.applyUpdate(this.ydoc, toUint8Array(payload), this.remoteOrigin);
    } catch {
      this.onServerError?.('Remote note update could not be applied.');
    }
  }

  handleRemoteAwareness({ noteId, payload }) {
    if (this.disposed || noteId !== this.noteId) {
      return;
    }

    try {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        toUint8Array(payload),
        this.remoteAwarenessOrigin
      );
    } catch {
      this.onServerError?.('Remote note awareness could not be applied.');
    }
  }

  handlePersisted({ noteId, persistedAt }) {
    if (this.disposed || noteId !== this.noteId) {
      return;
    }

    this.onPersisted?.(persistedAt);
  }

  handleServerError(payload) {
    if (this.disposed) {
      return;
    }

    if (payload?.noteId && payload.noteId !== this.noteId) {
      return;
    }

    this.onServerError?.(payload?.message ?? 'Realtime note collaboration failed.');
  }

  handleDocumentUpdate(update, origin) {
    if (this.disposed || origin === this.remoteOrigin) {
      return;
    }

    this.socket.emit(
      'note:yjs-update',
      {
        noteId: this.noteId,
        payload: update
      },
      (ack) => {
        if (!ack?.ok) {
          this.onServerError?.(
            ack?.error?.message ?? 'Note update could not be sent.'
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
      'note:yjs-awareness',
      {
        noteId: this.noteId,
        payload: awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          changedClients
        )
      },
      (ack) => {
        if (!ack?.ok) {
          this.onServerError?.(
            ack?.error?.message ?? 'Note awareness could not be sent.'
          );
        }
      }
    );
  }

  async dispose({ leaveNote = true } = {}) {
    if (this.disposed) {
      return;
    }

    if (this.syncTimeoutId) {
      window.clearTimeout(this.syncTimeoutId);
    }

    if (this.textarea) {
      this.textarea.removeEventListener('input', this.boundInputHandler);
      this.textarea.removeEventListener('focus', this.boundFocusHandler);
      this.textarea.removeEventListener('blur', this.boundBlurHandler);
    }

    if (leaveNote) {
      this.awareness.setLocalState(null);

      try {
        await emitWithAck(this.socket, 'note:leave', {
          noteId: this.noteId
        });
      } catch {
        // Best-effort leave; server disconnect cleanup covers the rest.
      }
    }

    this.disposed = true;

    if (this.boundListeners) {
      this.socket.off('note:yjs-sync', this.boundListeners.sync);
      this.socket.off('note:yjs-update', this.boundListeners.update);
      this.socket.off('note:yjs-awareness', this.boundListeners.awareness);
      this.socket.off('note:head-persisted', this.boundListeners.persisted);
      this.socket.off('server:error', this.boundListeners.serverError);
    }

    this.ytext.unobserve(this.textObserver);
    this.ydoc.off('update', this.documentUpdateHandler);
    this.awareness.off('update', this.awarenessUpdateHandler);
    this.awareness.destroy();
    this.ydoc.destroy();
  }
}

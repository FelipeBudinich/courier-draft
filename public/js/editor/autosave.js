const createAutosaveError = (code, details) => {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
};

export const createAutosaveController = ({
  delayMs = 2000,
  save,
  onStateChange
}) => {
  let timerId = null;
  let inFlightSave = null;
  let latestPayload = null;
  let dirty = false;
  let isReadOnly = false;
  let snapshot = {
    status: 'saved',
    lastSavedAt: null,
    error: null,
    staleDetails: null,
    dirty: false
  };

  const emitState = (nextSnapshot) => {
    snapshot = {
      ...snapshot,
      ...nextSnapshot,
      dirty
    };
    onStateChange?.(snapshot);
  };

  const clearTimer = () => {
    if (!timerId) {
      return;
    }

    clearTimeout(timerId);
    timerId = null;
  };

  const scheduleSave = () => {
    if (isReadOnly || snapshot.status === 'stale') {
      return;
    }

    clearTimer();
    timerId = globalThis.setTimeout(() => {
      void flush('debounced');
    }, delayMs);
  };

  const runSave = async (reason) => {
    if (isReadOnly) {
      return null;
    }

    if (snapshot.status === 'stale') {
      throw createAutosaveError('STALE_STATE', snapshot.staleDetails);
    }

    if (!dirty || !latestPayload) {
      return inFlightSave;
    }

    if (inFlightSave) {
      return inFlightSave;
    }

    clearTimer();

    const payload = latestPayload;
    dirty = false;
    emitState({
      status: 'saving',
      error: null,
      staleDetails: null
    });

    inFlightSave = Promise.resolve(save(payload, reason))
      .then((result) => {
        emitState({
          status: isReadOnly ? 'readOnly' : dirty ? 'unsaved' : 'saved',
          lastSavedAt: result?.headUpdatedAt ?? snapshot.lastSavedAt,
          error: null,
          staleDetails: null
        });

        if (dirty) {
          scheduleSave();
        }

        return result;
      })
      .catch((error) => {
        if (error.code === 'STALE_STATE') {
          dirty = true;
          emitState({
            status: 'stale',
            staleDetails: error.details ?? null,
            error: null
          });
        } else {
          dirty = true;
          emitState({
            status: 'failed',
            error,
            staleDetails: null
          });
        }

        throw error;
      })
      .finally(() => {
        inFlightSave = null;
      });

    return inFlightSave;
  };

  const flush = (reason = 'manual') => {
    if (isReadOnly) {
      return Promise.resolve(null);
    }

    return runSave(reason);
  };

  return {
    markDirty(payload) {
      if (isReadOnly) {
        return;
      }

      latestPayload = payload;
      dirty = true;

      if (!inFlightSave && snapshot.status !== 'stale') {
        emitState({
          status: 'unsaved',
          error: null
        });
      }

      if (!inFlightSave) {
        scheduleSave();
      }
    },
    flush,
    reset({ lastSavedAt = null, readOnly = false } = {}) {
      clearTimer();
      latestPayload = null;
      dirty = false;
      isReadOnly = readOnly;
      emitState({
        status: readOnly ? 'readOnly' : 'saved',
        lastSavedAt,
        error: null,
        staleDetails: null
      });
    },
    hasPendingWork() {
      return dirty || Boolean(inFlightSave);
    },
    getState() {
      return snapshot;
    }
  };
};

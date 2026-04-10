export const createCollabStateManager = ({
  connectionElement,
  connectionLabels,
  saveStateUi
}) => {
  const state = {
    connectionStatus: 'connecting',
    persistenceStatus: 'persisted',
    lastSavedAt: null,
    error: null,
    message: '',
    readOnly: false
  };

  const renderConnection = () => {
    if (!connectionElement) {
      return;
    }

    connectionElement.dataset.connectionState = state.connectionStatus;
    connectionElement.textContent =
      connectionLabels[state.connectionStatus] ?? state.connectionStatus;
  };

  const renderPersistence = () => {
    saveStateUi.update({
      status: state.readOnly ? 'readOnly' : state.persistenceStatus,
      lastSavedAt: state.lastSavedAt,
      error: state.error,
      message: state.message,
      showReload: state.persistenceStatus === 'failed'
    });
  };

  renderConnection();
  renderPersistence();

  return {
    setConnectionStatus(status) {
      state.connectionStatus = status;
      renderConnection();
    },
    markReconnecting(message = '') {
      if (!state.readOnly) {
        state.persistenceStatus = 'reconnecting';
      }

      state.error = null;
      state.message = message;
      renderPersistence();
    },
    setReadOnly(readOnly, lastSavedAt = state.lastSavedAt) {
      state.readOnly = readOnly;
      state.lastSavedAt = lastSavedAt;
      state.error = null;
      state.message = '';
      renderPersistence();
    },
    markUnsaved() {
      if (state.readOnly) {
        return;
      }

      state.persistenceStatus = 'unsaved';
      state.error = null;
      state.message = '';
      renderPersistence();
    },
    markPersisted(lastSavedAt) {
      if (state.readOnly) {
        state.lastSavedAt = lastSavedAt ?? state.lastSavedAt;
        renderPersistence();
        return;
      }

      state.persistenceStatus = 'persisted';
      state.lastSavedAt = lastSavedAt ?? state.lastSavedAt;
      state.error = null;
      state.message = '';
      renderPersistence();
    },
    markFailed(message) {
      if (state.readOnly) {
        return;
      }

      state.persistenceStatus = 'failed';
      state.error = message ? { message } : null;
      state.message = '';
      renderPersistence();
    },
    showMessage(message = '') {
      state.message = message;
      renderPersistence();
    },
    clearMessage() {
      state.message = '';
      renderPersistence();
    },
    getConnectionStatus() {
      return state.connectionStatus;
    }
  };
};

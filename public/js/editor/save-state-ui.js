export const createSaveStateUI = ({
  root,
  statusElement,
  timestampElement,
  messageElement,
  reloadButton,
  labels,
  locale,
  emptyLabel = 'Not saved yet'
}) => {
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const setMessage = (message = '') => {
    if (!messageElement) {
      return;
    }

    messageElement.textContent = message;
    messageElement.hidden = !message;
  };

  return {
    update(state) {
      root.dataset.saveState = state.status;
      statusElement.textContent = labels[state.status] ?? state.status;
      timestampElement.textContent = state.lastSavedAt
        ? formatter.format(new Date(state.lastSavedAt))
        : emptyLabel;
      reloadButton.hidden = !state.showReload;
      setMessage(state.message ?? state.error?.message ?? '');
    },
    showNavigationError(message) {
      setMessage(message);
    }
  };
};

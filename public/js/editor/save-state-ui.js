export const createSaveStateUI = ({
  root,
  statusElement,
  timestampElement,
  messageElement,
  reloadButton,
  labels,
  locale
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
        : 'Not saved yet';
      reloadButton.hidden = state.status !== 'stale';

      if (state.status === 'failed') {
        setMessage(state.error?.message ?? labels.failed);
      } else if (state.status === 'stale') {
        setMessage('A newer draft exists. Reload the latest scene head to continue.');
      } else {
        setMessage('');
      }
    },
    showNavigationError(message) {
      setMessage(message);
    }
  };
};

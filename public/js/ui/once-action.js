export const runOnce = async ({
  element,
  action,
  busyText = null
}) => {
  if (!element || element.dataset.actionBusy === 'true') {
    return false;
  }

  element.dataset.actionBusy = 'true';
  const originalText = element.textContent;
  element.setAttribute('aria-busy', 'true');

  if ('disabled' in element) {
    element.disabled = true;
  }

  if (busyText) {
    element.textContent = busyText;
  }

  try {
    await action();
    return true;
  } finally {
    delete element.dataset.actionBusy;
    element.removeAttribute('aria-busy');

    if ('disabled' in element) {
      element.disabled = false;
    }

    if (busyText && originalText) {
      element.textContent = originalText;
    }
  }
};

const ensureAnnouncer = () => {
  let node = document.querySelector('[data-live-announcer]');

  if (node) {
    return node;
  }

  node = document.createElement('div');
  node.className = 'sr-only';
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'true');
  node.dataset.liveAnnouncer = 'true';
  document.body.append(node);
  return node;
};

export const announce = (message, politeness = 'polite') => {
  if (!message) {
    return;
  }

  const node = ensureAnnouncer();
  node.setAttribute('aria-live', politeness);
  node.textContent = '';

  window.requestAnimationFrame(() => {
    node.textContent = message;
  });
};

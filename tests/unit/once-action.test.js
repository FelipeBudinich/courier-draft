import { describe, expect, it } from 'vitest';

import { runOnce } from '../../public/js/ui/once-action.js';

const createElement = () => {
  const attributes = new Map();

  return {
    dataset: {},
    textContent: 'Save',
    disabled: false,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    }
  };
};

describe('runOnce', () => {
  it('prevents a second concurrent action on the same element', async () => {
    const element = createElement();
    let resolveAction;
    const actionPromise = new Promise((resolve) => {
      resolveAction = resolve;
    });

    const firstRun = runOnce({
      element,
      busyText: 'Saving…',
      action: async () => actionPromise
    });

    expect(element.dataset.actionBusy).toBe('true');
    expect(element.disabled).toBe(true);
    expect(element.textContent).toBe('Saving…');
    expect(element.getAttribute('aria-busy')).toBe('true');

    const secondRun = await runOnce({
      element,
      action: async () => true
    });

    expect(secondRun).toBe(false);

    resolveAction();
    await expect(firstRun).resolves.toBe(true);
    expect(element.dataset.actionBusy).toBeUndefined();
    expect(element.disabled).toBe(false);
    expect(element.textContent).toBe('Save');
    expect(element.getAttribute('aria-busy')).toBeNull();
  });

  it('returns false when no element is provided', async () => {
    await expect(
      runOnce({
        element: null,
        action: async () => true
      })
    ).resolves.toBe(false);
  });
});

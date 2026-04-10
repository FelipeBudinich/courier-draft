import { describe, expect, it, vi } from 'vitest';

import { createCollabStateManager } from '../../public/js/editor/collab-state.js';

describe('editor collaborative state manager', () => {
  it('transitions through unsaved, reconnecting, failed, and read-only states', () => {
    const connectionElement = {
      dataset: {},
      textContent: ''
    };
    const updates = [];
    const saveStateUi = {
      update: vi.fn((payload) => {
        updates.push(payload);
      })
    };

    const manager = createCollabStateManager({
      connectionElement,
      connectionLabels: {
        connecting: 'Connecting',
        connected: 'Connected',
        reconnecting: 'Reconnecting…',
        unavailable: 'Unavailable'
      },
      saveStateUi
    });

    expect(connectionElement.dataset.connectionState).toBe('connecting');
    expect(updates.at(-1).status).toBe('persisted');

    manager.setConnectionStatus('connected');
    manager.markUnsaved();
    expect(connectionElement.textContent).toBe('Connected');
    expect(updates.at(-1).status).toBe('unsaved');

    manager.markReconnecting('Realtime connection lost. Reconnecting…');
    expect(updates.at(-1).status).toBe('reconnecting');
    expect(updates.at(-1).message).toContain('Reconnecting');

    manager.markFailed('Persistence failed.');
    expect(updates.at(-1).status).toBe('failed');
    expect(updates.at(-1).error.message).toBe('Persistence failed.');

    manager.setReadOnly(true, '2026-04-10T12:00:00.000Z');
    expect(updates.at(-1).status).toBe('readOnly');
    expect(updates.at(-1).lastSavedAt).toBe('2026-04-10T12:00:00.000Z');
  });
});

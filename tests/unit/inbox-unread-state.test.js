import { describe, expect, it } from 'vitest';

import { markInboxItemRead, isInboxItemRead } from '../../src/services/inbox/unread-state.js';

describe('inbox unread state helpers', () => {
  it('treats explicitly tracked item ids as read', () => {
    expect(
      isInboxItemRead({
        readState: {
          readItemIds: ['act_demo123'],
          lastReadAllAt: null
        },
        itemId: 'act_demo123',
        occurredAt: new Date('2026-01-01T10:00:00.000Z').toISOString()
      })
    ).toBe(true);
  });

  it('falls back to last-read-all timestamps when an item was not tracked explicitly', () => {
    expect(
      isInboxItemRead({
        readState: {
          readItemIds: [],
          lastReadAllAt: '2026-01-02T12:00:00.000Z'
        },
        itemId: 'pmm_demo123',
        occurredAt: '2026-01-02T11:59:00.000Z'
      })
    ).toBe(true);

    expect(
      isInboxItemRead({
        readState: {
          readItemIds: [],
          lastReadAllAt: '2026-01-02T12:00:00.000Z'
        },
        itemId: 'pmm_demo124',
        occurredAt: '2026-01-02T12:01:00.000Z'
      })
    ).toBe(false);
  });

  it('rejects inbox item ids that do not come from invite or activity sources', async () => {
    await expect(
      markInboxItemRead({
        userId: 'user-object-id',
        itemId: 'bad_demo123'
      })
    ).rejects.toThrow(/Inbox item id is invalid/i);
  });
});

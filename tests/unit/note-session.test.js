import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../../src/services/collab/note-session-persistence.js', () => ({
  persistNoteSessionHead: vi.fn()
}));

vi.mock('../../src/services/realtime/broadcaster.js', () => ({
  emitToNoteRoom: vi.fn()
}));

import {
  NOTE_PERSIST_DEBOUNCE_MS,
  NOTE_PERSIST_RETRY_MS,
  NoteSession
} from '../../src/services/collab/note-session.js';
import { persistNoteSessionHead } from '../../src/services/collab/note-session-persistence.js';
import { createNoteYDocFromText } from '../../src/services/collab/yjs-note-adapter.js';

const createSession = () =>
  NoteSession.create({
    note: {
      _id: 'note-object-id',
      publicId: 'nte_realtime_demo',
      currentMajorVersionId: null,
      headUpdatedAt: new Date('2026-04-10T12:00:00.000Z'),
      headRevision: 1
    },
    text: '',
    onDispose: vi.fn(),
    createYDoc: createNoteYDocFromText
  });

const createTextUpdate = (value = 'demo') => {
  const doc = createNoteYDocFromText();
  doc.getText('content').insert(0, value);
  return Y.encodeStateAsUpdate(doc);
};

describe('note session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(persistNoteSessionHead).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces persistence after accepted updates', async () => {
    vi.mocked(persistNoteSessionHead).mockResolvedValue({
      noteId: 'nte_realtime_demo',
      headRevision: 2,
      headUpdatedAt: new Date('2026-04-10T12:00:05.000Z'),
      headText: 'Realtime note body'
    });

    const session = createSession();
    session.addMember({
      socketId: 'sock-1',
      user: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      },
      canEdit: true
    });

    session.applyTextUpdate(createTextUpdate('Realtime note body'), {
      socketId: 'sock-1',
      actor: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      }
    });

    expect(persistNoteSessionHead).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(NOTE_PERSIST_DEBOUNCE_MS);

    expect(persistNoteSessionHead).toHaveBeenCalledTimes(1);
    expect(session.dirty).toBe(false);
    expect(session.lastPersistedRevision).toBe(2);
  });

  it('retries failed persistence and succeeds on the scheduled retry', async () => {
    vi.mocked(persistNoteSessionHead)
      .mockRejectedValueOnce(new Error('Mongo unavailable'))
      .mockResolvedValueOnce({
        noteId: 'nte_realtime_demo',
        headRevision: 3,
        headUpdatedAt: new Date('2026-04-10T12:00:10.000Z'),
        headText: 'Recovered note body'
      });

    const session = createSession();
    session.addMember({
      socketId: 'sock-1',
      user: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      },
      canEdit: true
    });

    session.applyTextUpdate(createTextUpdate('Recovered note body'), {
      socketId: 'sock-1',
      actor: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      }
    });

    await session.flush('manual').catch(() => {});

    expect(persistNoteSessionHead).toHaveBeenCalledTimes(1);
    expect(session.lastPersistError).toBeTruthy();
    expect(session.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(NOTE_PERSIST_RETRY_MS);

    expect(persistNoteSessionHead).toHaveBeenCalledTimes(2);
    expect(session.lastPersistError).toBeNull();
    expect(session.dirty).toBe(false);
    expect(session.lastPersistedRevision).toBe(3);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../../src/services/collab/scene-session-persistence.js', () => ({
  persistSceneSessionHead: vi.fn()
}));

vi.mock('../../src/services/collab/yjs-scene-adapter.js', () => ({
  materializeCanonicalDocumentFromYDoc: vi.fn(() => ({
    schemaVersion: 1,
    blocks: [
      {
        id: 'blk_session',
        type: 'action',
        text: 'Realtime draft'
      }
    ]
  }))
}));

import {
  SCENE_PERSIST_DEBOUNCE_MS,
  SCENE_PERSIST_RETRY_MS,
  SceneSession
} from '../../src/services/collab/scene-session.js';
import { persistSceneSessionHead } from '../../src/services/collab/scene-session-persistence.js';

const createSession = () =>
  SceneSession.create({
    scene: {
      _id: 'scene-object-id',
      publicId: 'scn_realtime_demo',
      projectPublicId: 'prj_realtime_demo',
      scriptPublicId: 'scr_realtime_demo',
      latestMajorVersionId: null,
      headUpdatedAt: new Date('2026-04-10T12:00:00.000Z'),
      headRevision: 0
    },
    document: {
      schemaVersion: 1,
      blocks: []
    },
    onDispose: vi.fn(),
    createYDoc: () => new Y.Doc()
  });

const createValidUpdate = (value = 'demo') => {
  const doc = new Y.Doc();
  doc.getMap('test').set('value', value);
  return Y.encodeStateAsUpdate(doc);
};

describe('scene session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(persistSceneSessionHead).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces persistence after accepted updates', async () => {
    vi.mocked(persistSceneSessionHead).mockResolvedValue({
      sceneId: 'scn_realtime_demo',
      headRevision: 1,
      headUpdatedAt: new Date('2026-04-10T12:00:05.000Z'),
      document: {
        schemaVersion: 1,
        blocks: []
      },
      derived: {
        cachedSlugline: null,
        characterRefs: [],
        locationRefs: []
      }
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

    session.applyDocumentUpdate(createValidUpdate('first'), {
      socketId: 'sock-1',
      actor: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      }
    });

    expect(persistSceneSessionHead).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SCENE_PERSIST_DEBOUNCE_MS);

    expect(persistSceneSessionHead).toHaveBeenCalledTimes(1);
    expect(session.dirty).toBe(false);
    expect(session.lastPersistedRevision).toBe(1);
  });

  it('flushes immediately when the last socket leaves a dirty session', async () => {
    vi.mocked(persistSceneSessionHead).mockResolvedValue({
      sceneId: 'scn_realtime_demo',
      headRevision: 1,
      headUpdatedAt: new Date('2026-04-10T12:00:06.000Z'),
      document: {
        schemaVersion: 1,
        blocks: []
      },
      derived: {
        cachedSlugline: null,
        characterRefs: [],
        locationRefs: []
      }
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

    session.applyDocumentUpdate(createValidUpdate('disconnect'), {
      socketId: 'sock-1',
      actor: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      }
    });

    await session.leave('sock-1');

    expect(persistSceneSessionHead).toHaveBeenCalledTimes(1);
    expect(session.hasMembers()).toBe(false);
    expect(session.dirty).toBe(false);
  });

  it('retries failed persistence and succeeds on the scheduled retry', async () => {
    vi.mocked(persistSceneSessionHead)
      .mockRejectedValueOnce(new Error('Mongo unavailable'))
      .mockResolvedValueOnce({
        sceneId: 'scn_realtime_demo',
        headRevision: 2,
        headUpdatedAt: new Date('2026-04-10T12:00:10.000Z'),
        document: {
          schemaVersion: 1,
          blocks: []
        },
        derived: {
          cachedSlugline: null,
          characterRefs: [],
          locationRefs: []
        }
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

    session.applyDocumentUpdate(createValidUpdate('retry'), {
      socketId: 'sock-1',
      actor: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      }
    });

    await session.flush('manual').catch(() => {});

    expect(persistSceneSessionHead).toHaveBeenCalledTimes(1);
    expect(session.lastPersistError).toBeTruthy();
    expect(session.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(SCENE_PERSIST_RETRY_MS);

    expect(persistSceneSessionHead).toHaveBeenCalledTimes(2);
    expect(session.lastPersistError).toBeNull();
    expect(session.dirty).toBe(false);
    expect(session.lastPersistedRevision).toBe(2);
  });

  it('replaces live scene state during restore without leaving dirty timers behind', () => {
    const session = createSession();
    session.addMember({
      socketId: 'sock-1',
      user: {
        _id: 'actor-object-id',
        publicId: 'usr_realtime_demo'
      },
      canEdit: true
    });
    session.members.get('sock-1').awarenessClientIds.add(101);
    session.dirty = true;

    session.replaceDocument({
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_restore',
            type: 'action',
            text: 'Restored scene draft'
          }
        ]
      },
      currentMajorVersionId: 'ver_restore_demo',
      headUpdatedAt: new Date('2026-04-10T12:01:00.000Z'),
      headRevision: 4
    });

    expect(session.dirty).toBe(false);
    expect(session.currentMajorVersionId).toBe('ver_restore_demo');
    expect(session.latestMajorVersionId).toBe('ver_restore_demo');
    expect(session.lastPersistedRevision).toBe(4);
    expect(session.members.get('sock-1').awarenessClientIds.size).toBe(0);
  });
});

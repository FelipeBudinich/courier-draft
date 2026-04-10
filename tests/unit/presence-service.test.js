import { beforeEach, describe, expect, it, vi } from 'vitest';

import { presenceService } from '../../src/services/presence/service.js';

const projectId = 'prj_presence_demo';
const scriptId = 'scr_presence_demo';
const sceneId = 'scn_presence_demo';

const createUser = (overrides = {}) => ({
  publicId: 'usr_presence_demo',
  username: 'presenceuser',
  displayName: 'Presence User',
  avatarUrl: '',
  ...overrides
});

describe('presence service', () => {
  beforeEach(() => {
    presenceService.clear();
  });

  it('aggregates multiple sockets into a single visible project presence entry', () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(4);
    try {
      const user = createUser();

      const firstJoin = presenceService.joinProject(projectId, user, 'sock-1');
      expect(firstJoin.isFirstConnection).toBe(true);
      expect(firstJoin.snapshot).toHaveLength(1);
      expect(firstJoin.snapshot[0].view.mode).toBe('idle');

      presenceService.setScriptContext(projectId, user.publicId, 'sock-1', scriptId, 'viewing');
      presenceService.joinProject(projectId, user, 'sock-2');
      presenceService.setSceneContext(
        projectId,
        user.publicId,
        'sock-2',
        scriptId,
        sceneId,
        'editing'
      );

      const snapshot = presenceService.snapshot(projectId);

      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].view).toEqual({
        projectId,
        scriptId,
        sceneId,
        noteId: null,
        mode: 'editing'
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('falls back to the remaining socket view when another socket leaves', () => {
    const user = createUser();

    presenceService.joinProject(projectId, user, 'sock-1');
    presenceService.setScriptContext(projectId, user.publicId, 'sock-1', scriptId, 'viewing');
    presenceService.joinProject(projectId, user, 'sock-2');
    presenceService.setSceneContext(
      projectId,
      user.publicId,
      'sock-2',
      scriptId,
      sceneId,
      'editing'
    );

    const leaveResult = presenceService.leaveProject(projectId, user.publicId, 'sock-2');

    expect(leaveResult.removed).toBe(false);
    expect(leaveResult.entry.view).toEqual({
      projectId,
      scriptId,
      sceneId: null,
      noteId: null,
      mode: 'viewing'
    });
    expect(presenceService.snapshotScene(projectId, sceneId)).toEqual([]);
  });
});

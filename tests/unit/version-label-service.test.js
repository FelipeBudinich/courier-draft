import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outlineNodeFind, sceneFind } = vi.hoisted(() => ({
  outlineNodeFind: vi.fn(),
  sceneFind: vi.fn()
}));

vi.mock('../../src/models/index.js', () => ({
  OutlineNode: {
    find: outlineNodeFind
  },
  Scene: {
    find: sceneFind
  }
}));

vi.mock('../../src/services/outline/read-model.js', () => ({
  buildOutlineTree: vi.fn()
}));

import { buildOutlineTree } from '../../src/services/outline/read-model.js';
import { buildScriptCheckpointVersionLabel } from '../../src/services/versioning/version-label-service.js';

const createSortQuery = (result) => ({
  sort: vi.fn().mockResolvedValue(result),
  session: vi.fn().mockReturnThis()
});

const createSelectQuery = (result) => ({
  select: vi.fn().mockResolvedValue(result),
  session: vi.fn().mockReturnThis()
});

describe('version label service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mixed/global label for script-scoped checkpoints', async () => {
    await expect(
      buildScriptCheckpointVersionLabel({
        script: {
          _id: 'script-object-id'
        },
        majorSaveSequence: 3,
        scopeType: 'script'
      })
    ).resolves.toBe('0.0.0.3');
  });

  it('derives act, beat, and scene order for scene-scoped checkpoints', async () => {
    outlineNodeFind.mockReturnValue(
      createSortQuery([
        {
          _id: 'act-node-1',
          type: 'act'
        },
        {
          _id: 'beat-node-1',
          type: 'beat'
        }
      ])
    );
    sceneFind.mockReturnValue(
      createSelectQuery([
        {
          _id: 'scene-object-id',
          publicId: 'scn_scene_demo'
        }
      ])
    );
    vi.mocked(buildOutlineTree).mockReturnValue({
      canonicalSceneNodes: [
        {
          sceneId: 'scn_scene_demo',
          actId: 'act-node-1',
          beatId: 'beat-node-1'
        }
      ]
    });

    await expect(
      buildScriptCheckpointVersionLabel({
        script: {
          _id: 'script-object-id'
        },
        majorSaveSequence: 7,
        scopeType: 'scene',
        scene: {
          _id: 'scene-object-id',
          publicId: 'scn_scene_demo'
        }
      })
    ).resolves.toBe('1.1.1.7');
  });
});

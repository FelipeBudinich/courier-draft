import { describe, expect, it } from 'vitest';

import { buildOutlineTree } from '../../src/services/outline/read-model.js';

const buildNode = ({
  id,
  publicId,
  type,
  title,
  positionKey,
  placementParentId = null,
  sceneId = null
}) => ({
  _id: id,
  publicId,
  type,
  title,
  positionKey,
  placementParentId,
  sceneId,
  actId: null,
  beatId: null,
  autoSceneNumber: type === 'scene' ? '1' : null,
  manualSceneNumber: null
});

describe('outline read model', () => {
  it('assembles mixed root nodes and preserves depth-first scene order', () => {
    const nodes = [
      buildNode({
        id: 'act-1',
        publicId: 'out_act',
        type: 'act',
        title: 'Act I',
        positionKey: '000001000000'
      }),
      buildNode({
        id: 'beat-1',
        publicId: 'out_beat',
        type: 'beat',
        title: 'Standalone Beat',
        positionKey: '000002000000'
      }),
      buildNode({
        id: 'scene-1',
        publicId: 'out_scene_root',
        type: 'scene',
        title: 'Root Scene',
        positionKey: '000003000000',
        sceneId: 'scene-doc-1'
      }),
      buildNode({
        id: 'scene-2',
        publicId: 'out_scene_child',
        type: 'scene',
        title: 'Act Scene',
        positionKey: '000001500000',
        placementParentId: 'act-1',
        sceneId: 'scene-doc-2'
      })
    ];
    const scenes = [
      { _id: 'scene-doc-1', publicId: 'scn_root' },
      { _id: 'scene-doc-2', publicId: 'scn_child' }
    ];

    const outline = buildOutlineTree({
      nodes,
      scenes,
      sceneNumberMode: 'auto'
    });

    expect(outline.nodes.map((node) => node.id)).toEqual([
      'out_act',
      'out_beat',
      'out_scene_root'
    ]);
    expect(outline.nodes[0].children.map((node) => node.id)).toEqual(['out_scene_child']);
    expect(outline.canonicalSceneNodes.map((node) => node.id)).toEqual([
      'out_scene_child',
      'out_scene_root'
    ]);
  });
});

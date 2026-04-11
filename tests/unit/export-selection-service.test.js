import { describe, expect, it } from 'vitest';

import { resolveExportSelection } from '../../src/services/export/export-selection-service.js';

describe('export selection resolution', () => {
  const outlineNodes = [
    {
      id: 'out_act_1',
      type: 'act',
      title: 'Act I',
      children: [
        {
          id: 'out_scene_1',
          type: 'scene',
          sceneId: 'scn_1',
          title: 'Scene 1',
          children: []
        },
        {
          id: 'out_scene_2',
          type: 'scene',
          sceneId: 'scn_2',
          title: 'Scene 2',
          children: []
        }
      ]
    },
    {
      id: 'out_act_2',
      type: 'act',
      title: 'Act II',
      children: [
        {
          id: 'out_scene_3',
          type: 'scene',
          sceneId: 'scn_3',
          title: 'Scene 3',
          children: []
        }
      ]
    }
  ];
  const canonicalSceneEntries = [
    {
      sceneId: 'scn_1',
      actNodeId: 'out_act_1'
    },
    {
      sceneId: 'scn_2',
      actNodeId: 'out_act_1'
    },
    {
      sceneId: 'scn_3',
      actNodeId: 'out_act_2'
    }
  ];

  it('deduplicates mixed act and scene selections while preserving canonical order', () => {
    const selection = resolveExportSelection({
      selection: {
        kind: 'partial',
        actNodeIds: ['out_act_2'],
        sceneIds: ['scn_2', 'scn_2']
      },
      outlineNodes,
      canonicalSceneEntries
    });

    expect(selection.selectedSceneIds).toEqual(['scn_2', 'scn_3']);
    expect(selection.selectedActCount).toBe(1);
    expect(selection.selectedSceneCount).toBe(2);
  });

  it('rejects scenes outside the target script', () => {
    expect(() =>
      resolveExportSelection({
        selection: {
          kind: 'partial',
          actNodeIds: [],
          sceneIds: ['scn_missing']
        },
        outlineNodes,
        canonicalSceneEntries
      })
    ).toThrow(/do not belong to this script/);
  });
});


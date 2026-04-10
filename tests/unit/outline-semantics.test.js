import { describe, expect, it } from 'vitest';

import {
  normalizeSceneSemanticLinks,
  validatePlacementParent
} from '../../src/services/outline/semantics.js';

const buildNode = ({ id, type, placementParentId = null }) => ({
  _id: id,
  type,
  placementParentId
});

describe('outline semantics', () => {
  it('blocks invalid containers', () => {
    expect(() =>
      validatePlacementParent({
        type: 'act',
        parentNode: buildNode({ id: 'act-1', type: 'act' })
      })
    ).toThrow(/cannot be placed/i);

    expect(() =>
      validatePlacementParent({
        type: 'beat',
        parentNode: buildNode({ id: 'beat-1', type: 'beat' })
      })
    ).toThrow(/cannot be placed/i);
  });

  it('allows valid containers', () => {
    expect(() =>
      validatePlacementParent({
        type: 'scene',
        parentNode: buildNode({ id: 'beat-1', type: 'beat' })
      })
    ).not.toThrow();
  });

  it('inherits the containing act from a beat link', () => {
    const act = buildNode({ id: 'act-1', type: 'act' });
    const beat = buildNode({ id: 'beat-1', type: 'beat', placementParentId: act._id });
    const nodesById = new Map([
      [String(act._id), act],
      [String(beat._id), beat]
    ]);

    const normalized = normalizeSceneSemanticLinks({
      actId: null,
      beatId: beat._id,
      nodesById
    });

    expect(String(normalized.beatId)).toBe('beat-1');
    expect(String(normalized.actId)).toBe('act-1');
  });

  it('rejects mismatched act and beat links', () => {
    const actA = buildNode({ id: 'act-1', type: 'act' });
    const actB = buildNode({ id: 'act-2', type: 'act' });
    const beat = buildNode({ id: 'beat-1', type: 'beat', placementParentId: actA._id });
    const nodesById = new Map([
      [String(actA._id), actA],
      [String(actB._id), actB],
      [String(beat._id), beat]
    ]);

    expect(() =>
      normalizeSceneSemanticLinks({
        actId: actB._id,
        beatId: beat._id,
        nodesById
      })
    ).toThrow(/must match/i);
  });
});

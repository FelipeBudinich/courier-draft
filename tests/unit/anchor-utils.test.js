import { describe, expect, it } from 'vitest';

import {
  normalizeAnchorInput,
  remapAnchorToDocument
} from '../../src/services/notes/anchor-utils.js';

const scene = {
  publicId: 'scn_anchor_demo',
  headRevision: 42,
  headDocument: {
    schemaVersion: 1,
    blocks: [
      {
        id: 'blk_anchor_demo',
        type: 'action',
        text: 'hands over THE PACKAGE without looking'
      }
    ]
  }
};

describe('note anchor utilities', () => {
  it('normalizes anchors against the current scene head', () => {
    const anchor = normalizeAnchorInput({
      scene,
      anchor: {
        blockId: 'blk_anchor_demo',
        startOffset: 11,
        endOffset: 22,
        selectedText: 'THE PACKAGE'
      }
    });

    expect(anchor).toEqual({
      sceneId: 'scn_anchor_demo',
      blockId: 'blk_anchor_demo',
      startOffset: 11,
      endOffset: 22,
      selectedText: 'THE PACKAGE',
      contextBefore: 'hands over ',
      contextAfter: ' without looking',
      createdFromSceneHeadRevision: 42
    });
  });

  it('remaps anchors when the selected text moves within the same block', () => {
    const remap = remapAnchorToDocument({
      anchor: {
        sceneId: 'scn_anchor_demo',
        blockId: 'blk_anchor_demo',
        startOffset: 11,
        endOffset: 22,
        selectedText: 'THE PACKAGE',
        contextBefore: 'hands over ',
        contextAfter: ' without looking',
        createdFromSceneHeadRevision: 42
      },
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_anchor_demo',
            type: 'action',
            text: 'hands over without looking THE PACKAGE'
          }
        ]
      }
    });

    expect(remap.status).toBe('moved');
    expect(remap.nextAnchor.startOffset).toBe(27);
    expect(remap.nextAnchor.endOffset).toBe(38);
    expect(remap.nextAnchor.selectedText).toBe('THE PACKAGE');
  });

  it('detaches anchors when the original block no longer exists', () => {
    const anchor = {
      sceneId: 'scn_anchor_demo',
      blockId: 'blk_anchor_demo',
      startOffset: 11,
      endOffset: 22,
      selectedText: 'THE PACKAGE',
      contextBefore: 'hands over ',
      contextAfter: ' without looking',
      createdFromSceneHeadRevision: 42
    };

    const remap = remapAnchorToDocument({
      anchor,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_other_demo',
            type: 'action',
            text: 'No anchor survives here.'
          }
        ]
      }
    });

    expect(remap).toEqual({
      status: 'detached',
      nextAnchor: anchor
    });
  });
});

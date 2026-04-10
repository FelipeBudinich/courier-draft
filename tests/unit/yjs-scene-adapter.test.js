import { describe, expect, it } from 'vitest';

import {
  createSceneYDocFromCanonicalDocument,
  getSceneXmlFragment,
  materializeCanonicalDocumentFromYDoc
} from '../../src/services/collab/yjs-scene-adapter.js';

describe('scene Yjs adapter', () => {
  it('round-trips canonical scene JSON without losing stable block ids', () => {
    const canonicalDocument = {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_slug',
          type: 'slugline',
          text: 'INT. OFFICE - DAY'
        },
        {
          id: 'blk_action',
          type: 'action',
          text: 'Writers argue over the next draft.'
        },
        {
          id: 'blk_dual',
          type: 'dual_dialogue',
          left: [
            {
              id: 'blk_left_character',
              type: 'character',
              text: 'MARIA'
            },
            {
              id: 'blk_left_dialogue',
              type: 'dialogue',
              text: 'We need a cleaner scene handoff.'
            }
          ],
          right: [
            {
              id: 'blk_right_character',
              type: 'character',
              text: 'JONAH'
            },
            {
              id: 'blk_right_dialogue',
              type: 'dialogue',
              text: 'Then let the room hear it live.'
            }
          ]
        }
      ]
    };

    const ydoc = createSceneYDocFromCanonicalDocument(canonicalDocument);

    expect(getSceneXmlFragment(ydoc)).toBeTruthy();
    expect(materializeCanonicalDocumentFromYDoc(ydoc)).toEqual(canonicalDocument);
  });
});

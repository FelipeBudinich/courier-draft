import { canonicalToEditorDocument, editorToCanonicalDocument } from '../../src/services/scenes/document-adapter.js';
import { extractSceneDerivedFields } from '../../src/services/scenes/derived-fields.js';
import { parseCanonicalSceneDocument } from '../../src/services/scenes/document-schema.js';
import { getSceneHeadDocument } from '../../src/services/scenes/legacy-document.js';
import { normalizeCanonicalSceneDocument } from '../../src/services/scenes/document-normalizer.js';

describe('scene document services', () => {
  it('rejects duplicate block ids anywhere in the document tree', () => {
    expect(() =>
      parseCanonicalSceneDocument({
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_dup',
            type: 'action',
            text: 'Line one'
          },
          {
            id: 'blk_dual',
            type: 'dual_dialogue',
            left: [
              {
                id: 'blk_dup',
                type: 'character',
                text: 'Maria'
              }
            ],
            right: []
          }
        ]
      })
    ).toThrow(/Duplicate block id/);
  });

  it('normalizes uppercase-only block types and trims trailing whitespace', () => {
    const normalized = normalizeCanonicalSceneDocument({
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_1',
          type: 'slugline',
          text: 'int. kitchen - day   '
        },
        {
          id: 'blk_2',
          type: 'action',
          text: 'Maria waits.   '
        },
        {
          id: 'blk_3',
          type: 'character',
          text: 'maria'
        }
      ]
    });

    expect(normalized.blocks).toEqual([
      {
        id: 'blk_1',
        type: 'slugline',
        text: 'INT. KITCHEN - DAY'
      },
      {
        id: 'blk_2',
        type: 'action',
        text: 'Maria waits.'
      },
      {
        id: 'blk_3',
        type: 'character',
        text: 'MARIA'
      }
    ]);
  });

  it('round-trips canonical documents through the editor adapter without losing structure', () => {
    const canonical = {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_slug',
          type: 'slugline',
          text: 'INT. KITCHEN - DAY'
        },
        {
          id: 'blk_dual',
          type: 'dual_dialogue',
          left: [
            {
              id: 'blk_left_char',
              type: 'character',
              text: 'MARIA'
            },
            {
              id: 'blk_left_dialogue',
              type: 'dialogue',
              text: 'I am ready.'
            }
          ],
          right: [
            {
              id: 'blk_right_char',
              type: 'character',
              text: 'JON'
            },
            {
              id: 'blk_right_dialogue',
              type: 'dialogue',
              text: 'Then begin.'
            }
          ]
        }
      ]
    };

    const editorDocument = canonicalToEditorDocument(canonical);

    expect(editorToCanonicalDocument(editorDocument)).toEqual(canonical);
  });

  it('repairs duplicate block ids when materializing editor documents', () => {
    const canonical = editorToCanonicalDocument({
      type: 'doc',
      content: [
        {
          type: 'screenplay_block',
          attrs: {
            blockId: 'blk_dup',
            blockType: 'action'
          },
          content: [
            {
              type: 'text',
              text: 'Line one'
            }
          ]
        },
        {
          type: 'screenplay_block',
          attrs: {
            blockId: 'blk_dup',
            blockType: 'dialogue'
          },
          content: [
            {
              type: 'text',
              text: 'Line two'
            }
          ]
        }
      ]
    });

    expect(canonical.blocks).toHaveLength(2);
    expect(canonical.blocks[0].id).toBe('blk_dup');
    expect(canonical.blocks[1].id).not.toBe('blk_dup');
    expect(canonical.blocks[1].text).toBe('Line two');
  });

  it('extracts cached slugline, characters, and locations from the canonical head', () => {
    const derived = extractSceneDerivedFields({
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_1',
          type: 'slugline',
          text: 'INT. KITCHEN - DAY'
        },
        {
          id: 'blk_2',
          type: 'character',
          text: 'MARIA'
        },
        {
          id: 'blk_3',
          type: 'dual_dialogue',
          left: [
            {
              id: 'blk_4',
              type: 'character',
              text: 'JON'
            }
          ],
          right: []
        }
      ]
    });

    expect(derived).toEqual({
      cachedSlugline: 'INT. KITCHEN - DAY',
      characterRefs: ['MARIA', 'JON'],
      locationRefs: ['KITCHEN']
    });
  });

  it('falls back to legacy headContent when no canonical head exists yet', () => {
    const document = getSceneHeadDocument({
      headContent: 'A team of writers gathers around a whiteboard.'
    });

    expect(document.schemaVersion).toBe(1);
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0].type).toBe('action');
    expect(document.blocks[0].text).toBe(
      'A team of writers gathers around a whiteboard.'
    );
  });
});

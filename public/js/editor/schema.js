import { Fragment, Schema } from 'prosemirror-model';

import { generateBlockId } from '../../../src/services/scenes/block-ids.js';
import {
  DEFAULT_BLOCK_TYPE,
  emptySceneDocument
} from '../../../src/services/scenes/document-constants.js';

const buildTextContent = (text) => {
  if (!text) {
    return null;
  }

  const content = [];
  const segments = text.split('\n');

  segments.forEach((segment, index) => {
    if (segment) {
      content.push(screenplaySchema.text(segment));
    }

    if (index < segments.length - 1) {
      content.push(screenplaySchema.nodes.hard_break.create());
    }
  });

  return Fragment.fromArray(content);
};

export const screenplaySchema = new Schema({
  nodes: {
    doc: {
      content: 'scene_block*'
    },
    text: {
      group: 'inline'
    },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br']
    },
    screenplay_block: {
      group: 'scene_block',
      content: 'inline*',
      defining: true,
      attrs: {
        blockId: { default: null },
        blockType: { default: DEFAULT_BLOCK_TYPE }
      },
      parseDOM: [
        {
          tag: 'p[data-screenplay-block]',
          preserveWhitespace: 'full',
          getAttrs: (dom) => ({
            blockId: dom.getAttribute('data-block-id'),
            blockType: dom.getAttribute('data-block-type') ?? DEFAULT_BLOCK_TYPE
          })
        }
      ],
      toDOM: (node) => [
        'p',
        {
          'data-screenplay-block': 'true',
          'data-block-id': node.attrs.blockId,
          'data-block-type': node.attrs.blockType,
          class: `screenplay-block screenplay-block--${node.attrs.blockType}`
        },
        0
      ]
    },
    dual_dialogue: {
      group: 'scene_block',
      content: 'dual_dialogue_side dual_dialogue_side',
      attrs: {
        blockId: { default: null }
      },
      parseDOM: [
        {
          tag: 'div[data-screenplay-dual-dialogue]',
          getAttrs: (dom) => ({
            blockId: dom.getAttribute('data-block-id')
          })
        }
      ],
      toDOM: (node) => [
        'div',
        {
          'data-screenplay-dual-dialogue': 'true',
          'data-block-id': node.attrs.blockId,
          class: 'screenplay-dual-dialogue'
        },
        0
      ]
    },
    dual_dialogue_side: {
      content: 'screenplay_block*',
      attrs: {
        side: { default: 'left' }
      },
      parseDOM: [
        {
          tag: 'div[data-dual-dialogue-side]',
          getAttrs: (dom) => ({
            side: dom.getAttribute('data-dual-dialogue-side')
          })
        }
      ],
      toDOM: (node) => [
        'div',
        {
          'data-dual-dialogue-side': node.attrs.side,
          class: `screenplay-dual-dialogue__side screenplay-dual-dialogue__side--${node.attrs.side}`
        },
        0
      ]
    }
  },
  marks: {}
});

export const createTextBlockNode = ({
  blockId = generateBlockId(),
  blockType = DEFAULT_BLOCK_TYPE,
  text = ''
} = {}) =>
  screenplaySchema.nodes.screenplay_block.create(
    {
      blockId,
      blockType
    },
    buildTextContent(text)
  );

export const createDualDialogueNode = ({
  blockId = generateBlockId(),
  leftBlocks = [
    createTextBlockNode({ blockType: 'character' }),
    createTextBlockNode({ blockType: 'dialogue' })
  ],
  rightBlocks = [
    createTextBlockNode({ blockType: 'character' }),
    createTextBlockNode({ blockType: 'dialogue' })
  ]
} = {}) =>
  screenplaySchema.nodes.dual_dialogue.create(
    {
      blockId
    },
    [
      screenplaySchema.nodes.dual_dialogue_side.create(
        { side: 'left' },
        Fragment.fromArray(leftBlocks)
      ),
      screenplaySchema.nodes.dual_dialogue_side.create(
        { side: 'right' },
        Fragment.fromArray(rightBlocks)
      )
    ]
  );

export const ensureEditableCanonicalDocument = (document) => {
  if (document.blocks.length > 0) {
    return document;
  }

  return {
    ...emptySceneDocument(),
    blocks: [
      {
        id: generateBlockId(),
        type: DEFAULT_BLOCK_TYPE,
        text: ''
      }
    ]
  };
};

import { EditorState, TextSelection } from 'prosemirror-state';

import { canonicalToEditorDocument } from '../../src/services/scenes/document-adapter.js';
import { insertContextBlock } from '../../public/js/editor/block-commands.js';
import { screenplaySchema } from '../../public/js/editor/schema.js';

const createStateWithSingleBlock = ({ blockType, text }) => {
  const editorDocument = canonicalToEditorDocument({
    schemaVersion: 1,
    blocks: [
      {
        id: 'blk_1',
        type: blockType,
        text
      }
    ]
  });
  const doc = screenplaySchema.nodeFromJSON(editorDocument);
  let state = EditorState.create({
    schema: screenplaySchema,
    doc
  });

  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1 + text.length))
  );

  return state;
};

const applyInsertContextBlock = (state) => {
  let nextState = state;
  const handled = insertContextBlock()(state, (transaction) => {
    nextState = state.apply(transaction);
  });

  return {
    handled,
    nextState
  };
};

const readBlockTypes = (state) =>
  state.doc.toJSON().content.map((node) => node.attrs.blockType);

describe('screenplay block commands', () => {
  it('creates dialogue after a character block', () => {
    const { handled, nextState } = applyInsertContextBlock(
      createStateWithSingleBlock({
        blockType: 'character',
        text: 'MARIA'
      })
    );

    expect(handled).toBe(true);
    expect(readBlockTypes(nextState)).toEqual(['character', 'dialogue']);
  });

  it('creates character after a dialogue block', () => {
    const { handled, nextState } = applyInsertContextBlock(
      createStateWithSingleBlock({
        blockType: 'dialogue',
        text: 'I am ready.'
      })
    );

    expect(handled).toBe(true);
    expect(readBlockTypes(nextState)).toEqual(['dialogue', 'character']);
  });

  it('creates action after a slugline block', () => {
    const { handled, nextState } = applyInsertContextBlock(
      createStateWithSingleBlock({
        blockType: 'slugline',
        text: 'INT. KITCHEN - DAY'
      })
    );

    expect(handled).toBe(true);
    expect(readBlockTypes(nextState)).toEqual(['slugline', 'action']);
  });
});

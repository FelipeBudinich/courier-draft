import { Fragment, Slice } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import { editorToCanonicalDocument } from '../../src/services/scenes/document-adapter.js';
import { createClipboardHandlers } from '../../public/js/editor/clipboard.js';
import { createTextBlockNode, screenplaySchema } from '../../public/js/editor/schema.js';

const createEditorState = () => {
  let state = EditorState.create({
    schema: screenplaySchema,
    doc: screenplaySchema.node('doc', null, [
      createTextBlockNode({
        blockId: 'blk_existing',
        blockType: 'action',
        text: ''
      })
    ])
  });

  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1))
  );

  return state;
};

describe('editor clipboard handlers', () => {
  it('sanitizes external paste into action blocks', () => {
    const handlers = createClipboardHandlers();
    let state = createEditorState();
    let prevented = false;
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction) {
        state = state.apply(transaction);
      }
    };
    const event = {
      clipboardData: {
        getData(type) {
          if (type === 'text/plain') {
            return 'First line\nSecond line';
          }

          return '';
        }
      },
      preventDefault() {
        prevented = true;
      }
    };

    const handled = handlers.handlePaste(view, event);
    const canonical = editorToCanonicalDocument(state.doc.toJSON());

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(canonical.blocks.map((block) => [block.type, block.text])).toEqual([
      ['action', 'First line'],
      ['action', 'Second line']
    ]);
  });

  it('regenerates block ids for internal pasted content', () => {
    const handlers = createClipboardHandlers();
    const originalSlice = new Slice(
      Fragment.fromArray([
        createTextBlockNode({
          blockId: 'blk_original',
          blockType: 'action',
          text: 'Copied text'
        })
      ]),
      0,
      0
    );

    const transformed = handlers.transformPasted(originalSlice);

    expect(transformed.content.firstChild.attrs.blockId).not.toBe('blk_original');
    expect(transformed.content.firstChild.attrs.blockType).toBe('action');
  });
});

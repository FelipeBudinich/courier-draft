import { baseKeymap } from 'prosemirror-commands';
import {
  initProseMirrorDoc,
  redo as yRedo,
  undo as yUndo,
  yCursorPlugin,
  ySyncPlugin,
  yUndoPlugin
} from 'y-prosemirror';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  canonicalToEditorDocument,
  editorToCanonicalDocument
} from '../../../src/services/scenes/document-adapter.js';
import {
  createBlockKeyBindings,
  getCurrentBlockInfo,
  getCurrentBlockType,
  insertDualDialogue,
  setCurrentBlockType
} from './block-commands.js';
import { createClipboardHandlers } from './clipboard.js';
import {
  createTextBlockNode,
  ensureEditableCanonicalDocument,
  screenplaySchema
} from './schema.js';

const createCursor = (user = {}) => {
  const cursor = document.createElement('span');
  cursor.classList.add('ProseMirror-yjs-cursor');
  cursor.style.borderColor = user.color ?? '#D9485F';

  const label = document.createElement('div');
  label.style.backgroundColor = user.color ?? '#D9485F';
  label.textContent = user.name ?? 'Collaborator';
  cursor.append(document.createTextNode('\u2060'));
  cursor.append(label);
  cursor.append(document.createTextNode('\u2060'));
  return cursor;
};

export class ScreenplayEditor {
  constructor({
    mountElement,
    initialDocument = null,
    readOnly = false,
    collaboration = null,
    extraPlugins = [],
    onChange,
    onSelectionChange
  }) {
    this.mountElement = mountElement;
    this.readOnly = readOnly;
    this.extraPlugins = extraPlugins;
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange;
    this.collaboration = collaboration;
    this.clipboardHandlers = createClipboardHandlers();
    this.view = new EditorView(mountElement, {
      state: this.#createState(initialDocument),
      dispatchTransaction: this.#dispatchTransaction,
      editable: () => !this.readOnly,
      attributes: {
        class: 'screenplay-editor__surface'
      },
      handlePaste: this.clipboardHandlers.handlePaste,
      transformPasted: this.clipboardHandlers.transformPasted
    });
    this.#notifySelection();
  }

  #createState(document) {
    if (this.collaboration) {
      const { doc, mapping } = initProseMirrorDoc(
        this.collaboration.xmlFragment,
        screenplaySchema
      );

      return EditorState.create({
        schema: screenplaySchema,
        doc,
        plugins: [
          ySyncPlugin(this.collaboration.xmlFragment, { mapping }),
          yCursorPlugin(this.collaboration.awareness, {
            cursorBuilder: createCursor
          }),
          yUndoPlugin(),
          keymap(createBlockKeyBindings(screenplaySchema)),
          keymap({
            'Mod-z': yUndo,
            'Mod-y': yRedo,
            'Mod-Shift-z': yRedo
          }),
          keymap(baseKeymap),
          ...this.extraPlugins
        ]
      });
    }

    const canonicalDocument = this.readOnly
      ? document
      : ensureEditableCanonicalDocument(document);
    const editorDocument = canonicalToEditorDocument(canonicalDocument);

    return EditorState.create({
      schema: screenplaySchema,
      doc: screenplaySchema.nodeFromJSON(editorDocument),
      plugins: [
        keymap(createBlockKeyBindings(screenplaySchema)),
        keymap(baseKeymap),
        ...this.extraPlugins
      ]
    });
  }

  #dispatchTransaction = (transaction) => {
    const nextState = this.view.state.apply(transaction);
    this.view.updateState(nextState);

    if (transaction.docChanged) {
      this.onChange?.(this.getCanonicalDocument());
    }

    if (transaction.docChanged || transaction.selectionSet) {
      this.#notifySelection();
    }
  };

  #notifySelection() {
    this.onSelectionChange?.({
      blockType: getCurrentBlockType(this.view.state),
      view: this.view,
      state: this.view.state
    });
  }

  getCanonicalDocument() {
    return editorToCanonicalDocument(this.view.state.doc.toJSON());
  }

  replaceDocument(document) {
    if (this.collaboration) {
      return;
    }

    this.view.updateState(this.#createState(document));
    this.#notifySelection();
  }

  setReadOnly(readOnly) {
    this.readOnly = readOnly;
    this.view.setProps({
      editable: () => !this.readOnly
    });
  }

  setCurrentBlockType(blockType) {
    return setCurrentBlockType(blockType)(this.view.state, this.view.dispatch);
  }

  getCurrentBlockContext() {
    const blockInfo = getCurrentBlockInfo(this.view.state);
    if (!blockInfo) {
      return null;
    }

    const text = blockInfo.node.textBetween(
      0,
      blockInfo.node.content.size,
      '\n',
      '\n'
    );
    const dom = this.view.nodeDOM(blockInfo.pos);

    return {
      blockId: blockInfo.node.attrs.blockId,
      blockType: blockInfo.node.attrs.blockType,
      pos: blockInfo.pos,
      text,
      dom: dom instanceof HTMLElement ? dom : null
    };
  }

  replaceCurrentBlockText(nextText) {
    const blockInfo = getCurrentBlockInfo(this.view.state);
    if (!blockInfo) {
      return false;
    }

    let transaction = this.view.state.tr.replaceWith(
      blockInfo.pos,
      blockInfo.pos + blockInfo.node.nodeSize,
      createTextBlockNode({
        blockId: blockInfo.node.attrs.blockId,
        blockType: blockInfo.node.attrs.blockType,
        text: nextText
      })
    );
    const nextSelection = Selection.near(
      transaction.doc.resolve(
        Math.max(0, Math.min(blockInfo.pos + nextText.length + 1, transaction.doc.content.size))
      ),
      1
    );

    transaction = transaction.setSelection(nextSelection).scrollIntoView();
    this.view.dispatch(transaction);
    return true;
  }

  insertDualDialogue() {
    return insertDualDialogue()(this.view.state, this.view.dispatch);
  }

  focus() {
    this.view.focus();
  }

  destroy() {
    this.view.destroy();
  }
}

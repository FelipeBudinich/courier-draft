import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  canonicalToEditorDocument,
  editorToCanonicalDocument
} from '../../../src/services/scenes/document-adapter.js';
import { createBlockKeyBindings, getCurrentBlockType, insertDualDialogue, setCurrentBlockType } from './block-commands.js';
import { createClipboardHandlers } from './clipboard.js';
import { ensureEditableCanonicalDocument, screenplaySchema } from './schema.js';

export class ScreenplayEditor {
  constructor({
    mountElement,
    initialDocument,
    readOnly = false,
    onChange,
    onSelectionChange
  }) {
    this.mountElement = mountElement;
    this.readOnly = readOnly;
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange;
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
    const canonicalDocument = this.readOnly
      ? document
      : ensureEditableCanonicalDocument(document);
    const editorDocument = canonicalToEditorDocument(canonicalDocument);

    return EditorState.create({
      schema: screenplaySchema,
      doc: screenplaySchema.nodeFromJSON(editorDocument),
      plugins: [
        history(),
        keymap(createBlockKeyBindings(screenplaySchema)),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo
        }),
        keymap(baseKeymap)
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
    this.onSelectionChange?.(getCurrentBlockType(this.view.state));
  }

  getCanonicalDocument() {
    return editorToCanonicalDocument(this.view.state.doc.toJSON());
  }

  replaceDocument(document) {
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

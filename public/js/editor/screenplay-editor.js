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
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  canonicalToEditorDocument,
  editorToCanonicalDocument
} from '../../../src/services/scenes/document-adapter.js';
import {
  createBlockKeyBindings,
  getCurrentBlockType,
  insertDualDialogue,
  setCurrentBlockType
} from './block-commands.js';
import { createClipboardHandlers } from './clipboard.js';
import { ensureEditableCanonicalDocument, screenplaySchema } from './schema.js';

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

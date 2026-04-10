import * as Y from 'yjs';

export const NOTE_YDOC_TEXT_NAME = 'content';

export const createNoteYDocFromText = (text = '') => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText(NOTE_YDOC_TEXT_NAME);

  if (text) {
    ytext.insert(0, text);
  }

  return ydoc;
};

export const getNoteYText = (ydoc) => ydoc.getText(NOTE_YDOC_TEXT_NAME);

export const materializeTextFromNoteYDoc = (ydoc) =>
  getNoteYText(ydoc).toString();

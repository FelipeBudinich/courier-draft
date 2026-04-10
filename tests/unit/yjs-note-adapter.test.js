import { describe, expect, it } from 'vitest';

import {
  createNoteYDocFromText,
  materializeTextFromNoteYDoc
} from '../../src/services/collab/yjs-note-adapter.js';

describe('yjs note adapter', () => {
  it('round-trips plain-text note content through Y.Text', () => {
    const ydoc = createNoteYDocFromText('Collaborative note body');

    expect(materializeTextFromNoteYDoc(ydoc)).toBe('Collaborative note body');
  });
});

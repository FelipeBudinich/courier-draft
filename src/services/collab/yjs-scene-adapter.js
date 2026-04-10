import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';

import {
  canonicalToEditorDocument,
  editorToCanonicalDocument
} from '../scenes/document-adapter.js';
import { screenplaySchema } from '../scenes/prosemirror-schema.js';

export const SCENE_YDOC_FRAGMENT_NAME = 'prosemirror';

export const createSceneYDocFromCanonicalDocument = (document) =>
  prosemirrorJSONToYDoc(
    screenplaySchema,
    canonicalToEditorDocument(document),
    SCENE_YDOC_FRAGMENT_NAME
  );

export const getSceneXmlFragment = (ydoc) =>
  ydoc.getXmlFragment(SCENE_YDOC_FRAGMENT_NAME);

export const materializeCanonicalDocumentFromYDoc = (ydoc) =>
  editorToCanonicalDocument(
    yDocToProsemirrorJSON(ydoc, SCENE_YDOC_FRAGMENT_NAME)
  );

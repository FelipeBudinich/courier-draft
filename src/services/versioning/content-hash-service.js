import { createHash } from 'node:crypto';

import { normalizeCanonicalSceneDocument } from '../scenes/document-normalizer.js';

const isPlainObject = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const sortObjectKeysDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeysDeep(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObjectKeysDeep(value[key]);
      return result;
    }, {});
};

export const normalizeNoteSnapshot = (snapshot = {}) => ({
  text: String(snapshot.text ?? '')
});

export const normalizeDocumentSnapshot = ({ docType, contentSnapshot }) => {
  if (docType === 'scene') {
    return normalizeCanonicalSceneDocument(contentSnapshot);
  }

  if (docType === 'note') {
    return normalizeNoteSnapshot(contentSnapshot);
  }

  throw new Error(`Unsupported document version type: ${docType}`);
};

export const stableStringifyVersionSnapshot = ({ docType, contentSnapshot }) =>
  JSON.stringify(
    sortObjectKeysDeep(
      normalizeDocumentSnapshot({
        docType,
        contentSnapshot
      })
    )
  );

export const hashDocumentSnapshot = ({ docType, contentSnapshot }) =>
  createHash('sha256')
    .update(
      stableStringifyVersionSnapshot({
        docType,
        contentSnapshot
      })
    )
    .digest('hex');

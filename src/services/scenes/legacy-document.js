import { DEFAULT_BLOCK_TYPE, emptySceneDocument } from './document-constants.js';
import { generateBlockId } from './block-ids.js';
import { normalizeCanonicalSceneDocument } from './document-normalizer.js';

const isNonEmptyArray = (value) => Array.isArray(value) && value.length > 0;

export const sceneHasCanonicalHead = (scene) =>
  Boolean(scene?.headDocument) ||
  isNonEmptyArray(scene?.structuredBody?.blocks);

export const createLegacySceneDocument = (headContent = '') => {
  const text = String(headContent ?? '');

  if (!text) {
    return emptySceneDocument();
  }

  return {
    schemaVersion: 1,
    blocks: [
      {
        id: generateBlockId(),
        type: DEFAULT_BLOCK_TYPE,
        text
      }
    ]
  };
};

export const getSceneHeadDocument = (scene) => {
  if (scene?.headDocument) {
    return normalizeCanonicalSceneDocument(scene.headDocument);
  }

  if (isNonEmptyArray(scene?.structuredBody?.blocks)) {
    return normalizeCanonicalSceneDocument({
      schemaVersion:
        scene.documentSchemaVersion ?? scene.headDocument?.schemaVersion ?? 1,
      blocks: scene.structuredBody.blocks
    });
  }

  return createLegacySceneDocument(scene?.headContent ?? '');
};

export const getSceneHeadRevision = (scene) =>
  Number.isInteger(scene?.headRevision) ? scene.headRevision : 0;

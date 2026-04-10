import {
  DUAL_DIALOGUE_BLOCK_TYPE,
  SCENE_DOCUMENT_SCHEMA_VERSION,
  UPPERCASE_BLOCK_TYPES
} from './document-constants.js';
import { parseCanonicalSceneDocument } from './document-schema.js';

const trimTrailingWhitespace = (text) => text.replace(/[ \t]+$/gm, '');

const normalizeTextForBlockType = (blockType, text) => {
  const trimmedText = trimTrailingWhitespace(text);

  if (UPPERCASE_BLOCK_TYPES.has(blockType)) {
    return trimmedText.toUpperCase();
  }

  return trimmedText;
};

const normalizeTextBlock = (block) => ({
  ...block,
  text: normalizeTextForBlockType(block.type, block.text)
});

const normalizeBlock = (block) => {
  if (block.type !== DUAL_DIALOGUE_BLOCK_TYPE) {
    return normalizeTextBlock(block);
  }

  return {
    ...block,
    left: block.left.map(normalizeTextBlock),
    right: block.right.map(normalizeTextBlock)
  };
};

export const normalizeCanonicalSceneDocument = (input) => {
  const parsedDocument = parseCanonicalSceneDocument(input);

  return {
    schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
    blocks: parsedDocument.blocks.map(normalizeBlock)
  };
};

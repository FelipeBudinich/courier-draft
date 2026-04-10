import { DUAL_DIALOGUE_BLOCK_TYPE } from './document-constants.js';
import { parseCanonicalSceneDocument } from './document-schema.js';

const LOCATION_PREFIX_PATTERN =
  /^(INT|EXT|INT\/EXT|EXT\/INT|I\/E|EST|INT\.\/EXT\.|EXT\.\/INT\.)\.?\s+/;

const collectTextBlocks = (blocks, collected = []) => {
  for (const block of blocks) {
    if (block.type === DUAL_DIALOGUE_BLOCK_TYPE) {
      collectTextBlocks(block.left, collected);
      collectTextBlocks(block.right, collected);
      continue;
    }

    collected.push(block);
  }

  return collected;
};

const uniqueValues = (values) => [...new Set(values.filter(Boolean))];

const extractLocationRef = (slugline) => {
  const normalizedSlugline = String(slugline ?? '').trim();

  if (!normalizedSlugline) {
    return null;
  }

  const withoutPrefix = normalizedSlugline.replace(LOCATION_PREFIX_PATTERN, '');
  const locationCandidate = withoutPrefix.split(/\s+-\s+/)[0]?.trim();

  return locationCandidate || normalizedSlugline;
};

export const extractSceneDerivedFields = (document) => {
  const parsedDocument = parseCanonicalSceneDocument(document);
  const textBlocks = collectTextBlocks(parsedDocument.blocks);
  const sluglines = textBlocks
    .filter((block) => block.type === 'slugline')
    .map((block) => block.text.trim())
    .filter(Boolean);
  const characterRefs = uniqueValues(
    textBlocks
      .filter((block) => block.type === 'character')
      .map((block) => block.text.trim())
  );
  const locationRefs = uniqueValues(sluglines.map(extractLocationRef));

  return {
    cachedSlugline: sluglines[0] ?? null,
    characterRefs,
    locationRefs
  };
};

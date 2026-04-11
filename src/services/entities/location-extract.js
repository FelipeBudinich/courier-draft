import { parseCanonicalSceneDocument } from '../scenes/document-schema.js';

import { normalizeEntityName } from './entity-normalize.js';

const SLUGLINE_PREFIX_PATTERN =
  /^(?<prefix>INT|EXT|INT\/EXT|EXT\/INT|I\/E|EST|INT\.\/EXT\.|EXT\.\/INT\.)\.?\s+(?<rest>.+)$/i;

const collapseWhitespace = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const walkBlocks = (blocks, callback) => {
  blocks.forEach((block) => {
    callback(block);

    if (block.type === 'dual_dialogue') {
      walkBlocks(block.left, callback);
      walkBlocks(block.right, callback);
    }
  });
};

export const splitSluglineParts = (sluglineText) => {
  const normalizedSlugline = collapseWhitespace(sluglineText);

  if (!normalizedSlugline) {
    return null;
  }

  const match = normalizedSlugline.match(SLUGLINE_PREFIX_PATTERN);
  if (!match?.groups?.rest) {
    return null;
  }

  const parts = match.groups.rest
    .split(/\s+-\s+/)
    .map((part) => collapseWhitespace(part))
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  return {
    prefix: collapseWhitespace(match.groups.prefix).toUpperCase(),
    location:
      parts.length === 1 ? parts[0] : parts.slice(0, -1).join(' - '),
    suffix: parts.length > 1 ? parts.at(-1) : '',
    slugline: normalizedSlugline
  };
};

export const replaceSluglineLocation = (sluglineText, nextLocation) => {
  const parts = splitSluglineParts(sluglineText);
  const normalizedLocation = collapseWhitespace(nextLocation);

  if (!parts || !normalizedLocation) {
    return null;
  }

  const suffix = parts.suffix ? ` - ${parts.suffix}` : '';
  return `${parts.prefix}. ${normalizedLocation}${suffix}`;
};

export const extractLocationsFromSceneDocument = (document) => {
  const parsedDocument = parseCanonicalSceneDocument(document);
  const seen = new Set();
  const extracted = [];

  walkBlocks(parsedDocument.blocks, (block) => {
    if (block.type !== 'slugline') {
      return;
    }

    const parts = splitSluglineParts(block.text);
    if (!parts?.location) {
      return;
    }

    const normalized = normalizeEntityName('location', parts.location);
    if (!normalized || seen.has(normalized.normalizedKey)) {
      return;
    }

    seen.add(normalized.normalizedKey);
    extracted.push(normalized);
  });

  return extracted;
};

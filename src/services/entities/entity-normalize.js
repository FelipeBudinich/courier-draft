const CHARACTER_ENTITY_TYPE = 'character';
const LOCATION_ENTITY_TYPE = 'location';

const collapseWhitespace = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeComparisonValue = (value) =>
  collapseWhitespace(value).toUpperCase();

export const ENTITY_TYPES = [CHARACTER_ENTITY_TYPE, LOCATION_ENTITY_TYPE];

export const normalizeEntitySearchQuery = (value) => normalizeComparisonValue(value);

export const normalizeEntityDisplayName = (
  type,
  value,
  { preserveCase = type === LOCATION_ENTITY_TYPE } = {}
) => {
  const collapsed = collapseWhitespace(value);

  if (!collapsed) {
    return '';
  }

  if (type === CHARACTER_ENTITY_TYPE) {
    return collapsed.toUpperCase();
  }

  if (!preserveCase) {
    return collapsed.toUpperCase();
  }

  return collapsed;
};

export const normalizeEntityKey = (_type, value) => normalizeComparisonValue(value);

export const normalizeEntityName = (
  type,
  value,
  { preserveCase = type === LOCATION_ENTITY_TYPE } = {}
) => {
  const display = normalizeEntityDisplayName(type, value, {
    preserveCase
  });
  const normalizedKey = normalizeEntityKey(type, display);

  if (!display || !normalizedKey) {
    return null;
  }

  return {
    display,
    normalizedKey
  };
};

export const normalizeEntityAliasList = (type, aliases = []) => {
  const seen = new Set();
  const normalizedAliases = [];

  aliases.forEach((alias) => {
    const normalized = normalizeEntityName(type, alias);
    if (!normalized || seen.has(normalized.normalizedKey)) {
      return;
    }

    seen.add(normalized.normalizedKey);
    normalizedAliases.push(normalized);
  });

  return normalizedAliases;
};

export const mergeAliasEntries = (type, ...aliasCollections) => {
  const seen = new Set();
  const normalizedAliases = [];

  aliasCollections.flat().forEach((alias) => {
    const normalized = normalizeEntityName(type, alias?.display ?? alias);
    if (!normalized || seen.has(normalized.normalizedKey)) {
      return;
    }

    seen.add(normalized.normalizedKey);
    normalizedAliases.push(normalized);
  });

  return normalizedAliases;
};

export const serializeAliasEntries = (aliases = []) =>
  aliases.map((alias) => ({
    display: alias.display,
    normalizedKey: alias.normalizedKey
  }));

export const getEntitySearchTokens = (entity) => [
  entity.canonicalName,
  ...(entity.aliases ?? []).map((alias) => alias.display)
]
  .map(normalizeEntitySearchQuery)
  .filter(Boolean);

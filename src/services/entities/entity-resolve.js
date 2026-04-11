const createTypeIndex = () => ({
  activeCanonicals: [],
  canonicalByKey: new Map(),
  aliasByKey: new Map()
});

const idString = (value) => (value ? String(value) : null);

export const buildEntityResolutionIndex = (entities = []) => {
  const byPublicId = new Map();
  const byType = {
    character: createTypeIndex(),
    location: createTypeIndex()
  };

  entities.forEach((entity) => {
    byPublicId.set(entity.publicId, entity);

    if (entity.mergedIntoId) {
      return;
    }

    const typeIndex = byType[entity.type] ?? createTypeIndex();
    typeIndex.activeCanonicals.push(entity);
    typeIndex.canonicalByKey.set(entity.normalizedKey, entity);
    (entity.aliases ?? []).forEach((alias) => {
      typeIndex.aliasByKey.set(alias.normalizedKey, entity);
    });
    byType[entity.type] = typeIndex;
  });

  return {
    byPublicId,
    byType
  };
};

export const resolveEntityCandidate = ({
  index,
  type,
  normalizedKey
}) => {
  const typeIndex = index.byType[type];
  if (!typeIndex || !normalizedKey) {
    return null;
  }

  return (
    typeIndex.canonicalByKey.get(normalizedKey) ??
    typeIndex.aliasByKey.get(normalizedKey) ??
    null
  );
};

export const collectEntityNameCollisions = ({
  index,
  type,
  normalizedKeys,
  excludePublicIds = []
}) => {
  const excluded = new Set(excludePublicIds.filter(Boolean));
  const matches = new Map();
  const typeIndex = index.byType[type];

  if (!typeIndex) {
    return [];
  }

  normalizedKeys.forEach((normalizedKey) => {
    if (!normalizedKey) {
      return;
    }

    const entity =
      typeIndex.canonicalByKey.get(normalizedKey) ??
      typeIndex.aliasByKey.get(normalizedKey);
    if (!entity || excluded.has(entity.publicId)) {
      return;
    }

    matches.set(entity.publicId, entity);
  });

  return [...matches.values()];
};

export const resolveCanonicalEntityId = (entity) =>
  entity?.mergedIntoId ? idString(entity.mergedIntoId) : idString(entity?._id);

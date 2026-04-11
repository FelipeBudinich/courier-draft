import { ProjectEntity } from '../../models/index.js';

import {
  getEntitySearchTokens,
  normalizeEntitySearchQuery,
  serializeAliasEntries
} from './entity-normalize.js';

const scoreEntityMatch = (entity, normalizedQuery) => {
  const canonical = normalizeEntitySearchQuery(entity.canonicalName);
  const aliases = (entity.aliases ?? []).map((alias) =>
    normalizeEntitySearchQuery(alias.display)
  );
  const haystack = [canonical, ...aliases];

  if (canonical === normalizedQuery) {
    return 0;
  }

  if (aliases.includes(normalizedQuery)) {
    return 1;
  }

  if (canonical.startsWith(normalizedQuery)) {
    return 2;
  }

  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) {
    return 3;
  }

  if (haystack.some((value) => value.includes(normalizedQuery))) {
    return 4;
  }

  return 5;
};

export const listEntityAutocompleteSuggestions = async ({
  projectId,
  type,
  q,
  limit = 8
}) => {
  const normalizedQuery = normalizeEntitySearchQuery(q);
  if (!normalizedQuery) {
    return [];
  }

  const entities = await ProjectEntity.find({
    projectId,
    type,
    mergedIntoId: null
  }).sort({ canonicalName: 1 });

  return entities
    .filter((entity) =>
      getEntitySearchTokens(entity).some((token) => token.includes(normalizedQuery))
    )
    .sort((left, right) => {
      const scoreDelta =
        scoreEntityMatch(left, normalizedQuery) -
        scoreEntityMatch(right, normalizedQuery);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.canonicalName.localeCompare(right.canonicalName);
    })
    .slice(0, limit)
    .map((entity) => ({
      id: entity.publicId,
      type: entity.type,
      canonicalName: entity.canonicalName,
      aliases: serializeAliasEntries(entity.aliases ?? []),
      latestStats: entity.latestStats ?? {}
    }));
};

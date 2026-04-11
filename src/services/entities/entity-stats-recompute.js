import { extractCharactersFromSceneDocument } from './character-extract.js';
import { extractLocationsFromSceneDocument } from './location-extract.js';

const createAggregate = (type) => ({
  type,
  sceneIds: new Set(),
  scriptIds: new Set(),
  dialogueBlockCount: 0,
  dialogueLineCount: 0,
  sceneOccurrences: new Map()
});

const ensureOccurrence = (aggregate, sceneSource) => {
  const existing = aggregate.sceneOccurrences.get(sceneSource.sceneId);
  if (existing) {
    return existing;
  }

  const nextOccurrence = {
    sceneId: sceneSource.sceneId,
    scriptId: sceneSource.scriptId,
    dialogueBlockCount: 0,
    dialogueLineCount: 0
  };
  aggregate.sceneOccurrences.set(sceneSource.sceneId, nextOccurrence);
  return nextOccurrence;
};

const materializeLatestStats = (aggregate) => {
  const sceneOccurrences = [...aggregate.sceneOccurrences.values()].sort((left, right) => {
    if (left.scriptId === right.scriptId) {
      return left.sceneId.localeCompare(right.sceneId);
    }

    return left.scriptId.localeCompare(right.scriptId);
  });

  const baseStats = {
    sceneCount: aggregate.sceneIds.size,
    scriptCount: aggregate.scriptIds.size,
    sceneIds: [...aggregate.sceneIds].sort(),
    scriptIds: [...aggregate.scriptIds].sort(),
    sceneOccurrences
  };

  if (aggregate.type === 'character') {
    return {
      ...baseStats,
      dialogueBlockCount: aggregate.dialogueBlockCount,
      dialogueLineCount: aggregate.dialogueLineCount
    };
  }

  return baseStats;
};

export const recomputeEntityLatestStats = ({
  sceneSources,
  resolveEntity
}) => {
  const aggregates = new Map();

  sceneSources.forEach((sceneSource) => {
    const characters = extractCharactersFromSceneDocument(sceneSource.document);
    characters.forEach((character) => {
      const entity = resolveEntity('character', character);
      if (!entity) {
        return;
      }

      const aggregate = aggregates.get(entity.publicId) ?? createAggregate('character');
      const occurrence = ensureOccurrence(aggregate, sceneSource);

      aggregate.sceneIds.add(sceneSource.sceneId);
      aggregate.scriptIds.add(sceneSource.scriptId);
      aggregate.dialogueBlockCount += character.dialogueBlockCount;
      aggregate.dialogueLineCount += character.dialogueLineCount;
      occurrence.dialogueBlockCount += character.dialogueBlockCount;
      occurrence.dialogueLineCount += character.dialogueLineCount;
      aggregates.set(entity.publicId, aggregate);
    });

    const locations = extractLocationsFromSceneDocument(sceneSource.document);
    locations.forEach((location) => {
      const entity = resolveEntity('location', location);
      if (!entity) {
        return;
      }

      const aggregate = aggregates.get(entity.publicId) ?? createAggregate('location');
      ensureOccurrence(aggregate, sceneSource);
      aggregate.sceneIds.add(sceneSource.sceneId);
      aggregate.scriptIds.add(sceneSource.scriptId);
      aggregates.set(entity.publicId, aggregate);
    });
  });

  return new Map(
    [...aggregates.entries()].map(([entityPublicId, aggregate]) => [
      entityPublicId,
      materializeLatestStats(aggregate)
    ])
  );
};

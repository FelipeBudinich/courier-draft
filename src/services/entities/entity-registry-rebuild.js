import {
  OutlineNode,
  ProjectEntity,
  Scene,
  Script
} from '../../models/index.js';
import { getSceneHeadDocument } from '../scenes/legacy-document.js';

import { extractCharactersFromSceneDocument } from './character-extract.js';
import { buildEntityResolutionIndex, resolveEntityCandidate } from './entity-resolve.js';
import { recomputeEntityLatestStats } from './entity-stats-recompute.js';
import { normalizeEntityName } from './entity-normalize.js';
import { extractLocationsFromSceneDocument } from './location-extract.js';

const idString = (value) => (value ? String(value) : null);

export const createEmptyLatestStats = (type) =>
  type === 'character'
    ? {
        sceneCount: 0,
        scriptCount: 0,
        dialogueLineCount: 0,
        dialogueBlockCount: 0,
        sceneIds: [],
        scriptIds: [],
        sceneOccurrences: []
      }
    : {
        sceneCount: 0,
        scriptCount: 0,
        sceneIds: [],
        scriptIds: [],
        sceneOccurrences: []
      };

const loadProjectSceneSources = async ({ projectId }) => {
  const [scripts, outlineNodes] = await Promise.all([
    Script.find({ projectId }).select('publicId title'),
    OutlineNode.find({
      projectId,
      type: 'scene',
      sceneId: {
        $ne: null
      }
    })
      .select(
        'sceneId scriptId title manualSceneNumber autoSceneNumber positionKey'
      )
      .sort({ scriptId: 1, positionKey: 1 })
  ]);

  if (!outlineNodes.length) {
    return [];
  }

  const scenes = await Scene.find({
    projectId,
    _id: {
      $in: outlineNodes.map((node) => node.sceneId)
    }
  }).select('publicId title headDocument headContent structuredBody');

  const scriptsById = new Map(scripts.map((script) => [idString(script._id), script]));
  const scenesById = new Map(scenes.map((scene) => [idString(scene._id), scene]));

  return outlineNodes
    .map((node) => {
      const scene = scenesById.get(idString(node.sceneId));
      const script = scriptsById.get(idString(node.scriptId));

      if (!scene || !script) {
        return null;
      }

      return {
        sceneId: scene.publicId,
        sceneTitle: scene.title,
        scriptId: script.publicId,
        scriptTitle: script.title,
        displaySceneNumber: node.manualSceneNumber ?? node.autoSceneNumber ?? null,
        document: getSceneHeadDocument(scene)
      };
    })
    .filter(Boolean);
};

const collectDiscoveredCanonicalCandidates = (sceneSources) => {
  const candidates = {
    character: new Map(),
    location: new Map()
  };

  sceneSources.forEach((sceneSource) => {
    extractCharactersFromSceneDocument(sceneSource.document).forEach((character) => {
      candidates.character.set(character.normalizedKey, {
        type: 'character',
        canonicalName: character.display,
        normalizedKey: character.normalizedKey
      });
    });

    extractLocationsFromSceneDocument(sceneSource.document).forEach((location) => {
      candidates.location.set(location.normalizedKey, {
        type: 'location',
        canonicalName: location.display,
        normalizedKey: location.normalizedKey
      });
    });
  });

  return candidates;
};

const createMissingCanonicalEntities = async ({
  projectId,
  sceneSources,
  entities
}) => {
  const resolutionIndex = buildEntityResolutionIndex(entities);
  const discoveredCandidates = collectDiscoveredCanonicalCandidates(sceneSources);
  const missingEntities = [];

  ['character', 'location'].forEach((type) => {
    discoveredCandidates[type].forEach((candidate) => {
      const normalizedCandidate = normalizeEntityName(type, candidate.canonicalName, {
        preserveCase: type === 'location'
      });

      if (!normalizedCandidate) {
        return;
      }

      if (
        resolveEntityCandidate({
          index: resolutionIndex,
          type,
          normalizedKey: normalizedCandidate.normalizedKey
        })
      ) {
        return;
      }

      missingEntities.push({
        projectId,
        type,
        canonicalName: normalizedCandidate.display,
        normalizedKey: normalizedCandidate.normalizedKey,
        aliases: [],
        mergedIntoId: null,
        latestStats: createEmptyLatestStats(type)
      });

      resolutionIndex.byType[type].canonicalByKey.set(
        normalizedCandidate.normalizedKey,
        {
          publicId: `pending:${type}:${normalizedCandidate.normalizedKey}`,
          type,
          canonicalName: normalizedCandidate.display,
          normalizedKey: normalizedCandidate.normalizedKey,
          aliases: [],
          mergedIntoId: null
        }
      );
    });
  });

  if (!missingEntities.length) {
    return entities;
  }

  const createdEntities = await ProjectEntity.create(missingEntities);
  return [...entities, ...createdEntities];
};

export const rebuildProjectEntityRegistry = async ({ projectId }) => {
  const sceneSources = await loadProjectSceneSources({
    projectId
  });
  let entities = await ProjectEntity.find({ projectId }).sort({
    createdAt: 1
  });

  entities = await createMissingCanonicalEntities({
    projectId,
    sceneSources,
    entities
  });

  const resolutionIndex = buildEntityResolutionIndex(entities);
  const latestStatsByEntityPublicId = recomputeEntityLatestStats({
    sceneSources,
    resolveEntity(type, candidate) {
      return resolveEntityCandidate({
        index: resolutionIndex,
        type,
        normalizedKey: candidate.normalizedKey
      });
    }
  });

  const bulkUpdates = entities
    .map((entity) => {
      const nextLatestStats = entity.mergedIntoId
        ? createEmptyLatestStats(entity.type)
        : latestStatsByEntityPublicId.get(entity.publicId) ??
          createEmptyLatestStats(entity.type);

      if (
        JSON.stringify(entity.latestStats ?? {}) === JSON.stringify(nextLatestStats)
      ) {
        return null;
      }

      return {
        updateOne: {
          filter: {
            _id: entity._id
          },
          update: {
            $set: {
              latestStats: nextLatestStats
            }
          }
        }
      };
    })
    .filter(Boolean);

  if (bulkUpdates.length) {
    await ProjectEntity.bulkWrite(bulkUpdates);
  }

  return {
    entities: await ProjectEntity.find({ projectId }).sort({ createdAt: 1 }),
    sceneSources
  };
};

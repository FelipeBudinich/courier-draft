import mongoose from 'mongoose';

import { badRequest, conflict, notFound } from '../../config/errors.js';
import { findScriptByPublicId } from '../../models/lookups.js';
import {
  OutlineNode,
  ProjectEntity,
  Scene,
  Script
} from '../../models/index.js';
import {
  buildActivityBroadcast,
  createActivityEvent
} from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import { emitToProjectRoom } from '../realtime/broadcaster.js';

import { listEntityAutocompleteSuggestions } from './entity-autocomplete.js';
import { createEmptyLatestStats, rebuildProjectEntityRegistry } from './entity-registry-rebuild.js';
import {
  collectEntityNameCollisions,
  buildEntityResolutionIndex
} from './entity-resolve.js';
import {
  getEntitySearchTokens,
  mergeAliasEntries,
  normalizeEntityAliasList,
  normalizeEntityName,
  normalizeEntitySearchQuery,
  serializeAliasEntries
} from './entity-normalize.js';

const ENTITY_ACTIVITY_MESSAGES = {
  created: ({ actor, entity }) =>
    `${actor.displayName} created ${entity.type} ${entity.canonicalName}.`,
  updated: ({ actor, entity }) =>
    `${actor.displayName} updated ${entity.type} ${entity.canonicalName}.`,
  merged: ({ actor, sourceEntity, targetEntity }) =>
    `${actor.displayName} merged ${sourceEntity.canonicalName} into ${targetEntity.canonicalName}.`
};

const getLatestStatsForScript = (type, latestStats = {}, scriptId = null) => {
  const sceneOccurrences = Array.isArray(latestStats.sceneOccurrences)
    ? latestStats.sceneOccurrences
    : [];

  if (!scriptId) {
    return {
      ...createEmptyLatestStats(type),
      ...latestStats,
      sceneOccurrences
    };
  }

  const filteredOccurrences = sceneOccurrences.filter(
    (occurrence) => occurrence.scriptId === scriptId
  );
  const sceneIds = [...new Set(filteredOccurrences.map((occurrence) => occurrence.sceneId))];
  const scriptIds = [...new Set(filteredOccurrences.map((occurrence) => occurrence.scriptId))];

  if (type === 'character') {
    return {
      sceneCount: sceneIds.length,
      scriptCount: scriptIds.length,
      dialogueLineCount: filteredOccurrences.reduce(
        (sum, occurrence) => sum + (occurrence.dialogueLineCount ?? 0),
        0
      ),
      dialogueBlockCount: filteredOccurrences.reduce(
        (sum, occurrence) => sum + (occurrence.dialogueBlockCount ?? 0),
        0
      ),
      sceneIds,
      scriptIds,
      sceneOccurrences: filteredOccurrences
    };
  }

  return {
    sceneCount: sceneIds.length,
    scriptCount: scriptIds.length,
    sceneIds,
    scriptIds,
    sceneOccurrences: filteredOccurrences
  };
};

const loadOccurrenceMetadata = async ({ projectId, latestStatsRows }) => {
  const sceneIds = new Set();
  const scriptIds = new Set();

  latestStatsRows.forEach((row) => {
    (row.sceneOccurrences ?? []).forEach((occurrence) => {
      if (occurrence.sceneId) {
        sceneIds.add(occurrence.sceneId);
      }

      if (occurrence.scriptId) {
        scriptIds.add(occurrence.scriptId);
      }
    });
  });

  const [scenes, scripts] = await Promise.all([
    Scene.find({
      projectId,
      publicId: {
        $in: [...sceneIds]
      }
    }).select('publicId title'),
    Script.find({
      projectId,
      publicId: {
        $in: [...scriptIds]
      }
    }).select('publicId title')
  ]);

  const outlineNodes = scenes.length
    ? await OutlineNode.find({
        projectId,
        type: 'scene',
        sceneId: {
          $in: scenes.map((scene) => scene._id)
        }
      }).select('sceneId manualSceneNumber autoSceneNumber')
    : [];

  const scenesByPublicId = new Map(scenes.map((scene) => [scene.publicId, scene]));
  const scriptsByPublicId = new Map(scripts.map((script) => [script.publicId, script]));
  const sceneIdsByObjectId = new Map(scenes.map((scene) => [String(scene._id), scene.publicId]));
  const outlineByScenePublicId = new Map(
    outlineNodes.map((node) => [
      sceneIdsByObjectId.get(String(node.sceneId)),
      node
    ])
  );

  return {
    scenesByPublicId,
    scriptsByPublicId,
    outlineByScenePublicId
  };
};

const buildOccurrenceReadModels = (stats, metadata) =>
  (stats.sceneOccurrences ?? [])
    .map((occurrence) => {
      const scene = metadata.scenesByPublicId.get(occurrence.sceneId);
      const script = metadata.scriptsByPublicId.get(occurrence.scriptId);
      const outlineNode = metadata.outlineByScenePublicId.get(occurrence.sceneId);

      if (!scene || !script) {
        return null;
      }

      return {
        sceneId: occurrence.sceneId,
        sceneTitle: scene.title,
        scriptId: occurrence.scriptId,
        scriptTitle: script.title,
        displaySceneNumber:
          outlineNode?.manualSceneNumber ?? outlineNode?.autoSceneNumber ?? null,
        dialogueBlockCount: occurrence.dialogueBlockCount ?? 0,
        dialogueLineCount: occurrence.dialogueLineCount ?? 0
      };
    })
    .filter(Boolean);

const serializeEntityRow = ({
  projectPublicId,
  entity,
  stats,
  occurrenceMetadata
}) => {
  const occurrences = buildOccurrenceReadModels(stats, occurrenceMetadata).map(
    (occurrence) => ({
      ...occurrence,
      editorPath: `/projects/${projectPublicId}/scripts/${occurrence.scriptId}/editor?sceneId=${occurrence.sceneId}`
    })
  );

  return {
    id: entity.publicId,
    type: entity.type,
    canonicalName: entity.canonicalName,
    normalizedKey: entity.normalizedKey,
    aliases: serializeAliasEntries(entity.aliases ?? []),
    aliasDisplayString: (entity.aliases ?? []).map((alias) => alias.display).join(', '),
    mergedIntoId: entity.mergedIntoId?.publicId ?? null,
    mergedIntoCanonicalName: entity.mergedIntoId?.canonicalName ?? null,
    isMerged: Boolean(entity.mergedIntoId),
    latestStats: stats,
    occurrences
  };
};

const matchEntityQuery = (entity, q) => {
  const normalizedQuery = normalizeEntitySearchQuery(q);
  if (!normalizedQuery) {
    return true;
  }

  return getEntitySearchTokens(entity).some((token) => token.includes(normalizedQuery));
};

const sortMetricRows = (rows, type, sort) => {
  const metricKey =
    sort ||
    (type === 'character' ? 'dialogueLineCount' : 'sceneCount');

  return [...rows].sort((left, right) => {
    if (metricKey === 'canonicalName') {
      return left.canonicalName.localeCompare(right.canonicalName);
    }

    const leftValue = left.latestStats?.[metricKey] ?? 0;
    const rightValue = right.latestStats?.[metricKey] ?? 0;

    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }

    return left.canonicalName.localeCompare(right.canonicalName);
  });
};

const validateEntityIdentity = ({
  type,
  canonicalName,
  aliases,
  existingEntities,
  excludePublicIds = []
}) => {
  const normalizedCanonical = normalizeEntityName(type, canonicalName, {
    preserveCase: type === 'location'
  });

  if (!normalizedCanonical) {
    throw badRequest('Canonical name is required.');
  }

  const normalizedAliases = normalizeEntityAliasList(type, aliases).filter(
    (alias) => alias.normalizedKey !== normalizedCanonical.normalizedKey
  );
  const collisions = collectEntityNameCollisions({
    index: buildEntityResolutionIndex(existingEntities),
    type,
    normalizedKeys: [
      normalizedCanonical.normalizedKey,
      ...normalizedAliases.map((alias) => alias.normalizedKey)
    ],
    excludePublicIds
  });

  if (collisions.length) {
    throw conflict(
      `Another ${type} already uses one of those names or aliases.`
    );
  }

  return {
    canonical: normalizedCanonical,
    aliases: normalizedAliases
  };
};

const createEntityActivityAndAudit = async ({
  project,
  actor,
  type,
  entity,
  targetEntity = null,
  session
}) => {
  const payload =
    type === 'entity.merged'
      ? {
          targetType: 'entity',
          targetId: entity.publicId,
          entityType: entity.type,
          mergedIntoEntityId: targetEntity?.publicId ?? null
        }
      : {
          targetType: 'entity',
          targetId: entity.publicId,
          entityType: entity.type,
          canonicalName: entity.canonicalName
        };
  const message =
    type === 'entity.created'
      ? ENTITY_ACTIVITY_MESSAGES.created({ actor, entity })
      : type === 'entity.updated'
        ? ENTITY_ACTIVITY_MESSAGES.updated({ actor, entity })
        : ENTITY_ACTIVITY_MESSAGES.merged({
            actor,
            sourceEntity: entity,
            targetEntity
          });

  const activityEvent = await createActivityEvent({
    projectId: project._id,
    actorId: actor._id,
    type,
    message,
    payload,
    session
  });

  await createAuditLog({
    scope: 'project',
    projectId: project._id,
    actorId: actor._id,
    action: type,
    targetType: 'entity',
    targetId: entity.publicId,
    metadata: payload,
    session
  });

  return activityEvent;
};

const emitEntityActivity = ({
  projectPublicId,
  activityEvent,
  actor
}) => {
  emitToProjectRoom(
    projectPublicId,
    'activity:new',
    buildActivityBroadcast({
      event: activityEvent,
      actor,
      projectPublicId
    })
  );
};

export const loadProjectEntityPageScripts = async ({ projectId }) =>
  Script.find({ projectId })
    .select('publicId title')
    .sort({ title: 1 })
    .then((scripts) =>
      scripts.map((script) => ({
        id: script.publicId,
        title: script.title
      }))
    );

export const assertProjectScriptFilter = async ({ projectId, scriptPublicId }) => {
  if (!scriptPublicId) {
    return null;
  }

  const script = await findScriptByPublicId({
    projectId,
    scriptPublicId
  });
  if (!script) {
    throw notFound('Script not found.');
  }

  return script;
};

export const listProjectEntities = async ({
  project,
  type,
  q = '',
  scriptId = null,
  includeMerged = false
}) => {
  const entities = await ProjectEntity.find({
    projectId: project._id,
    type,
    ...(includeMerged ? {} : { mergedIntoId: null })
  })
    .populate('mergedIntoId', 'publicId canonicalName')
    .sort({ canonicalName: 1 });

  const filteredRows = entities
    .filter((entity) => matchEntityQuery(entity, q))
    .map((entity) => ({
      entity,
      stats: getLatestStatsForScript(type, entity.latestStats ?? {}, scriptId)
    }))
    .filter(({ stats }) => !scriptId || stats.sceneCount > 0);

  const occurrenceMetadata = await loadOccurrenceMetadata({
    projectId: project._id,
    latestStatsRows: filteredRows.map((row) => row.stats)
  });

  return filteredRows.map(({ entity, stats }) =>
    serializeEntityRow({
      projectPublicId: project.publicId,
      entity,
      stats,
      occurrenceMetadata
    })
  );
};

export const listProjectEntityMetrics = async ({
  project,
  type,
  q = '',
  scriptId = null,
  includeMerged = false,
  sort = null
}) => {
  const rows = await listProjectEntities({
    project,
    type,
    q,
    scriptId,
    includeMerged
  });

  return sortMetricRows(
    rows.filter((row) => (row.latestStats?.sceneCount ?? 0) > 0),
    type,
    sort
  );
};

export const createManualProjectEntity = async ({
  project,
  actor,
  type,
  canonicalName,
  aliases = []
}) => {
  const existingEntities = await ProjectEntity.find({
    projectId: project._id,
    type
  });
  const normalized = validateEntityIdentity({
    type,
    canonicalName,
    aliases,
    existingEntities
  });

  let entity = null;
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      [entity] = await ProjectEntity.create(
        [
          {
            projectId: project._id,
            type,
            canonicalName: normalized.canonical.display,
            normalizedKey: normalized.canonical.normalizedKey,
            aliases: normalized.aliases,
            mergedIntoId: null,
            latestStats: createEmptyLatestStats(type)
          }
        ],
        { session }
      );

      activityEvent = await createEntityActivityAndAudit({
        project,
        actor,
        type: 'entity.created',
        entity,
        session
      });
    });
  } finally {
    await session.endSession();
  }

  await rebuildProjectEntityRegistry({
    projectId: project._id
  });
  emitEntityActivity({
    projectPublicId: project.publicId,
    activityEvent,
    actor
  });

  return ProjectEntity.findById(entity._id).populate('mergedIntoId', 'publicId canonicalName');
};

export const updateManualProjectEntity = async ({
  project,
  actor,
  entity,
  canonicalName,
  aliases = []
}) => {
  if (entity.mergedIntoId) {
    throw badRequest('Merged entities cannot be edited directly.');
  }

  const existingEntities = await ProjectEntity.find({
    projectId: project._id,
    type: entity.type
  });
  const normalized = validateEntityIdentity({
    type: entity.type,
    canonicalName,
    aliases,
    existingEntities,
    excludePublicIds: [entity.publicId]
  });

  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      entity.canonicalName = normalized.canonical.display;
      entity.normalizedKey = normalized.canonical.normalizedKey;
      entity.aliases = normalized.aliases;
      await entity.save({ session });

      activityEvent = await createEntityActivityAndAudit({
        project,
        actor,
        type: 'entity.updated',
        entity,
        session
      });
    });
  } finally {
    await session.endSession();
  }

  await rebuildProjectEntityRegistry({
    projectId: project._id
  });
  emitEntityActivity({
    projectPublicId: project.publicId,
    activityEvent,
    actor
  });

  return ProjectEntity.findById(entity._id).populate('mergedIntoId', 'publicId canonicalName');
};

export const mergeProjectEntities = async ({
  project,
  actor,
  sourceEntity,
  targetEntity
}) => {
  if (sourceEntity.publicId === targetEntity.publicId) {
    throw badRequest('An entity cannot be merged into itself.');
  }

  if (sourceEntity.type !== targetEntity.type) {
    throw badRequest('Only entities of the same type can be merged.');
  }

  if (sourceEntity.mergedIntoId || targetEntity.mergedIntoId) {
    throw badRequest('Only active canonical entities can be merged.');
  }

  const mergedAliases = mergeAliasEntries(
    targetEntity.type,
    targetEntity.aliases ?? [],
    sourceEntity.aliases ?? [],
    [{ display: sourceEntity.canonicalName }]
  ).filter((alias) => alias.normalizedKey !== targetEntity.normalizedKey);

  const existingEntities = await ProjectEntity.find({
    projectId: project._id,
    type: targetEntity.type
  });
  const collisions = collectEntityNameCollisions({
    index: buildEntityResolutionIndex(existingEntities),
    type: targetEntity.type,
    normalizedKeys: mergedAliases.map((alias) => alias.normalizedKey),
    excludePublicIds: [sourceEntity.publicId, targetEntity.publicId]
  });

  if (collisions.length) {
    throw conflict('One of the merged aliases is already used by another entity.');
  }

  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      targetEntity.aliases = mergedAliases;
      await targetEntity.save({ session });

      sourceEntity.mergedIntoId = targetEntity._id;
      await sourceEntity.save({ session });

      activityEvent = await createEntityActivityAndAudit({
        project,
        actor,
        type: 'entity.merged',
        entity: sourceEntity,
        targetEntity,
        session
      });
    });
  } finally {
    await session.endSession();
  }

  await rebuildProjectEntityRegistry({
    projectId: project._id
  });
  emitEntityActivity({
    projectPublicId: project.publicId,
    activityEvent,
    actor
  });

  return {
    sourceEntity: await ProjectEntity.findById(sourceEntity._id).populate(
      'mergedIntoId',
      'publicId canonicalName'
    ),
    targetEntity: await ProjectEntity.findById(targetEntity._id).populate(
      'mergedIntoId',
      'publicId canonicalName'
    )
  };
};

export const buildProjectEntityPageModel = async ({
  project,
  projectRole,
  type,
  q = '',
  scriptId = null,
  includeMerged = false,
  sort = null
}) => {
  const [rows, scripts] = await Promise.all([
    listProjectEntities({
      project,
      type,
      q,
      scriptId,
      includeMerged
    }),
    loadProjectEntityPageScripts({
      projectId: project._id
    })
  ]);
  const sortedRows = sortMetricRows(rows, type, sort);

  return {
    project: {
      id: project.publicId,
      title: project.name
    },
    type,
    filters: {
      q,
      scriptId,
      includeMerged,
      sort:
        sort || (type === 'character' ? 'dialogueLineCount' : 'sceneCount')
    },
    scripts,
    rows: sortedRows,
    activeCanonicalCount: sortedRows.filter((row) => !row.isMerged).length,
    permissions: {
      canManage: ['owner', 'editor'].includes(projectRole)
    }
  };
};

export const getEntityAutocompleteSuggestions = async ({
  project,
  type,
  q
}) =>
  listEntityAutocompleteSuggestions({
    projectId: project._id,
    type,
    q
  });

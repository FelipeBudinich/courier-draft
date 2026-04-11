import mongoose from 'mongoose';

import { badRequest } from '../../config/errors.js';
import {
  DocumentVersion,
  Note,
  OutlineNode,
  Scene,
  Script,
  ScriptVersion
} from '../../models/index.js';
import { createActivityEvent } from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import { synchronizeSceneNumbering, getOutlineReadModel, getScriptActivitySummary } from '../outline/service.js';
import { emitToScriptRoom } from '../realtime/broadcaster.js';
import {
  buildScriptActivityMessage,
  emitScriptActivity,
  normalizeScriptMetadataInput,
  serializeScript
} from './helpers.js';

const SCENE_NUMBER_MODES = new Set(['off', 'auto', 'frozen']);

const hydrateScript = async ({ scriptId, session = null }) => {
  const query = Script.findById(scriptId)
    .populate('projectId', 'publicId name')
    .populate('createdByUserId', 'publicId username displayName')
    .populate('updatedByUserId', 'publicId username displayName');

  if (session) {
    query.session(session);
  }

  return query;
};

const loadScriptCounts = async ({ projectId }) => {
  const counts = await OutlineNode.aggregate([
    {
      $match: {
        projectId
      }
    },
    {
      $group: {
        _id: '$scriptId',
        totalNodes: { $sum: 1 },
        actCount: {
          $sum: {
            $cond: [{ $eq: ['$type', 'act'] }, 1, 0]
          }
        },
        beatCount: {
          $sum: {
            $cond: [{ $eq: ['$type', 'beat'] }, 1, 0]
          }
        },
        sceneCount: {
          $sum: {
            $cond: [{ $eq: ['$type', 'scene'] }, 1, 0]
          }
        }
      }
    }
  ]);

  return new Map(counts.map((count) => [String(count._id), count]));
};

const validateScriptTitle = (title) => {
  if (!title) {
    throw badRequest('Script title is required.');
  }
};

const createScriptActivityAndAudit = async ({
  project,
  actor,
  script,
  type,
  session,
  metadata = {}
}) => {
  const activityEvent = await createActivityEvent({
    projectId: project._id,
    actorId: actor._id,
    type,
    message: buildScriptActivityMessage({
      type,
      actor,
      scriptTitle: script.title,
      sceneNumberMode: script.sceneNumberMode
    }),
    payload: {
      targetType: 'script',
      targetId: script.publicId,
      scriptId: script.publicId,
      ...metadata
    },
    session
  });

  await createAuditLog({
    scope: 'project',
    projectId: project._id,
    actorId: actor._id,
    action: type,
    targetType: 'script',
    targetId: script.publicId,
    metadata: {
      title: script.title,
      ...metadata
    },
    session
  });

  return activityEvent;
};

export const listProjectScriptsReadModel = async ({ projectId }) => {
  const [scripts, countsByScriptId] = await Promise.all([
    Script.find({ projectId })
      .populate('projectId', 'publicId name')
      .populate('createdByUserId', 'publicId username displayName')
      .populate('updatedByUserId', 'publicId username displayName')
      .sort({ updatedAt: -1 }),
    loadScriptCounts({ projectId })
  ]);

  return scripts.map((script) =>
    serializeScript(script, countsByScriptId.get(String(script._id)))
  );
};

export const getScriptDetailReadModel = async ({
  project,
  script,
  projectRole
}) => {
  const hydratedScript = await hydrateScript({
    scriptId: script._id
  });
  const [outline, activity, latestCheckpoint] = await Promise.all([
    getOutlineReadModel({
      script: hydratedScript
    }),
    getScriptActivitySummary({
      projectId: project._id,
      scriptPublicId: hydratedScript.publicId,
      limit: 10
    }),
    ScriptVersion.findOne({
      scriptId: hydratedScript._id
    })
      .select('createdAt')
      .sort({ createdAt: -1, majorSaveSequence: -1 })
  ]);
  const countsByScriptId = await loadScriptCounts({
    projectId: project._id
  });

  return {
    script: serializeScript(
      hydratedScript,
      countsByScriptId.get(String(hydratedScript._id)),
      {
        lastCheckpointAt: latestCheckpoint?.createdAt ?? null
      }
    ),
    outline: outline.nodes,
    activity,
    permissions: {
      canEdit: ['owner', 'editor'].includes(projectRole),
      canDelete: projectRole === 'owner',
      canExport: ['owner', 'editor', 'reviewer'].includes(projectRole)
    }
  };
};

export const createScript = async ({
  project,
  actor,
  input
}) => {
  const normalizedInput = normalizeScriptMetadataInput(input);
  validateScriptTitle(normalizedInput.title);

  let script = null;
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      [script] = await Script.create(
        [
          {
            projectId: project._id,
            title: normalizedInput.title,
            description: normalizedInput.description,
            genre: normalizedInput.genre,
            status: normalizedInput.status,
            language: normalizedInput.language,
            authors: normalizedInput.authors,
            majorSaveSequence: normalizedInput.majorSaveSequence ?? 0,
            currentVersionLabel: normalizedInput.currentVersionLabel || null,
            sceneNumberMode: 'auto',
            createdByUserId: actor._id,
            updatedByUserId: actor._id
          }
        ],
        { session }
      );

      activityEvent = await createScriptActivityAndAudit({
        project,
        actor,
        script,
        type: 'script.created',
        session,
        metadata: {
          changedFields: ['title', 'description', 'genre', 'status', 'language', 'authors']
        }
      });
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });

  return hydrateScript({
    scriptId: script._id
  });
};

export const updateScriptMetadata = async ({
  project,
  script,
  actor,
  input
}) => {
  const normalizedInput = normalizeScriptMetadataInput(input);
  validateScriptTitle(normalizedInput.title);

  const changedFields = [];
  const fieldNames = ['title', 'description', 'genre', 'status', 'language', 'authors'];

  fieldNames.forEach((fieldName) => {
    const nextValue = normalizedInput[fieldName];
    const previousValue = script[fieldName] ?? (fieldName === 'authors' ? [] : '');
    const changed =
      Array.isArray(nextValue)
        ? JSON.stringify(nextValue) !== JSON.stringify(previousValue)
        : nextValue !== previousValue;

    if (changed) {
      changedFields.push(fieldName);
      script[fieldName] = nextValue;
    }
  });

  if (!changedFields.length) {
    return hydrateScript({
      scriptId: script._id
    });
  }

  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      script.updatedByUserId = actor._id;
      await script.save({ session });

      activityEvent = await createScriptActivityAndAudit({
        project,
        actor,
        script,
        type: 'script.updated',
        session,
        metadata: {
          changedFields
        }
      });
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
  emitToScriptRoom(script.publicId, 'script:updated', {
    scriptId: script.publicId,
    changedFields,
    actor: {
      userId: actor.publicId,
      username: actor.username ?? null
    },
    ts: new Date().toISOString()
  });

  return hydrateScript({
    scriptId: script._id
  });
};

export const updateSceneNumberMode = async ({
  project,
  script,
  actor,
  sceneNumberMode
}) => {
  if (!SCENE_NUMBER_MODES.has(sceneNumberMode)) {
    throw badRequest('Scene numbering mode must be off, auto, or frozen.');
  }

  let activityEvent = null;
  let renumberedNodeIds = [];

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      script.sceneNumberMode = sceneNumberMode;
      script.updatedByUserId = actor._id;
      await script.save({ session });

      const numberingResult = await synchronizeSceneNumbering({
        script,
        session
      });

      renumberedNodeIds = numberingResult.renumberedNodeIds;
      activityEvent = await createScriptActivityAndAudit({
        project,
        actor,
        script,
        type: 'script.scene_numbering_changed',
        session,
        metadata: {
          sceneNumberMode,
          renumberedNodeIds
        }
      });
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
  emitToScriptRoom(script.publicId, 'script:updated', {
    scriptId: script.publicId,
    changedFields: ['sceneNumberMode'],
    actor: {
      userId: actor.publicId,
      username: actor.username ?? null
    },
    ts: new Date().toISOString()
  });
  if (renumberedNodeIds.length) {
    emitToScriptRoom(script.publicId, 'outline:changed', {
      projectId: project.publicId,
      scriptId: script.publicId,
      op: 'renumbered',
      actor: {
        userId: actor.publicId,
        username: actor.username ?? null
      },
      renumberedNodeIds,
      ts: new Date().toISOString()
    });
  }

  return hydrateScript({
    scriptId: script._id
  });
};

export const deleteScript = async ({
  project,
  script,
  actor
}) => {
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const scenes = await Scene.find({
        scriptId: script._id
      })
        .select('_id')
        .session(session);
      const sceneIds = scenes.map((scene) => scene._id);
      const notes = await Note.find({
        scriptId: script._id
      })
        .select('_id')
        .session(session);
      const noteIds = notes.map((note) => note._id);

      await Promise.all([
        DocumentVersion.deleteMany({
          docType: 'scene',
          docId: { $in: sceneIds }
        }).session(session),
        noteIds.length
          ? DocumentVersion.deleteMany({
              docType: 'note',
              docId: { $in: noteIds }
            }).session(session)
          : Promise.resolve(),
        Note.deleteMany({
          scriptId: script._id
        }).session(session),
        ScriptVersion.deleteMany({
          scriptId: script._id
        }).session(session),
        Scene.deleteMany({
          scriptId: script._id
        }).session(session),
        OutlineNode.deleteMany({
          scriptId: script._id
        }).session(session)
      ]);

      activityEvent = await createScriptActivityAndAudit({
        project,
        actor,
        script,
        type: 'script.deleted',
        session,
        metadata: {
          deletedSceneCount: sceneIds.length,
          deletedNoteCount: noteIds.length
        }
      });

      await Script.deleteOne({
        _id: script._id
      }).session(session);
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });

  return {
    deleted: true,
    scriptId: script.publicId
  };
};

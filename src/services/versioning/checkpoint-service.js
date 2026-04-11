import mongoose from 'mongoose';

import { noChangesToSave, notFound } from '../../config/errors.js';
import {
  DocumentVersion,
  Note,
  Scene,
  Script,
  ScriptVersion
} from '../../models/index.js';
import { buildActivityBroadcast, createActivityEvent } from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import { noteSessionManager } from '../collab/note-session-manager.js';
import { sceneSessionManager } from '../collab/scene-session-manager.js';
import {
  emitToNoteRoom,
  emitToProjectRoom,
  emitToSceneRoom,
  emitToScriptRoom
} from '../realtime/broadcaster.js';
import {
  createImmutableDocumentVersion,
  hasDocumentChangedSinceMajorVersion,
  listDocumentVersions,
  resolveNoteCurrentHeadState,
  resolveSceneCurrentHeadState,
  serializeDocumentVersionDetail,
  serializeDocumentVersionSummary,
  setDocumentCurrentMajorVersion
} from './document-snapshot-service.js';
import { buildScriptCheckpointVersionLabel } from './version-label-service.js';

const serializeActor = (actor) => ({
  userId: actor.publicId,
  username: actor.username ?? null
});

const buildCheckpointSummary = (snapshotRefs) => {
  const changedScenes = snapshotRefs.filter((entry) => entry.docType === 'scene').length;
  const changedNotes = snapshotRefs.filter((entry) => entry.docType === 'note').length;

  return {
    snapshotCount: snapshotRefs.length,
    changedScenes,
    changedNotes
  };
};

const buildActivityMessage = ({
  type,
  actor,
  script = null,
  scene = null
}) => {
  switch (type) {
    case 'script.major_saved':
      return `${actor.displayName} created script checkpoint ${script?.currentVersionLabel ?? ''}.`.trim();
    case 'scene.major_saved':
      return `${actor.displayName} created a major save for ${scene?.title ?? 'this scene'}.`;
    case 'note.major_saved':
      return `${actor.displayName} created a major save for a note.`;
    default:
      return `${actor.displayName} saved a new version.`;
  }
};

const createVersionActivityAndAudit = async ({
  project,
  actor,
  type,
  script = null,
  scene = null,
  note = null,
  scriptVersion = null,
  documentVersion = null,
  session = null
}) => {
  const targetType =
    type === 'script.major_saved'
      ? 'script'
      : note
        ? 'note'
        : 'scene';
  const targetId =
    type === 'script.major_saved'
      ? script.publicId
      : note?.publicId ?? scene?.publicId ?? null;
  const payload = {
    targetType,
    targetId,
    scriptId: script?.publicId ?? null,
    scriptVersionId: scriptVersion?.publicId ?? null,
    versionId: documentVersion?.publicId ?? null,
    versionLabel:
      scriptVersion?.versionLabel ??
      documentVersion?.versionLabel ??
      null
  };
  const activityEvent = await createActivityEvent({
    projectId: project._id,
    actorId: actor._id,
    type,
    message: buildActivityMessage({
      type,
      actor,
      script,
      scene
    }),
    payload,
    session
  });

  await createAuditLog({
    scope: 'project',
    projectId: project._id,
    actorId: actor._id,
    action: type,
    targetType,
    targetId,
    metadata: payload,
    session
  });

  return activityEvent;
};

const emitVersionActivity = ({
  projectPublicId,
  scriptPublicId = null,
  activityEvent,
  actor
}) => {
  const payload = buildActivityBroadcast({
    event: activityEvent,
    actor,
    projectPublicId
  });

  emitToProjectRoom(projectPublicId, 'activity:new', payload);

  if (scriptPublicId) {
    emitToScriptRoom(scriptPublicId, 'activity:new', payload);
  }
};

const emitDocumentVersionCreated = ({
  actor,
  document,
  version
}) => {
  const payload = {
    [`${version.docType}Id`]: document.publicId,
    versionId: version.publicId,
    versionLabel: version.versionLabel ?? null,
    actor: serializeActor(actor),
    ts: new Date().toISOString()
  };

  if (version.docType === 'scene') {
    emitToSceneRoom(document.publicId, 'scene:version-created', payload);
    return;
  }

  emitToNoteRoom(document.publicId, 'note:version-created', payload);
};

const emitScriptCheckpointUpdate = ({
  actor,
  script,
  changedFields = ['majorSaveSequence', 'currentVersionLabel']
}) => {
  emitToScriptRoom(script.publicId, 'script:updated', {
    scriptId: script.publicId,
    changedFields,
    actor: serializeActor(actor),
    ts: new Date().toISOString()
  });
};

const buildSnapshotRef = ({
  docType,
  document,
  version
}) => ({
  docType,
  docId: document._id,
  versionId: version._id
});

const resolveChangedSceneTargets = async ({ scenes }) => {
  const results = [];

  for (const scene of scenes) {
    const currentHeadState = await resolveSceneCurrentHeadState({
      scene,
      flushLive: true
    });
    const { changed } = await hasDocumentChangedSinceMajorVersion({
      docType: 'scene',
      document: scene,
      currentHeadState
    });

    if (changed) {
      results.push({
        docType: 'scene',
        document: scene,
        currentHeadState
      });
    }
  }

  return results;
};

const resolveChangedNoteTargets = async ({ notes }) => {
  const results = [];

  for (const note of notes) {
    const currentHeadState = await resolveNoteCurrentHeadState({
      note,
      flushLive: true
    });
    const { changed } = await hasDocumentChangedSinceMajorVersion({
      docType: 'note',
      document: note,
      currentHeadState
    });

    if (changed) {
      results.push({
        docType: 'note',
        document: note,
        currentHeadState
      });
    }
  }

  return results;
};

const createCheckpointAndSnapshots = async ({
  project,
  script,
  actor,
  scopeType,
  scopeRefId = null,
  labelScene = null,
  labelNote = null,
  snapshotTargets,
  activityType
}) => {
  const mongoSession = await mongoose.startSession();
  let scriptVersion = null;
  let createdVersions = [];
  let activityEvent = null;
  const nextMajorSaveSequence = (script.majorSaveSequence ?? 0) + 1;
  const versionLabel = await buildScriptCheckpointVersionLabel({
    script,
    majorSaveSequence: nextMajorSaveSequence,
    scopeType,
    scene: labelScene,
    note: labelNote,
    session: mongoSession
  });

  try {
    await mongoSession.withTransaction(async () => {
      [scriptVersion] = await ScriptVersion.create(
        [
          {
            projectId: project._id,
            scriptId: script._id,
            majorSaveSequence: nextMajorSaveSequence,
            versionLabel,
            createdByUserId: actor._id,
            createdAt: new Date(),
            scopeType,
            scopeRefId,
            snapshotRefs: [],
            summary: {}
          }
        ],
        { session: mongoSession }
      );

      createdVersions = [];
      for (const target of snapshotTargets) {
        const version = await createImmutableDocumentVersion({
          docType: target.docType,
          document: target.document,
          currentHeadState: target.currentHeadState,
          actorId: actor._id,
          snapshotType: 'major',
          scriptVersionId: scriptVersion._id,
          versionLabel,
          session: mongoSession
        });

        await setDocumentCurrentMajorVersion({
          docType: target.docType,
          documentId: target.document._id,
          versionId: version._id,
          session: mongoSession
        });
        createdVersions.push({
          ...target,
          version
        });
      }

      await Script.updateOne(
        {
          _id: script._id
        },
        {
          $set: {
            majorSaveSequence: nextMajorSaveSequence,
            currentVersionLabel: versionLabel,
            updatedByUserId: actor._id
          }
        },
        {
          session: mongoSession
        }
      );

      script.majorSaveSequence = nextMajorSaveSequence;
      script.currentVersionLabel = versionLabel;
      script.updatedByUserId = actor._id;

      scriptVersion.snapshotRefs = createdVersions.map((entry) =>
        buildSnapshotRef({
          docType: entry.docType,
          document: entry.document,
          version: entry.version
        })
      );
      scriptVersion.summary = buildCheckpointSummary(scriptVersion.snapshotRefs);
      await scriptVersion.save({ session: mongoSession });

      activityEvent = await createVersionActivityAndAudit({
        project,
        actor,
        type: activityType,
        script,
        scene: labelScene,
        note: labelNote,
        scriptVersion,
        documentVersion:
          createdVersions.length === 1
            ? createdVersions[0].version
            : null,
        session: mongoSession
      });
    });
  } finally {
    await mongoSession.endSession();
  }

  emitScriptCheckpointUpdate({
    actor,
    script
  });
  emitVersionActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
  createdVersions.forEach(({ document, version }) => {
    if (version.docType === 'scene') {
      sceneSessionManager.updateCurrentMajorVersionId(
        document.publicId,
        version.publicId
      );
    } else {
      noteSessionManager.updateCurrentMajorVersionId(
        document.publicId,
        version.publicId
      );
    }

    emitDocumentVersionCreated({
      actor,
      document,
      version
    });
  });

  return {
    scriptVersion,
    createdVersions,
    versionLabel
  };
};

const serializeUser = (user) =>
  user
    ? {
        userId: user.publicId,
        username: user.username ?? null,
        displayName: user.displayName ?? null
      }
    : null;

export const serializeScriptVersionSummary = (version) => ({
  id: version.publicId,
  majorSaveSequence: version.majorSaveSequence,
  versionLabel: version.versionLabel,
  scopeType: version.scopeType,
  createdAt: version.createdAt,
  snapshotCount: version.snapshotRefs?.length ?? 0,
  summary: version.summary ?? {},
  createdBy: serializeUser(version.createdByUserId)
});

export const listScriptVersionCheckpoints = async ({ script }) => {
  const versions = await ScriptVersion.find({
    scriptId: script._id
  })
    .populate('createdByUserId', 'publicId username displayName')
    .sort({ createdAt: -1, majorSaveSequence: -1 });

  return versions.map((version) => serializeScriptVersionSummary(version));
};

export const getScriptVersionCheckpointDetail = async ({
  project,
  script,
  scriptVersionId
}) => {
  const version = await ScriptVersion.findOne({
    projectId: project._id,
    scriptId: script._id,
    publicId: scriptVersionId
  }).populate('createdByUserId', 'publicId username displayName');

  if (!version) {
    throw notFound('Script version not found.');
  }

  const [scenes, notes] = await Promise.all([
    Scene.find({
      _id: {
        $in: version.snapshotRefs
          .filter((entry) => entry.docType === 'scene')
          .map((entry) => entry.docId)
      }
    }).select('publicId title'),
    Note.find({
      _id: {
        $in: version.snapshotRefs
          .filter((entry) => entry.docType === 'note')
          .map((entry) => entry.docId)
      }
    }).select('publicId headText')
  ]);
  const scenesById = new Map(scenes.map((scene) => [String(scene._id), scene]));
  const notesById = new Map(notes.map((note) => [String(note._id), note]));
  const versionIds = version.snapshotRefs.map((entry) => String(entry.versionId));
  const linkedVersions = await DocumentVersion.find({
    _id: { $in: versionIds }
  });
  const linkedVersionsById = new Map(linkedVersions.map((entry) => [String(entry._id), entry]));

  return {
    ...serializeScriptVersionSummary(version),
    snapshotRefs: version.snapshotRefs.map((entry) => ({
      docType: entry.docType,
      docId:
        entry.docType === 'scene'
          ? scenesById.get(String(entry.docId))?.publicId ?? null
          : notesById.get(String(entry.docId))?.publicId ?? null,
      versionId: linkedVersionsById.get(String(entry.versionId))?.publicId ?? null,
      versionLabel: linkedVersionsById.get(String(entry.versionId))?.versionLabel ?? null
    }))
  };
};

export const majorSaveScript = async ({
  project,
  script,
  actor
}) => {
  const [scenes, notes] = await Promise.all([
    Scene.find({ scriptId: script._id }),
    Note.find({ scriptId: script._id })
  ]);
  const snapshotTargets = [
    ...(await resolveChangedSceneTargets({ scenes })),
    ...(await resolveChangedNoteTargets({ notes }))
  ];

  if (!snapshotTargets.length) {
    throw noChangesToSave('No changed scenes or notes are available for a script checkpoint.');
  }

  return createCheckpointAndSnapshots({
    project,
    script,
    actor,
    scopeType: 'script',
    snapshotTargets,
    activityType: 'script.major_saved'
  });
};

export const majorSaveScene = async ({
  project,
  script,
  scene,
  actor
}) => {
  const currentHeadState = await resolveSceneCurrentHeadState({
    scene,
    flushLive: true
  });
  const { changed } = await hasDocumentChangedSinceMajorVersion({
    docType: 'scene',
    document: scene,
    currentHeadState
  });

  if (!changed) {
    throw noChangesToSave('No scene changes are available for a major save.');
  }

  return createCheckpointAndSnapshots({
    project,
    script,
    actor,
    scopeType: 'scene',
    scopeRefId: scene._id,
    labelScene: scene,
    snapshotTargets: [
      {
        docType: 'scene',
        document: scene,
        currentHeadState
      }
    ],
    activityType: 'scene.major_saved'
  });
};

const resolveScriptForNoteCheckpoint = async (note) => {
  if (!note.scriptId) {
    return null;
  }

  return Script.findById(note.scriptId);
};

export const majorSaveNote = async ({
  project,
  note,
  actor
}) => {
  const currentHeadState = await resolveNoteCurrentHeadState({
    note,
    flushLive: true
  });
  const { changed } = await hasDocumentChangedSinceMajorVersion({
    docType: 'note',
    document: note,
    currentHeadState
  });

  if (!changed) {
    throw noChangesToSave('No note changes are available for a major save.');
  }

  const script = await resolveScriptForNoteCheckpoint(note);

  if (!script) {
    const mongoSession = await mongoose.startSession();
    let version = null;
    let activityEvent = null;

    try {
      await mongoSession.withTransaction(async () => {
        version = await createImmutableDocumentVersion({
          docType: 'note',
          document: note,
          currentHeadState,
          actorId: actor._id,
          snapshotType: 'major',
          session: mongoSession
        });

        await setDocumentCurrentMajorVersion({
          docType: 'note',
          documentId: note._id,
          versionId: version._id,
          session: mongoSession
        });

        activityEvent = await createVersionActivityAndAudit({
          project,
          actor,
          type: 'note.major_saved',
          note,
          documentVersion: version,
          session: mongoSession
        });
      });
    } finally {
      await mongoSession.endSession();
    }

    emitVersionActivity({
      projectPublicId: project.publicId,
      activityEvent,
      actor
    });
    emitDocumentVersionCreated({
      actor,
      document: note,
      version
    });
    noteSessionManager.updateCurrentMajorVersionId(note.publicId, version.publicId);

    return {
      scriptVersion: null,
      createdVersions: [
        {
          docType: 'note',
          document: note,
          currentHeadState,
          version
        }
      ],
      versionLabel: null
    };
  }

  return createCheckpointAndSnapshots({
    project,
    script,
    actor,
    scopeType: 'note',
    scopeRefId: note._id,
    labelNote: note,
    snapshotTargets: [
      {
        docType: 'note',
        document: note,
        currentHeadState
      }
    ],
    activityType: 'note.major_saved'
  });
};

export const listSceneVersions = async ({ scene }) => {
  const versions = await listDocumentVersions({
    docType: 'scene',
    docId: scene._id
  });

  return versions.map((version) => serializeDocumentVersionSummary(version));
};

export const getSceneVersionDetail = async ({
  project,
  scene,
  versionId
}) => {
  const version = await DocumentVersion
    .findOne({
      projectId: project._id,
      docType: 'scene',
      docId: scene._id,
      publicId: versionId
    })
    .populate('savedByUserId', 'publicId username displayName')
    .populate('restoredFromVersionId', 'publicId versionLabel')
    .populate('scriptVersionId', 'publicId versionLabel majorSaveSequence');

  if (!version) {
    throw notFound('Scene version not found.');
  }

  return serializeDocumentVersionDetail(version);
};

export const listNoteVersions = async ({ note }) => {
  const versions = await listDocumentVersions({
    docType: 'note',
    docId: note._id
  });

  return versions.map((version) => serializeDocumentVersionSummary(version));
};

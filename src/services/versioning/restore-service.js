import mongoose from 'mongoose';

import { notFound } from '../../config/errors.js';
import { Note, Scene, Script } from '../../models/index.js';
import { buildActivityBroadcast, createActivityEvent } from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import { noteSessionManager } from '../collab/note-session-manager.js';
import { sceneSessionManager } from '../collab/scene-session-manager.js';
import { rebuildProjectEntityRegistry } from '../entities/entity-registry-rebuild.js';
import { remapAnchoredNotesForScene } from '../notes/service.js';
import {
  emitToNoteRoom,
  emitToProjectRoom,
  emitToSceneRoom,
  emitToScriptRoom
} from '../realtime/broadcaster.js';
import { canonicalDocumentToPlainText } from '../scenes/document-adapter.js';
import { extractSceneDerivedFields } from '../scenes/derived-fields.js';
import { normalizeCanonicalSceneDocument } from '../scenes/document-normalizer.js';
import {
  createImmutableDocumentVersion,
  loadDocumentVersionForDocument,
  serializeDocumentVersionSummary,
  setDocumentCurrentMajorVersion
} from './document-snapshot-service.js';

const serializeActor = (actor) => ({
  userId: actor.publicId,
  username: actor.username ?? null
});

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

const createRestoreActivityAndAudit = async ({
  project,
  actor,
  type,
  target,
  scriptPublicId = null,
  restoredFromVersion,
  restoreVersion,
  session = null
}) => {
  const targetType = type.startsWith('scene.') ? 'scene' : 'note';
  const message =
    type === 'scene.restored'
      ? `${actor.displayName} restored ${target.title}.`
      : `${actor.displayName} restored a note version.`;
  const payload = {
    targetType,
    targetId: target.publicId,
    scriptId: scriptPublicId,
    restoredFromVersionId: restoredFromVersion.publicId,
    versionId: restoreVersion.publicId,
    versionLabel: restoreVersion.versionLabel ?? restoredFromVersion.versionLabel ?? null
  };
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
    targetType,
    targetId: target.publicId,
    metadata: payload,
    session
  });

  return activityEvent;
};

const loadScriptPublicIdForNote = async (note) => {
  if (!note.scriptId) {
    return null;
  }

  const script = await Script.findById(note.scriptId).select('publicId');
  return script?.publicId ?? null;
};

export const restoreSceneVersion = async ({
  project,
  script,
  scene,
  actor,
  versionId
}) => {
  const restoredFromVersion = await loadDocumentVersionForDocument({
    projectId: project._id,
    docType: 'scene',
    docId: scene._id,
    versionPublicId: versionId
  });

  if (!restoredFromVersion) {
    throw notFound('Scene version not found.');
  }

  const normalizedDocument = normalizeCanonicalSceneDocument(
    restoredFromVersion.contentSnapshot
  );
  const derived = extractSceneDerivedFields(normalizedDocument);
  const headUpdatedAt = new Date();
  const headContent = canonicalDocumentToPlainText(normalizedDocument);
  const mongoSession = await mongoose.startSession();
  let restoredScene = null;
  let restoreVersion = null;
  let activityEvent = null;

  try {
    await mongoSession.withTransaction(async () => {
      restoredScene = await Scene.findByIdAndUpdate(
        scene._id,
        {
          $set: {
            documentSchemaVersion: normalizedDocument.schemaVersion,
            headDocument: normalizedDocument,
            'structuredBody.blocks': normalizedDocument.blocks,
            'structuredBody.cachedSlugline': derived.cachedSlugline,
            'structuredBody.characterRefs': derived.characterRefs,
            'structuredBody.locationRefs': derived.locationRefs,
            headContent,
            headUpdatedAt,
            updatedByUserId: actor._id
          },
          $inc: {
            headRevision: 1
          }
        },
        {
          new: true,
          session: mongoSession
        }
      );

      restoreVersion = await createImmutableDocumentVersion({
        docType: 'scene',
        document: restoredScene,
        currentHeadState: {
          docType: 'scene',
          docId: restoredScene._id,
          projectId: restoredScene.projectId,
          scriptId: restoredScene.scriptId ?? null,
          currentMajorVersionId: restoredScene.currentMajorVersionId ?? null,
          headRevision: restoredScene.headRevision ?? 0,
          headUpdatedAt: restoredScene.headUpdatedAt ?? null,
          contentSnapshot: normalizedDocument,
          contentHash: restoredFromVersion.contentHash
        },
        actorId: actor._id,
        snapshotType: 'restore',
        restoredFromVersionId: restoredFromVersion._id,
        versionLabel: restoredFromVersion.versionLabel ?? null,
        session: mongoSession
      });

      await setDocumentCurrentMajorVersion({
        docType: 'scene',
        documentId: restoredScene._id,
        versionId: restoreVersion._id,
        session: mongoSession
      });

      activityEvent = await createRestoreActivityAndAudit({
        project,
        actor,
        type: 'scene.restored',
        target: scene,
        scriptPublicId: script.publicId,
        restoredFromVersion,
        restoreVersion,
        session: mongoSession
      });
    });
  } finally {
    await mongoSession.endSession();
  }

  await remapAnchoredNotesForScene({
    project,
    scene: restoredScene,
    document: normalizedDocument
  });
  await rebuildProjectEntityRegistry({
    projectId: project._id
  });

  sceneSessionManager.replaceDocument(scene.publicId, {
    document: normalizedDocument,
    currentMajorVersionId: restoreVersion.publicId,
    headUpdatedAt: restoredScene.headUpdatedAt,
    headRevision: restoredScene.headRevision
  });

  const persistedPayload = {
    sceneId: scene.publicId,
    persistedAt: restoredScene.headUpdatedAt,
    latestHeadRevision: restoredScene.headRevision
  };
  const restoredPayload = {
    sceneId: scene.publicId,
    restoredFromVersionId: restoredFromVersion.publicId,
    newHeadVersionId: restoreVersion.publicId,
    actor: serializeActor(actor),
    ts: new Date().toISOString()
  };

  emitToSceneRoom(scene.publicId, 'scene:head-persisted', persistedPayload);
  emitToScriptRoom(script.publicId, 'scene:head-persisted', persistedPayload);
  emitToProjectRoom(project.publicId, 'scene:head-persisted', persistedPayload);
  emitToSceneRoom(scene.publicId, 'scene:version-restored', restoredPayload);
  emitToScriptRoom(script.publicId, 'scene:version-restored', restoredPayload);
  emitToProjectRoom(project.publicId, 'scene:version-restored', restoredPayload);
  emitVersionActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });

  await restoreVersion.populate([
    {
      path: 'savedByUserId',
      select: 'publicId username displayName'
    },
    {
      path: 'restoredFromVersionId',
      select: 'publicId versionLabel'
    },
    {
      path: 'scriptVersionId',
      select: 'publicId versionLabel majorSaveSequence'
    }
  ]);

  return {
    sceneId: scene.publicId,
    headRevision: restoredScene.headRevision,
    headUpdatedAt: restoredScene.headUpdatedAt,
    version: serializeDocumentVersionSummary(restoreVersion)
  };
};

export const restoreNoteVersion = async ({
  project,
  note,
  actor,
  versionId
}) => {
  const restoredFromVersion = await loadDocumentVersionForDocument({
    projectId: project._id,
    docType: 'note',
    docId: note._id,
    versionPublicId: versionId
  });

  if (!restoredFromVersion) {
    throw notFound('Note version not found.');
  }

  const nextText = String(restoredFromVersion.contentSnapshot?.text ?? '');
  const headUpdatedAt = new Date();
  const scriptPublicId = await loadScriptPublicIdForNote(note);
  const mongoSession = await mongoose.startSession();
  let restoredNote = null;
  let restoreVersion = null;
  let activityEvent = null;

  try {
    await mongoSession.withTransaction(async () => {
      restoredNote = await Note.findByIdAndUpdate(
        note._id,
        {
          $set: {
            headText: nextText,
            headUpdatedAt,
            updatedByUserId: actor._id
          },
          $inc: {
            headRevision: 1
          }
        },
        {
          new: true,
          session: mongoSession
        }
      );

      restoreVersion = await createImmutableDocumentVersion({
        docType: 'note',
        document: restoredNote,
        currentHeadState: {
          docType: 'note',
          docId: restoredNote._id,
          projectId: restoredNote.projectId,
          scriptId: restoredNote.scriptId ?? null,
          currentMajorVersionId: restoredNote.currentMajorVersionId ?? null,
          headRevision: restoredNote.headRevision ?? 0,
          headUpdatedAt: restoredNote.headUpdatedAt ?? null,
          contentSnapshot: {
            text: nextText
          },
          contentHash: restoredFromVersion.contentHash
        },
        actorId: actor._id,
        snapshotType: 'restore',
        restoredFromVersionId: restoredFromVersion._id,
        versionLabel: restoredFromVersion.versionLabel ?? null,
        session: mongoSession
      });

      await setDocumentCurrentMajorVersion({
        docType: 'note',
        documentId: restoredNote._id,
        versionId: restoreVersion._id,
        session: mongoSession
      });

      activityEvent = await createRestoreActivityAndAudit({
        project,
        actor,
        type: 'note.restored',
        target: note,
        scriptPublicId,
        restoredFromVersion,
        restoreVersion,
        session: mongoSession
      });
    });
  } finally {
    await mongoSession.endSession();
  }

  noteSessionManager.replaceText(note.publicId, {
    text: nextText,
    currentMajorVersionId: restoreVersion.publicId,
    headUpdatedAt: restoredNote.headUpdatedAt,
    headRevision: restoredNote.headRevision
  });

  emitToNoteRoom(note.publicId, 'note:head-persisted', {
    noteId: note.publicId,
    persistedAt: restoredNote.headUpdatedAt,
    latestHeadRevision: restoredNote.headRevision
  });
  emitToNoteRoom(note.publicId, 'note:version-restored', {
    noteId: note.publicId,
    restoredFromVersionId: restoredFromVersion.publicId,
    newHeadVersionId: restoreVersion.publicId,
    actor: serializeActor(actor),
    ts: new Date().toISOString()
  });
  emitVersionActivity({
    projectPublicId: project.publicId,
    scriptPublicId,
    activityEvent,
    actor
  });

  await restoreVersion.populate([
    {
      path: 'savedByUserId',
      select: 'publicId username displayName'
    },
    {
      path: 'restoredFromVersionId',
      select: 'publicId versionLabel'
    },
    {
      path: 'scriptVersionId',
      select: 'publicId versionLabel majorSaveSequence'
    }
  ]);

  return {
    noteId: note.publicId,
    headRevision: restoredNote.headRevision,
    headUpdatedAt: restoredNote.headUpdatedAt,
    version: serializeDocumentVersionSummary(restoreVersion)
  };
};

import { DocumentVersion, Note, Scene, ScriptVersion } from '../../models/index.js';
import { noteSessionManager } from '../collab/note-session-manager.js';
import { sceneSessionManager } from '../collab/scene-session-manager.js';
import { getSceneHeadDocument } from '../scenes/legacy-document.js';
import {
  hashDocumentSnapshot,
  normalizeDocumentSnapshot
} from './content-hash-service.js';

const idString = (value) => (value ? String(value) : null);

const withSession = (query, session = null) => {
  if (session) {
    query.session(session);
  }

  return query;
};

const getSceneMajorVersionId = (scene) =>
  scene.currentMajorVersionId ?? scene.latestMajorVersionId ?? null;

export const buildSceneCurrentHeadState = ({ scene, document }) => {
  const contentSnapshot = normalizeDocumentSnapshot({
    docType: 'scene',
    contentSnapshot: document
  });

  return {
    docType: 'scene',
    docId: scene._id,
    projectId: scene.projectId,
    scriptId: scene.scriptId ?? null,
    currentMajorVersionId: getSceneMajorVersionId(scene),
    headRevision: scene.headRevision ?? 0,
    headUpdatedAt: scene.headUpdatedAt ?? null,
    contentSnapshot,
    contentHash: hashDocumentSnapshot({
      docType: 'scene',
      contentSnapshot
    })
  };
};

export const buildNoteCurrentHeadState = ({ note, text }) => {
  const contentSnapshot = normalizeDocumentSnapshot({
    docType: 'note',
    contentSnapshot: { text }
  });

  return {
    docType: 'note',
    docId: note._id,
    projectId: note.projectId,
    scriptId: note.scriptId ?? null,
    currentMajorVersionId: note.currentMajorVersionId ?? null,
    headRevision: note.headRevision ?? 0,
    headUpdatedAt: note.headUpdatedAt ?? null,
    contentSnapshot,
    contentHash: hashDocumentSnapshot({
      docType: 'note',
      contentSnapshot
    })
  };
};

export const resolveSceneCurrentHeadState = async ({
  scene,
  flushLive = false
}) => {
  const session = sceneSessionManager.get(scene.publicId);

  if (session) {
    if (flushLive) {
      await session.flush('versioning');
    }

    const reloadedScene = flushLive
      ? await Scene.findById(scene._id)
      : scene;

    return buildSceneCurrentHeadState({
      scene: reloadedScene ?? scene,
      document: session.materializeDocument()
    });
  }

  return buildSceneCurrentHeadState({
    scene,
    document: getSceneHeadDocument(scene)
  });
};

export const resolveNoteCurrentHeadState = async ({
  note,
  flushLive = false
}) => {
  const session = noteSessionManager.get(note.publicId);

  if (session) {
    if (flushLive) {
      await session.flush('versioning');
    }

    const reloadedNote = flushLive
      ? await Note.findById(note._id)
      : note;

    return buildNoteCurrentHeadState({
      note: reloadedNote ?? note,
      text: session.materializeText()
    });
  }

  return buildNoteCurrentHeadState({
    note,
    text: note.headText ?? ''
  });
};

export const resolveDocumentCurrentHeadState = async ({
  docType,
  scene = null,
  note = null,
  flushLive = false
}) => {
  if (docType === 'scene') {
    return resolveSceneCurrentHeadState({
      scene,
      flushLive
    });
  }

  if (docType === 'note') {
    return resolveNoteCurrentHeadState({
      note,
      flushLive
    });
  }

  throw new Error(`Unsupported document type: ${docType}`);
};

export const loadDocumentVersionForDocument = async ({
  projectId,
  docType,
  docId,
  versionPublicId,
  session = null
}) =>
  withSession(
    DocumentVersion.findOne({
      projectId,
      docType,
      docId,
      publicId: versionPublicId
    }),
    session
  );

export const loadCurrentMajorVersionForDocument = async ({
  docType,
  document,
  session = null
}) => {
  const currentMajorVersionId =
    docType === 'scene'
      ? getSceneMajorVersionId(document)
      : document.currentMajorVersionId ?? null;

  if (!currentMajorVersionId) {
    return null;
  }

  return withSession(
    DocumentVersion.findById(currentMajorVersionId),
    session
  );
};

export const loadLatestMajorVersionForDocument = async ({
  docType,
  document,
  session = null
}) =>
  withSession(
    DocumentVersion.findOne({
      docType,
      docId: document._id,
      snapshotType: 'major'
    }).sort({ savedAt: -1, versionSequence: -1 }),
    session
  );

export const hasDocumentChangedSinceMajorVersion = async ({
  docType,
  document,
  currentHeadState,
  session = null
}) => {
  const latestVersion = await loadCurrentMajorVersionForDocument({
    docType,
    document,
    session
  });

  if (!latestVersion) {
    return {
      changed: true,
      latestVersion: null
    };
  }

  return {
    changed: latestVersion.contentHash !== currentHeadState.contentHash,
    latestVersion
  };
};

const loadNextVersionSequence = async ({
  docType,
  docId,
  session = null
}) => {
  const latestVersion = await withSession(
    DocumentVersion.findOne({
      docType,
      docId
    })
      .sort({ versionSequence: -1 })
      .select('versionSequence'),
    session
  );

  return (latestVersion?.versionSequence ?? 0) + 1;
};

export const createImmutableDocumentVersion = async ({
  docType,
  document,
  currentHeadState,
  actorId,
  snapshotType = 'major',
  scriptVersionId = null,
  restoredFromVersionId = null,
  versionLabel = null,
  session = null
}) => {
  const versionSequence = await loadNextVersionSequence({
    docType,
    docId: document._id,
    session
  });
  const [version] = await DocumentVersion.create(
    [
      {
        projectId: document.projectId,
        docType,
        docId: document._id,
        scriptId: document.scriptId ?? null,
        scriptVersionId,
        snapshotType,
        versionSequence,
        savedByUserId: actorId,
        savedAt: new Date(),
        restoredFromVersionId,
        headRevisionAtSave: currentHeadState.headRevision ?? 0,
        versionLabel: versionLabel ?? null,
        contentHash: currentHeadState.contentHash,
        contentSnapshot: currentHeadState.contentSnapshot
      }
    ],
    session ? { session } : {}
  );

  return version;
};

export const setDocumentCurrentMajorVersion = async ({
  docType,
  documentId,
  versionId,
  session = null
}) => {
  const Model = docType === 'scene' ? Scene : Note;

  await withSession(
    Model.updateOne(
      { _id: documentId },
      {
        $set: {
          currentMajorVersionId: versionId
        }
      }
    ),
    session
  );
};

export const listDocumentVersions = async ({
  docType,
  docId
}) =>
  DocumentVersion.find({
    docType,
    docId
  })
    .populate('savedByUserId', 'publicId username displayName')
    .populate('restoredFromVersionId', 'publicId versionLabel')
    .populate('scriptVersionId', 'publicId versionLabel majorSaveSequence')
    .sort({ savedAt: -1, versionSequence: -1 });

export const serializeDocumentVersionSummary = (version) => ({
  id: version.publicId,
  docType: version.docType,
  versionSequence: version.versionSequence,
  versionLabel: version.versionLabel ?? null,
  snapshotType: version.snapshotType,
  savedAt: version.savedAt,
  headRevisionAtSave: version.headRevisionAtSave ?? 0,
  scriptVersionId:
    version.scriptVersionId?.publicId ??
    (version.scriptVersionId instanceof ScriptVersion
      ? version.scriptVersionId.publicId
      : null),
  restoredFromVersionId: version.restoredFromVersionId?.publicId ?? null,
  savedBy: version.savedByUserId
    ? {
        userId: version.savedByUserId.publicId,
        username: version.savedByUserId.username ?? null,
        displayName: version.savedByUserId.displayName ?? null
      }
    : null
});

export const serializeDocumentVersionDetail = (version) => ({
  ...serializeDocumentVersionSummary(version),
  projectId: idString(version.projectId),
  scriptId: idString(version.scriptId),
  contentSnapshot: version.contentSnapshot,
  contentHash: version.contentHash
});

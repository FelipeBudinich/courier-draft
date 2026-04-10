import mongoose from 'mongoose';

import {
  badRequest,
  notFound,
  staleState
} from '../../config/errors.js';
import {
  DocumentVersion,
  Note,
  OutlineNode,
  Scene,
  Script,
  User
} from '../../models/index.js';
import { buildActivityBroadcast, createActivityEvent } from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import {
  emitToProjectRoom,
  emitToSceneRoom,
  emitToScriptRoom
} from '../realtime/broadcaster.js';
import {
  normalizeAnchorInput,
  remapAnchorToDocument
} from './anchor-utils.js';
import {
  canCreateNote,
  canDeleteNote,
  canEditNote
} from './note-permissions.js';

const NOTE_SUMMARY_PREVIEW_LENGTH = 180;

const idString = (value) => (value ? String(value) : null);

const trimHeadPreview = (text = '') =>
  text.length > NOTE_SUMMARY_PREVIEW_LENGTH
    ? `${text.slice(0, NOTE_SUMMARY_PREVIEW_LENGTH - 1)}…`
    : text;

const serializeUserSummary = (user) =>
  user
    ? {
        userId: user.publicId,
        username: user.username ?? null,
        displayName: user.displayName ?? null
      }
    : null;

const buildNoteActivityMessage = ({
  type,
  actor
}) => {
  switch (type) {
    case 'note.created':
      return `${actor.displayName} created a note.`;
    case 'note.deleted':
      return `${actor.displayName} deleted a note.`;
    case 'note.detached':
      return `${actor.displayName} detached a note anchor.`;
    case 'note.reattached':
      return `${actor.displayName} reattached a note anchor.`;
    default:
      return `${actor.displayName} updated a note.`;
  }
};

const parseBooleanFilter = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  throw badRequest('Boolean filters must be true or false.');
};

const loadReferenceMaps = async ({ project, notes }) => {
  const authorUserIds = [
    ...new Set(notes.map((note) => idString(note.authorUserId)).filter(Boolean))
  ];
  const scriptIds = [
    ...new Set(notes.map((note) => idString(note.scriptId)).filter(Boolean))
  ];
  const sceneIds = [
    ...new Set(notes.map((note) => idString(note.sceneId)).filter(Boolean))
  ];
  const outlineIds = [
    ...new Set(
      notes
        .filter((note) => ['act', 'beat'].includes(note.containerType))
        .map((note) => idString(note.containerId))
        .filter(Boolean)
    )
  ];

  const [authors, scripts, scenes, outlineNodes] = await Promise.all([
    authorUserIds.length
      ? User.find({ _id: { $in: authorUserIds } }).select('publicId username displayName')
      : [],
    scriptIds.length
      ? Script.find({ _id: { $in: scriptIds } }).select('publicId title')
      : [],
    sceneIds.length
      ? Scene.find({ _id: { $in: sceneIds } }).select('publicId title')
      : [],
    outlineIds.length
      ? OutlineNode.find({
          _id: { $in: outlineIds },
          projectId: project._id
        }).select('publicId title type scriptId sceneId')
      : []
  ]);

  return {
    authorsById: new Map(authors.map((item) => [idString(item._id), item])),
    scriptsById: new Map(scripts.map((item) => [idString(item._id), item])),
    scenesById: new Map(scenes.map((item) => [idString(item._id), item])),
    outlineById: new Map(outlineNodes.map((item) => [idString(item._id), item]))
  };
};

const buildContainerSummary = ({
  note,
  project,
  references
}) => {
  switch (note.containerType) {
    case 'project':
      return {
        type: 'project',
        id: project.publicId,
        title: project.name
      };
    case 'script': {
      const script = references.scriptsById.get(idString(note.scriptId));
      return {
        type: 'script',
        id: script?.publicId ?? null,
        title: script?.title ?? null
      };
    }
    case 'scene': {
      const scene = references.scenesById.get(idString(note.sceneId));
      return {
        type: 'scene',
        id: scene?.publicId ?? note.anchor?.sceneId ?? null,
        title: scene?.title ?? null
      };
    }
    case 'act':
    case 'beat': {
      const node = references.outlineById.get(idString(note.containerId));
      return {
        type: note.containerType,
        id: node?.publicId ?? null,
        title: node?.title ?? null
      };
    }
    default:
      return {
        type: note.containerType,
        id: null,
        title: null
      };
  }
};

const serializeAnchorSummary = (note) =>
  note.anchor
    ? {
        sceneId: note.anchor.sceneId,
        blockId: note.anchor.blockId,
        startOffset: note.anchor.startOffset,
        endOffset: note.anchor.endOffset,
        selectedText: note.anchor.selectedText
      }
    : null;

const serializeNoteSummary = ({
  note,
  project,
  projectRole,
  currentUserId,
  references
}) => {
  const author = references.authorsById.get(idString(note.authorUserId)) ?? null;
  const script = references.scriptsById.get(idString(note.scriptId)) ?? null;
  const scene = references.scenesById.get(idString(note.sceneId)) ?? null;

  return {
    id: note.publicId,
    projectId: project.publicId,
    scriptId: script?.publicId ?? null,
    sceneId: scene?.publicId ?? note.anchor?.sceneId ?? null,
    container: buildContainerSummary({
      note,
      project,
      references
    }),
    author: serializeUserSummary(author),
    headPreview: trimHeadPreview(note.headText ?? ''),
    headRevision: note.headRevision ?? 0,
    headUpdatedAt: note.headUpdatedAt,
    isAnchored: Boolean(note.anchor),
    isDetached: note.isDetached,
    detachedAt: note.detachedAt ?? null,
    anchorSummary: serializeAnchorSummary(note),
    latestMajorVersionId: note.currentMajorVersionId
      ? String(note.currentMajorVersionId)
      : null,
    canEdit: canEditNote({
      projectRole,
      currentUserId,
      authorUserId: note.authorUserId
    }),
    canDelete: canDeleteNote({
      projectRole,
      currentUserId,
      authorUserId: note.authorUserId
    })
  };
};

const serializeNoteDetail = ({
  note,
  project,
  projectRole,
  currentUserId,
  references
}) => {
  const summary = serializeNoteSummary({
    note,
    project,
    projectRole,
    currentUserId,
    references
  });

  return {
    ...summary,
    headText: note.headText ?? '',
    blockId: note.blockId ?? null,
    anchor: note.anchor
      ? (note.anchor.toObject?.() ?? note.anchor)
      : null,
    capabilities: {
      canRead: true,
      canEdit: summary.canEdit,
      canDelete: summary.canDelete
    }
  };
};

const createActivityAndAuditForNote = async ({
  project,
  scriptPublicId = null,
  actor,
  note,
  type,
  session,
  metadata = {}
}) => {
  const activityEvent = await createActivityEvent({
    projectId: project._id,
    actorId: actor._id,
    type,
    message: buildNoteActivityMessage({
      type,
      actor
    }),
    payload: {
      targetType: 'note',
      targetId: note.publicId,
      scriptId: scriptPublicId,
      containerType: note.containerType,
      ...metadata
    },
    session
  });

  await createAuditLog({
    scope: 'project',
    projectId: project._id,
    actorId: actor._id,
    action: type,
    targetType: 'note',
    targetId: note.publicId,
    metadata: {
      scriptId: scriptPublicId,
      containerType: note.containerType,
      ...metadata
    },
    session
  });

  return activityEvent;
};

const emitNoteLifecycle = ({
  projectPublicId,
  scriptPublicId,
  scenePublicId,
  eventName,
  payload
}) => {
  emitToProjectRoom(projectPublicId, eventName, payload);

  if (scriptPublicId) {
    emitToScriptRoom(scriptPublicId, eventName, payload);
  }

  if (scenePublicId) {
    emitToSceneRoom(scenePublicId, eventName, payload);
  }
};

const emitNoteActivity = ({
  projectPublicId,
  scriptPublicId,
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

const resolveScriptByPublicId = ({ projectId, scriptPublicId }) =>
  Script.findOne({
    projectId,
    publicId: scriptPublicId
  });

const resolveSceneByPublicId = ({ projectId, scenePublicId }) =>
  Scene.findOne({
    projectId,
    publicId: scenePublicId
  });

const resolveOutlineNodeByPublicId = ({ projectId, publicId, type }) =>
  OutlineNode.findOne({
    projectId,
    publicId,
    type
  });

const resolveContainer = async ({
  project,
  containerType,
  containerPublicId,
  scriptPublicId = null
}) => {
  switch (containerType) {
    case 'project':
      if (containerPublicId !== project.publicId) {
        throw notFound('Note container not found.');
      }

      return {
        containerType,
        container: project,
        script: null,
        scene: null
      };
    case 'script': {
      if (!containerPublicId) {
        throw badRequest('containerId is required for script notes.');
      }

      const script = await resolveScriptByPublicId({
        projectId: project._id,
        scriptPublicId: containerPublicId
      });

      if (!script) {
        throw notFound('Note container not found.');
      }

      return {
        containerType,
        container: script,
        script,
        scene: null
      };
    }
    case 'scene': {
      if (!containerPublicId) {
        throw badRequest('containerId is required for scene notes.');
      }

      const scene = await resolveSceneByPublicId({
        projectId: project._id,
        scenePublicId: containerPublicId
      });

      if (!scene) {
        throw notFound('Note container not found.');
      }

      const script = await Script.findById(scene.scriptId);

      if (!script || (scriptPublicId && script.publicId !== scriptPublicId)) {
        throw notFound('Note container not found.');
      }

      return {
        containerType,
        container: scene,
        script,
        scene
      };
    }
    case 'act':
    case 'beat': {
      if (!containerPublicId) {
        throw badRequest(`containerId is required for ${containerType} notes.`);
      }

      const node = await resolveOutlineNodeByPublicId({
        projectId: project._id,
        publicId: containerPublicId,
        type: containerType
      });

      if (!node) {
        throw notFound('Note container not found.');
      }

      const script = await Script.findById(node.scriptId);
      if (!script || (scriptPublicId && script.publicId !== scriptPublicId)) {
        throw notFound('Note container not found.');
      }

      return {
        containerType,
        container: node,
        script,
        scene: null
      };
    }
    default:
      throw badRequest('Unsupported note container type.');
  }
};

const resolveCreateContext = async ({
  project,
  input
}) => {
  if (input.anchor) {
    const scene = await resolveSceneByPublicId({
      projectId: project._id,
      scenePublicId: input.sceneId ?? input.anchor.sceneId
    });

    if (!scene) {
      throw notFound('Scene not found.');
    }

    const script = await Script.findById(scene.scriptId);
    if (!script) {
      throw notFound('Script not found.');
    }

    return {
      containerType: 'scene',
      container: scene,
      script,
      scene,
      anchor: normalizeAnchorInput({
        scene,
        anchor: input.anchor
      })
    };
  }

  const resolved = await resolveContainer({
    project,
    containerType: input.containerType,
    containerPublicId: input.containerId,
    scriptPublicId: input.scriptId ?? null
  });

  return {
    ...resolved,
    anchor: null
  };
};

const buildNoteStaleStateDetails = (note) =>
  note
    ? {
        noteId: note.publicId,
        headRevision: note.headRevision ?? 0,
        headUpdatedAt: note.headUpdatedAt,
        headText: note.headText ?? ''
      }
    : null;

const getNoteBroadcastTargets = async ({
  project,
  note
}) => {
  const [script, scene] = await Promise.all([
    note.scriptId ? Script.findById(note.scriptId).select('publicId') : null,
    note.sceneId ? Scene.findById(note.sceneId).select('publicId') : null
  ]);

  return {
    projectPublicId: project.publicId,
    scriptPublicId: script?.publicId ?? null,
    scenePublicId: scene?.publicId ?? note.anchor?.sceneId ?? null
  };
};

const flattenOutlineNodes = (nodes, collected = []) => {
  for (const node of nodes ?? []) {
    collected.push(node);

    if (node.children?.length) {
      flattenOutlineNodes(node.children, collected);
    }
  }

  return collected;
};

const derivePanelFilters = ({
  project,
  script = null,
  currentUser,
  surface = 'script',
  sceneId = null,
  filters = {}
}) => {
  const scope =
    filters.scope ??
    (surface === 'project'
      ? 'project'
      : sceneId
        ? 'scene'
        : 'script');
  const ownership = filters.ownership ?? 'all';
  const noteType = filters.noteType ?? 'all';
  const detached = filters.detached ?? 'all';

  const listFilters = {};

  if (scope === 'project') {
    listFilters.containerType = 'project';
    listFilters.containerId = project.publicId;
  } else if (scope === 'script') {
    if (!script) {
      throw badRequest('Script scope is not available for this notes panel.');
    }

    listFilters.containerType = 'script';
    listFilters.containerId = script.publicId;
  } else if (scope === 'scene') {
    if (!script) {
      throw badRequest('Scene scope is not available for this notes panel.');
    }

    if (sceneId) {
      listFilters.sceneId = sceneId;
    } else {
      listFilters.containerType = 'scene';
      listFilters.scriptId = script.publicId;
    }
  } else {
    throw badRequest('Unsupported notes scope filter.');
  }

  if (ownership === 'mine') {
    listFilters.authorUserId = currentUser.publicId;
  }

  if (noteType === 'anchored') {
    listFilters.anchored = true;
  } else if (noteType === 'standalone') {
    listFilters.anchored = false;
  }

  if (detached === 'detached') {
    listFilters.detached = true;
  }

  return {
    scope,
    ownership,
    noteType,
    detached,
    listFilters
  };
};

const buildCreateTargets = ({
  project,
  script = null,
  outlineNodes = []
}) => {
  const flattened = flattenOutlineNodes(outlineNodes);
  const sceneTargets = flattened
    .filter((node) => node.type === 'scene' && node.sceneId)
    .map((node) => ({
      id: node.sceneId,
      label: `${node.displaySceneNumber ? `${node.displaySceneNumber} · ` : ''}${node.title}`
    }));

  return {
    project: [
      {
        id: project.publicId,
        label: project.name
      }
    ],
    script: script
      ? [
          {
            id: script.publicId,
            label: script.title
          }
        ]
      : [],
    act: flattened
      .filter((node) => node.type === 'act')
      .map((node) => ({
        id: node.id,
        label: node.title
      })),
    beat: flattened
      .filter((node) => node.type === 'beat')
      .map((node) => ({
        id: node.id,
        label: node.title
      })),
    scene: sceneTargets
  };
};

const loadNoteDetail = async ({
  project,
  note,
  projectRole,
  currentUserId
}) => {
  const references = await loadReferenceMaps({
    project,
    notes: [note]
  });

  return serializeNoteDetail({
    note,
    project,
    projectRole,
    currentUserId,
    references
  });
};

export const listNotes = async ({
  project,
  projectRole,
  currentUserId,
  filters = {}
}) => {
  const query = {
    projectId: project._id
  };

  if (filters.containerType) {
    query.containerType = filters.containerType;
  }

  if (filters.containerId) {
    if (!filters.containerType) {
      throw badRequest('containerType is required when containerId is provided.');
    }

    const resolved = await resolveContainer({
      project,
      containerType: filters.containerType,
      containerPublicId: filters.containerId,
      scriptPublicId: filters.scriptId ?? null
    });
    query.containerId = resolved.container._id;
  }

  if (filters.sceneId) {
    const scene = await resolveSceneByPublicId({
      projectId: project._id,
      scenePublicId: filters.sceneId
    });

    if (!scene) {
      return [];
    }

    query.sceneId = scene._id;
  }

  if (filters.scriptId) {
    const script = await resolveScriptByPublicId({
      projectId: project._id,
      scriptPublicId: filters.scriptId
    });

    if (!script) {
      return [];
    }

    query.scriptId = script._id;
  }

  if (filters.authorUserId) {
    const author = await User.findOne({
      publicId: filters.authorUserId
    }).select('_id');

    if (!author) {
      return [];
    }

    query.authorUserId = author._id;
  }

  const anchored = parseBooleanFilter(filters.anchored);
  if (anchored === true) {
    query.anchor = {
      $ne: null
    };
  } else if (anchored === false) {
    query.anchor = null;
  }

  const detached = parseBooleanFilter(filters.detached);
  if (detached !== undefined) {
    query.isDetached = detached;
  }

  const notes = await Note.find(query).sort({ headUpdatedAt: -1, updatedAt: -1 });
  const references = await loadReferenceMaps({
    project,
    notes
  });

  return notes.map((note) =>
    serializeNoteSummary({
      note,
      project,
      projectRole,
      currentUserId,
      references
    })
  );
};

export const getNoteDetail = async ({
  project,
  note,
  projectRole,
  currentUserId
}) =>
  loadNoteDetail({
    project,
    note,
    projectRole,
    currentUserId
  });

export const createNote = async ({
  project,
  actor,
  projectRole,
  input
}) => {
  if (!canCreateNote(projectRole)) {
    throw notFound('Project not found.');
  }

  const resolved = await resolveCreateContext({
    project,
    input
  });
  const now = new Date();
  let createdNote = null;
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      [createdNote] = await Note.create(
        [
          {
            projectId: project._id,
            scriptId: resolved.script?._id ?? null,
            sceneId: resolved.scene?._id ?? null,
            blockId: resolved.anchor?.blockId ?? null,
            containerType: resolved.containerType,
            containerId: resolved.container._id,
            anchor: resolved.anchor,
            isDetached: false,
            detachedAt: null,
            authorUserId: actor._id,
            headText: input.text,
            headRevision: 1,
            headUpdatedAt: now,
            updatedByUserId: actor._id,
            currentMajorVersionId: null
          }
        ],
        { session }
      );

      activityEvent = await createActivityAndAuditForNote({
        project,
        scriptPublicId: resolved.script?.publicId ?? null,
        actor,
        note: createdNote,
        type: 'note.created',
        session,
        metadata: {
          anchored: Boolean(resolved.anchor),
          sceneId: resolved.scene?.publicId ?? null
        }
      });
    });
  } finally {
    await session.endSession();
  }

  const detail = await loadNoteDetail({
    project,
    note: createdNote,
    projectRole,
    currentUserId: actor._id
  });
  const targets = await getNoteBroadcastTargets({
    project,
    note: createdNote
  });

  emitNoteLifecycle({
    ...targets,
    eventName: 'note:created',
    payload: {
      noteId: createdNote.publicId,
      projectId: project.publicId,
      scriptId: detail.scriptId,
      sceneId: detail.sceneId,
      containerType: createdNote.containerType,
      containerId: detail.container.id,
      author: {
        userId: actor.publicId,
        username: actor.username ?? null
      },
      ts: createdNote.createdAt.toISOString()
    }
  });
  emitNoteActivity({
    projectPublicId: project.publicId,
    scriptPublicId: detail.scriptId,
    activityEvent,
    actor
  });

  return detail;
};

export const updateNoteMetadata = async ({
  project,
  note,
  actor,
  projectRole,
  input
}) => {
  let activityEvent = null;
  let updatedFields = [];
  let actionType = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (input.detach) {
        if (!note.anchor || note.isDetached) {
          throw badRequest('Only attached anchored notes can be detached.');
        }

        note.isDetached = true;
        note.detachedAt = new Date();
        updatedFields = ['isDetached', 'detachedAt'];
        actionType = 'note.detached';
      } else if (input.anchor) {
        const scene = await resolveSceneByPublicId({
          projectId: project._id,
          scenePublicId: input.sceneId ?? input.anchor.sceneId
        });

        if (!scene) {
          throw notFound('Scene not found.');
        }

        const script = await Script.findById(scene.scriptId).session(session);
        if (!script) {
          throw notFound('Script not found.');
        }

        const nextAnchor = normalizeAnchorInput({
          scene,
          anchor: input.anchor
        });

        note.containerType = 'scene';
        note.containerId = scene._id;
        note.scriptId = script._id;
        note.sceneId = scene._id;
        note.blockId = nextAnchor.blockId;
        note.anchor = nextAnchor;
        note.isDetached = false;
        note.detachedAt = null;
        updatedFields = ['containerType', 'containerId', 'scriptId', 'sceneId', 'blockId', 'anchor', 'isDetached', 'detachedAt'];
        actionType = 'note.reattached';
      } else if (input.containerType || input.containerId) {
        if (!input.containerId) {
          throw badRequest('containerId is required for note container updates.');
        }

        const resolved = await resolveContainer({
          project,
          containerType: input.containerType ?? note.containerType,
          containerPublicId: input.containerId,
          scriptPublicId: input.scriptId ?? null
        });

        note.containerType = resolved.containerType;
        note.containerId = resolved.container._id;
        note.scriptId = resolved.script?._id ?? null;
        note.sceneId = resolved.scene?._id ?? null;
        note.blockId = null;
        note.anchor = null;
        note.isDetached = false;
        note.detachedAt = null;
        updatedFields = ['containerType', 'containerId', 'scriptId', 'sceneId', 'anchor', 'blockId', 'isDetached', 'detachedAt'];
      } else {
        throw badRequest('No supported note metadata changes were provided.');
      }

      note.updatedByUserId = actor._id;
      note.headUpdatedAt = note.headUpdatedAt ?? new Date();
      await note.save({ session });

      if (actionType) {
        const targets = await getNoteBroadcastTargets({
          project,
          note
        });

        activityEvent = await createActivityAndAuditForNote({
          project,
          scriptPublicId: targets.scriptPublicId,
          actor,
          note,
          type: actionType,
          session,
          metadata: {
            sceneId: targets.scenePublicId,
            anchored: Boolean(note.anchor)
          }
        });
      }
    });
  } finally {
    await session.endSession();
  }

  const detail = await loadNoteDetail({
    project,
    note,
    projectRole,
    currentUserId: actor._id
  });
  const targets = await getNoteBroadcastTargets({
    project,
    note
  });

  emitNoteLifecycle({
    ...targets,
    eventName: 'note:updated',
    payload: {
      noteId: note.publicId,
      projectId: project.publicId,
      scriptId: detail.scriptId,
      sceneId: detail.sceneId,
      updatedFields,
      actor: {
        userId: actor.publicId,
        username: actor.username ?? null
      },
      ts: new Date().toISOString()
    }
  });

  if (activityEvent) {
    emitNoteActivity({
      projectPublicId: project.publicId,
      scriptPublicId: detail.scriptId,
      activityEvent,
      actor
    });
  }

  return detail;
};

export const deleteNote = async ({
  project,
  note,
  actor
}) => {
  const targets = await getNoteBroadcastTargets({
    project,
    note
  });
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await DocumentVersion.deleteMany({
        docType: 'note',
        docId: note._id
      }).session(session);

      activityEvent = await createActivityAndAuditForNote({
        project,
        scriptPublicId: targets.scriptPublicId,
        actor,
        note,
        type: 'note.deleted',
        session,
        metadata: {
          sceneId: targets.scenePublicId,
          anchored: Boolean(note.anchor)
        }
      });

      await Note.deleteOne({
        _id: note._id
      }).session(session);
    });
  } finally {
    await session.endSession();
  }

  emitNoteLifecycle({
    ...targets,
    eventName: 'note:deleted',
    payload: {
      noteId: note.publicId,
      projectId: project.publicId,
      scriptId: targets.scriptPublicId,
      sceneId: targets.scenePublicId,
      actor: {
        userId: actor.publicId,
        username: actor.username ?? null
      },
      ts: new Date().toISOString()
    }
  });
  emitNoteActivity({
    projectPublicId: project.publicId,
    scriptPublicId: targets.scriptPublicId,
    activityEvent,
    actor
  });

  return {
    deleted: true,
    noteId: note.publicId
  };
};

export const saveNoteHead = async ({
  note,
  actor,
  baseHeadRevision,
  text
}) => {
  const headUpdatedAt = new Date();
  const savedNote = await Note.findOneAndUpdate(
    {
      _id: note._id,
      headRevision: baseHeadRevision
    },
    {
      $set: {
        headText: text,
        headUpdatedAt,
        updatedByUserId: actor._id
      },
      $inc: {
        headRevision: 1
      }
    },
    {
      new: true
    }
  ).exec();

  if (!savedNote) {
    const latestNote = await Note.findById(note._id).exec();
    throw staleState(
      'A newer draft exists for this note.',
      buildNoteStaleStateDetails(latestNote)
    );
  }

  return {
    noteId: savedNote.publicId,
    headText: savedNote.headText,
    headRevision: savedNote.headRevision,
    headUpdatedAt: savedNote.headUpdatedAt
  };
};

export const remapAnchoredNotesForScene = async ({
  project,
  scene,
  document
}) => {
  const anchoredNotes = await Note.find({
    projectId: project._id,
    sceneId: scene._id,
    anchor: {
      $ne: null
    },
    isDetached: false
  });

  for (const note of anchoredNotes) {
    const anchor = note.anchor?.toObject?.() ?? note.anchor;
    const remap = remapAnchorToDocument({
      anchor,
      document
    });

    if (remap.status === 'kept') {
      const sameAnchor =
        JSON.stringify(anchor) === JSON.stringify(remap.nextAnchor);
      if (sameAnchor) {
        continue;
      }

      note.anchor = remap.nextAnchor;
      note.blockId = remap.nextAnchor.blockId;
      await note.save();
      continue;
    }

    if (remap.status === 'moved') {
      note.anchor = remap.nextAnchor;
      note.blockId = remap.nextAnchor.blockId;
      await note.save();

      const targets = await getNoteBroadcastTargets({
        project,
        note
      });
      emitNoteLifecycle({
        ...targets,
        eventName: 'note:updated',
        payload: {
          noteId: note.publicId,
          projectId: project.publicId,
          scriptId: targets.scriptPublicId,
          sceneId: targets.scenePublicId,
          updatedFields: ['anchor'],
          actor: null,
          ts: new Date().toISOString()
        }
      });
      continue;
    }

    note.isDetached = true;
    note.detachedAt = new Date();
    await note.save();

    const targets = await getNoteBroadcastTargets({
      project,
      note
    });
    emitNoteLifecycle({
      ...targets,
      eventName: 'note:anchor-detached',
      payload: {
        noteId: note.publicId,
        sceneId: targets.scenePublicId,
        previousAnchor: anchor,
        ts: new Date().toISOString()
      }
    });
    emitNoteLifecycle({
      ...targets,
      eventName: 'note:updated',
      payload: {
        noteId: note.publicId,
        projectId: project.publicId,
        scriptId: targets.scriptPublicId,
        sceneId: targets.scenePublicId,
        updatedFields: ['isDetached', 'detachedAt'],
        actor: null,
        ts: new Date().toISOString()
      }
    });
  }
};

export const getNotesPanelModel = async ({
  project,
  script = null,
  outlineNodes = [],
  currentUser,
  projectRole,
  surface = 'script',
  sceneId = null,
  filters = {}
}) => {
  const normalizedFilters = derivePanelFilters({
    project,
    script,
    currentUser,
    surface,
    sceneId,
    filters
  });

  const notes = await listNotes({
    project,
    projectRole,
    currentUserId: currentUser._id,
    filters: normalizedFilters.listFilters
  });

  return {
    project: {
      id: project.publicId,
      title: project.name
    },
    script: script
      ? {
          id: script.publicId ?? script.id,
          title: script.title
        }
      : null,
    surface,
    sceneId,
    currentUser: {
      id: currentUser.publicId,
      displayName: currentUser.displayName
    },
    canCreate: canCreateNote(projectRole),
    filters: {
      scope: normalizedFilters.scope,
      ownership: normalizedFilters.ownership,
      noteType: normalizedFilters.noteType,
      detached: normalizedFilters.detached
    },
    availableScopes:
      surface === 'project'
        ? ['project']
        : ['scene', 'script', 'project'],
    createTargets: buildCreateTargets({
      project,
      script,
      outlineNodes
    }),
    notes
  };
};

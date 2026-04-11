import { buildActivityBroadcast } from '../activity/service.js';
import { emitToProjectRoom, emitToScriptRoom } from '../realtime/broadcaster.js';

export const normalizeAuthors = (authors = []) =>
  authors
    .map((author) => String(author ?? '').trim())
    .filter(Boolean);

export const normalizeScriptMetadataInput = (input = {}) => ({
  title: String(input.title ?? '').trim(),
  description: String(input.description ?? '').trim(),
  genre: String(input.genre ?? '').trim(),
  status: String(input.status ?? '').trim() || 'draft',
  language: String(input.language ?? '').trim(),
  authors: normalizeAuthors(input.authors ?? []),
  majorSaveSequence: Number.isInteger(input.majorSaveSequence)
    ? input.majorSaveSequence
    : undefined,
  currentVersionLabel: input.currentVersionLabel
    ? String(input.currentVersionLabel).trim()
    : ''
});

export const serializeScript = (script, counts = {}, extra = {}) => ({
  id: script.publicId,
  projectId: script.projectId?.publicId ?? null,
  title: script.title,
  description: script.description ?? '',
  genre: script.genre ?? '',
  status: script.status,
  language: script.language ?? '',
  authors: script.authors ?? [],
  majorSaveSequence: script.majorSaveSequence ?? 0,
  currentVersionLabel: script.currentVersionLabel ?? null,
  lastCheckpointAt: extra.lastCheckpointAt ?? null,
  sceneNumberMode: script.sceneNumberMode,
  createdByUserId: script.createdByUserId?.publicId ?? null,
  updatedByUserId: script.updatedByUserId?.publicId ?? null,
  createdAt: script.createdAt,
  updatedAt: script.updatedAt,
  counts: {
    totalNodes: counts.totalNodes ?? 0,
    actCount: counts.actCount ?? 0,
    beatCount: counts.beatCount ?? 0,
    sceneCount: counts.sceneCount ?? 0
  }
});

export const buildScriptActivityMessage = ({
  type,
  actor,
  scriptTitle,
  nodeTitle,
  nodeType,
  sceneNumberMode
}) => {
  switch (type) {
    case 'script.created':
      return `${actor.displayName} created ${scriptTitle}.`;
    case 'script.updated':
      return `${actor.displayName} updated ${scriptTitle}.`;
    case 'script.deleted':
      return `${actor.displayName} deleted ${scriptTitle}.`;
    case 'script.scene_numbering_changed':
      return `${actor.displayName} changed scene numbering to ${sceneNumberMode}.`;
    case 'outline.node_created':
      return `${actor.displayName} added ${nodeType} ${nodeTitle}.`;
    case 'outline.node_updated':
      return `${actor.displayName} updated ${nodeType} ${nodeTitle}.`;
    case 'outline.node_moved':
      return `${actor.displayName} moved ${nodeType} ${nodeTitle}.`;
    case 'outline.node_deleted':
      return `${actor.displayName} deleted ${nodeType} ${nodeTitle}.`;
    default:
      return `${actor.displayName} updated ${scriptTitle}.`;
  }
};

export const emitScriptActivity = ({
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

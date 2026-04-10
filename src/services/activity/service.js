import { ActivityEvent } from '../../models/index.js';

export const createActivityEvent = async ({
  projectId,
  actorId,
  type,
  message,
  payload = {},
  session
}) => {
  const [event] = await ActivityEvent.create(
    [
      {
        projectId,
        actorId,
        type,
        message,
        payload
      }
    ],
    session ? { session } : {}
  );

  return event;
};

export const listProjectActivity = ({ projectId, limit = 20 }) =>
  ActivityEvent.find({ projectId })
    .populate('actorId', 'publicId username displayName avatarUrl')
    .populate('projectId', 'publicId name')
    .sort({ createdAt: -1 })
    .limit(limit);

export const listProjectsActivity = ({ projectIds, limit = 10 }) =>
  ActivityEvent.find({ projectId: { $in: projectIds } })
    .populate('actorId', 'publicId username displayName avatarUrl')
    .populate('projectId', 'publicId name')
    .sort({ createdAt: -1 })
    .limit(limit);

export const serializeActivityEvent = (event) => ({
  id: event.publicId,
  type: event.type,
  message: event.message,
  projectId: event.projectId?.publicId ?? null,
  projectTitle: event.projectId?.name ?? null,
  actor: event.actorId
    ? {
        userId: event.actorId.publicId,
        username: event.actorId.username ?? null,
        displayName: event.actorId.displayName,
        avatarUrl: event.actorId.avatarUrl ?? ''
      }
    : null,
  payload: event.payload ?? {},
  createdAt: event.createdAt
});

export const buildActivityBroadcast = ({ event, actor, projectPublicId }) => ({
  activityId: event.publicId,
  projectId: projectPublicId,
  scriptId: event.payload?.scriptId ?? null,
  type: event.type,
  actor: actor
    ? {
        userId: actor.publicId,
        username: actor.username ?? null
      }
    : null,
  targetType: event.payload?.targetType ?? null,
  targetId: event.payload?.targetId ?? null,
  ts: event.createdAt.toISOString()
});

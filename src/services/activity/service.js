import { badRequest } from '../../config/errors.js';
import { ActivityEvent } from '../../models/index.js';

export const ACTIVITY_PAGE_SIZE = 25;

const INVITE_ACTIVITY_TYPES = new Set([
  'member.invited',
  'invite.accepted',
  'invite.declined'
]);

const MEMBERSHIP_ACTIVITY_TYPES = new Set([
  'member.role_changed',
  'member.removed',
  'ownership.transferred'
]);

export const INBOX_RELEVANT_ACTIVITY_TYPES = new Set([
  ...INVITE_ACTIVITY_TYPES,
  ...MEMBERSHIP_ACTIVITY_TYPES,
  'note.created',
  'note.major_saved',
  'note.restored',
  'scene.major_saved',
  'scene.restored',
  'script.created',
  'script.deleted',
  'script.exported',
  'script.major_saved'
]);

export const TARGETED_MEMBERSHIP_ACTIVITY_TYPES = new Set([
  ...INVITE_ACTIVITY_TYPES,
  ...MEMBERSHIP_ACTIVITY_TYPES
]);

const ACTIVITY_FILTER_OPTIONS = new Set(['all', 'invites', 'membership', 'activity']);

const buildActivityTypeQuery = (filter) => {
  if (!filter || filter === 'all') {
    return null;
  }

  if (filter === 'invites') {
    return {
      $in: Array.from(INVITE_ACTIVITY_TYPES)
    };
  }

  if (filter === 'membership') {
    return {
      $in: Array.from(MEMBERSHIP_ACTIVITY_TYPES)
    };
  }

  if (filter === 'activity') {
    return {
      $nin: Array.from(new Set([...INVITE_ACTIVITY_TYPES, ...MEMBERSHIP_ACTIVITY_TYPES]))
    };
  }

  return filter;
};

export const normalizeActivityFilter = (value, { allowExactType = true } = {}) => {
  const normalized = String(value ?? 'all')
    .trim()
    .toLowerCase();

  if (!normalized || normalized === 'all') {
    return 'all';
  }

  if (ACTIVITY_FILTER_OPTIONS.has(normalized)) {
    return normalized;
  }

  if (allowExactType) {
    return normalized;
  }

  throw badRequest('Unsupported activity filter.');
};

export const getActivityCategory = (type) => {
  if (INVITE_ACTIVITY_TYPES.has(type)) {
    return 'invites';
  }

  if (MEMBERSHIP_ACTIVITY_TYPES.has(type)) {
    return 'membership';
  }

  return 'activity';
};

const buildActivityHref = ({ projectPublicId, payload = {} }) => {
  if (!projectPublicId) {
    return null;
  }

  if (payload.sceneId && payload.scriptId) {
    return `/projects/${projectPublicId}/scripts/${payload.scriptId}/editor?sceneId=${payload.sceneId}`;
  }

  if (payload.targetType === 'member') {
    return `/projects/${projectPublicId}/members`;
  }

  if (payload.targetType === 'project') {
    return `/projects/${projectPublicId}`;
  }

  if (payload.scriptId) {
    return `/projects/${projectPublicId}/scripts/${payload.scriptId}`;
  }

  if (payload.targetType === 'script' && payload.targetId) {
    return `/projects/${projectPublicId}/scripts/${payload.targetId}`;
  }

  return `/projects/${projectPublicId}`;
};

const buildActivityQuery = ({
  projectId = null,
  projectIds = null,
  filter = 'all',
  types = null,
  targetUserPublicId = null
}) => {
  const query = {};

  if (projectId) {
    query.projectId = projectId;
  } else if (Array.isArray(projectIds)) {
    query.projectId = {
      $in: projectIds
    };
  }

  if (Array.isArray(types) && types.length) {
    query.type = {
      $in: types
    };
  } else {
    const typeQuery = buildActivityTypeQuery(filter);

    if (typeQuery) {
      query.type =
        typeof typeQuery === 'string'
          ? typeQuery
          : typeQuery;
    }
  }

  if (targetUserPublicId) {
    query.$or = [
      {
        'payload.memberUserId': targetUserPublicId
      },
      {
        'payload.nextOwnerUserId': targetUserPublicId
      }
    ];
  }

  return query;
};

const populateActivityQuery = (query) =>
  query
    .populate('actorId', 'publicId username displayName avatarUrl')
    .populate('projectId', 'publicId name');

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

export const listProjectActivity = ({
  projectId,
  limit = 20,
  filter = 'all',
  page = 1
}) =>
  populateActivityQuery(
    ActivityEvent.find(
      buildActivityQuery({
        projectId,
        filter
      })
    )
  )
    .sort({ createdAt: -1 })
    .skip(Math.max(page - 1, 0) * limit)
    .limit(limit);

export const countProjectActivity = async ({ projectId, filter = 'all' }) =>
  ActivityEvent.countDocuments(
    buildActivityQuery({
      projectId,
      filter
    })
  );

export const listScriptActivity = ({ projectId, scriptPublicId, limit = 20 }) =>
  populateActivityQuery(
    ActivityEvent.find({
      projectId,
      'payload.scriptId': scriptPublicId
    })
  )
    .sort({ createdAt: -1 })
    .limit(limit);

export const listProjectsActivity = ({
  projectIds,
  limit = 10,
  filter = 'all',
  types = null
}) => {
  if (!projectIds?.length) {
    return [];
  }

  return populateActivityQuery(
    ActivityEvent.find(
      buildActivityQuery({
        projectIds,
        filter,
        types
      })
    )
  )
    .sort({ createdAt: -1 })
    .limit(limit);
};

export const listTargetedActivity = ({
  targetUserPublicId,
  limit = 40,
  types = Array.from(TARGETED_MEMBERSHIP_ACTIVITY_TYPES)
}) =>
  populateActivityQuery(
    ActivityEvent.find(
      buildActivityQuery({
        targetUserPublicId,
        types
      })
    )
  )
    .sort({ createdAt: -1 })
    .limit(limit);

export const serializeActivityEvent = (event) => {
  const projectId = event.projectId?.publicId ?? null;
  const payload = event.payload ?? {};

  return {
    id: event.publicId,
    type: event.type,
    category: getActivityCategory(event.type),
    message: event.message,
    projectId,
    projectTitle: event.projectId?.name ?? null,
    actor: event.actorId
      ? {
          userId: event.actorId.publicId,
          username: event.actorId.username ?? null,
          displayName: event.actorId.displayName,
          avatarUrl: event.actorId.avatarUrl ?? ''
        }
      : null,
    payload,
    href: buildActivityHref({
      projectPublicId: projectId,
      payload
    }),
    createdAt: event.createdAt
  };
};

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

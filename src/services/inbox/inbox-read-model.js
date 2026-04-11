import { badRequest } from '../../config/errors.js';
import { ProjectMember } from '../../models/index.js';
import {
  INBOX_RELEVANT_ACTIVITY_TYPES,
  listProjectsActivity,
  listTargetedActivity,
  serializeActivityEvent
} from '../activity/service.js';
import { getInboxReadState, isInboxItemRead } from './unread-state.js';

export const INBOX_PAGE_SIZE = 25;
export const DASHBOARD_ACTIVITY_PREVIEW_SIZE = 10;

const INBOX_FILTERS = new Set(['all', 'invites', 'membership', 'activity']);
const MAX_PROJECT_ACTIVITY_SCAN = 150;
const MAX_TARGETED_ACTIVITY_SCAN = 80;

const buildUnreadSummary = () => ({
  total: 0,
  invites: 0,
  membership: 0,
  activity: 0
});

const normalizePage = (value) => {
  const parsed = Number.parseInt(String(value ?? '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const normalizeInboxFilter = (value) => {
  const normalized = String(value ?? 'all')
    .trim()
    .toLowerCase();

  if (!normalized || normalized === 'all') {
    return 'all';
  }

  if (!INBOX_FILTERS.has(normalized)) {
    throw badRequest('Unsupported inbox filter.');
  }

  return normalized;
};

const loadPendingInviteDocs = ({ userId }) =>
  ProjectMember.find({
    userId,
    status: 'pending'
  })
    .populate('projectId', 'publicId name')
    .populate('invitedById', 'publicId username displayName')
    .sort({ invitedAt: -1, updatedAt: -1 });

const loadActiveMemberships = ({ userId }) =>
  ProjectMember.find({
    userId,
    status: 'active'
  })
    .populate('projectId', 'publicId name')
    .sort({ updatedAt: -1 });

const buildInviteMessage = (invite) => {
  const inviterName = invite.invitedBy?.displayName ?? 'A teammate';
  const projectTitle = invite.project?.title ?? 'this project';

  return `${inviterName} invited you to ${projectTitle} as ${invite.role}.`;
};

const serializeInviteRecord = (membership) => ({
  id: membership.publicId,
  status: membership.status,
  role: membership.role,
  invitedAt: membership.invitedAt,
  acceptedAt: membership.acceptedAt,
  removedAt: membership.removedAt,
  occurredAt: membership.invitedAt ?? membership.updatedAt ?? membership.createdAt,
  project: membership.projectId
    ? {
        id: membership.projectId.publicId,
        title: membership.projectId.name
      }
    : null,
  invitedBy: membership.invitedById
    ? {
        userId: membership.invitedById.publicId,
        username: membership.invitedById.username ?? null,
        displayName: membership.invitedById.displayName
      }
    : null
});

const buildInviteInboxItem = ({ membership, readState }) => {
  const invite = serializeInviteRecord(membership);
  const occurredAt = invite.occurredAt ?? invite.invitedAt ?? membership.updatedAt;
  const read = isInboxItemRead({
    readState,
    itemId: invite.id,
    occurredAt
  });

  return {
    id: invite.id,
    kind: 'invite',
    category: 'invites',
    occurredAt,
    read,
    project: invite.project,
    actor: invite.invitedBy,
    message: buildInviteMessage(invite),
    href: '/inbox',
    invite: {
      ...invite,
      read
    }
  };
};

const buildActivityInboxItem = ({ activity, readState }) => ({
  id: activity.id,
  kind: 'activity',
  category: activity.category,
  occurredAt: activity.createdAt,
  read: isInboxItemRead({
    readState,
    itemId: activity.id,
    occurredAt: activity.createdAt
  }),
  project:
    activity.projectId && activity.projectTitle
      ? {
          id: activity.projectId,
          title: activity.projectTitle
        }
      : null,
  actor: activity.actor,
  message: activity.message,
  href: activity.href,
  activity
});

const byOccurredAtDesc = (left, right) =>
  new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();

const createFilterCounts = (items) => ({
  all: items.length,
  invites: items.filter((item) => item.category === 'invites').length,
  membership: items.filter((item) => item.category === 'membership').length,
  activity: items.filter((item) => item.category === 'activity').length
});

const filterInboxItems = (items, filter) => {
  if (filter === 'all') {
    return items;
  }

  return items.filter((item) => item.category === filter);
};

const collectUnreadSummary = (items) =>
  items.reduce((summary, item) => {
    if (item.read) {
      return summary;
    }

    summary.total += 1;
    summary[item.category] += 1;
    return summary;
  }, buildUnreadSummary());

const shouldSuppressDashboardNoise = ({ activity, currentUserPublicId }) =>
  activity.category === 'activity' && activity.actor?.userId === currentUserPublicId;

const buildProjectActivityItems = async ({
  activeProjectIds,
  currentUserPublicId,
  pendingInviteIds,
  readState
}) => {
  if (!activeProjectIds.length) {
    return [];
  }

  const events = await listProjectsActivity({
    projectIds: activeProjectIds,
    limit: MAX_PROJECT_ACTIVITY_SCAN,
    types: Array.from(INBOX_RELEVANT_ACTIVITY_TYPES)
  });

  return events
    .map((event) => serializeActivityEvent(event))
    .filter((activity) => {
      if (activity.type === 'member.invited' && pendingInviteIds.has(activity.payload?.targetId)) {
        return false;
      }

      return !shouldSuppressDashboardNoise({
        activity,
        currentUserPublicId
      });
    })
    .map((activity) =>
      buildActivityInboxItem({
        activity,
        readState
      })
    );
};

const buildTargetedActivityItems = async ({ user, pendingInviteIds, readState }) => {
  const events = await listTargetedActivity({
    targetUserPublicId: user.publicId,
    limit: MAX_TARGETED_ACTIVITY_SCAN
  });

  const seen = new Set();

  return events
    .map((event) => serializeActivityEvent(event))
    .filter((activity) => {
      if (seen.has(activity.id)) {
        return false;
      }

      seen.add(activity.id);

      if (activity.type === 'member.invited' && pendingInviteIds.has(activity.payload?.targetId)) {
        return false;
      }

      return true;
    })
    .map((activity) =>
      buildActivityInboxItem({
        activity,
        readState
      })
    );
};

const dedupeInboxItems = (items) => {
  const seen = new Set();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
};

export const listPendingInboxInvites = async ({ user }) => {
  const [memberships, readState] = await Promise.all([
    loadPendingInviteDocs({
      userId: user._id
    }),
    getInboxReadState({
      userId: user._id
    })
  ]);

  return memberships.map((membership) =>
    buildInviteInboxItem({
      membership,
      readState
    }).invite
  );
};

export const buildUserInboxReadModel = async ({
  user,
  filter = 'all',
  page = 1,
  pageSize = INBOX_PAGE_SIZE
}) => {
  const normalizedFilter = normalizeInboxFilter(filter);
  const normalizedPage = normalizePage(page);

  const [readState, inviteMemberships, activeMemberships] = await Promise.all([
    getInboxReadState({
      userId: user._id
    }),
    loadPendingInviteDocs({
      userId: user._id
    }),
    loadActiveMemberships({
      userId: user._id
    })
  ]);

  const inviteItems = inviteMemberships.map((membership) =>
    buildInviteInboxItem({
      membership,
      readState
    })
  );
  const pendingInviteIds = new Set(inviteItems.map((item) => item.id));
  const activeProjectIds = activeMemberships
    .map((membership) => membership.projectId?._id)
    .filter(Boolean);
  const activeProjectPublicIds = activeMemberships
    .map((membership) => membership.projectId?.publicId)
    .filter(Boolean);

  const [projectActivityItems, targetedActivityItems] = await Promise.all([
    buildProjectActivityItems({
      activeProjectIds,
      currentUserPublicId: user.publicId,
      pendingInviteIds,
      readState
    }),
    buildTargetedActivityItems({
      user,
      pendingInviteIds,
      readState
    })
  ]);

  const allItems = dedupeInboxItems([
    ...inviteItems,
    ...projectActivityItems,
    ...targetedActivityItems
  ]).sort(byOccurredAtDesc);
  const filteredItems = filterInboxItems(allItems, normalizedFilter);
  const offset = (normalizedPage - 1) * pageSize;
  const pagedItems = filteredItems.slice(offset, offset + pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  return {
    filter: normalizedFilter,
    filters: createFilterCounts(allItems),
    allItems,
    items: pagedItems,
    invites: inviteItems.map((item) => item.invite),
    activityPreview: allItems.filter((item) => item.kind === 'activity').slice(0, DASHBOARD_ACTIVITY_PREVIEW_SIZE),
    summary: {
      unread: collectUnreadSummary(allItems),
      pendingInviteCount: inviteItems.length,
      totalCount: allItems.length
    },
    pagination: {
      page: normalizedPage,
      pageSize,
      totalItems: filteredItems.length,
      totalPages,
      hasPreviousPage: normalizedPage > 1,
      hasNextPage: normalizedPage < totalPages
    },
    activeProjectIds: activeProjectPublicIds,
    lastReadAllAt: readState.lastReadAllAt
  };
};

export const getInboxItemForUser = async ({ user, itemId }) => {
  const inbox = await buildUserInboxReadModel({
    user,
    filter: 'all',
    page: 1,
    pageSize: MAX_PROJECT_ACTIVITY_SCAN
  });

  return inbox.allItems.find((item) => item.id === itemId) ?? null;
};

export const getUserInboxSummary = async ({ user }) => {
  const inbox = await buildUserInboxReadModel({
    user,
    filter: 'all',
    page: 1,
    pageSize: DASHBOARD_ACTIVITY_PREVIEW_SIZE
  });

  return {
    unread: inbox.summary.unread,
    pendingInviteCount: inbox.summary.pendingInviteCount,
    activeProjectIds: inbox.activeProjectIds
  };
};

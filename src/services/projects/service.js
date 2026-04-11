import mongoose from 'mongoose';

import { badRequest, forbidden, notFound } from '../../config/errors.js';
import { Project, ProjectMember, User } from '../../models/index.js';
import { findProjectMemberByPublicId } from '../../models/lookups.js';
import { generatePublicId } from '../../models/plugins/public-id.js';
import {
  buildActivityBroadcast,
  countProjectActivity,
  createActivityEvent,
  listProjectActivity,
  normalizeActivityFilter,
  serializeActivityEvent
} from '../activity/service.js';
import { createAuditLog, listProjectAudit, serializeAuditLog } from '../audit/service.js';
import { buildDashboardSummary } from '../dashboard/dashboard-summary.js';
import {
  emitToProjectRoom,
  emitToUserRoom,
  evictUserFromProjectRooms
} from '../realtime/broadcaster.js';
import { presenceService } from '../presence/service.js';
import { listProjectScriptsReadModel } from '../scripts/service.js';

const MEMBER_STATUS_ORDER = {
  active: 0,
  pending: 1,
  declined: 2,
  removed: 3
};

const MEMBER_ROLE_ORDER = {
  owner: 0,
  editor: 1,
  reviewer: 2
};

export const getStarterProjectTitle = (locale = 'en') => {
  switch (locale) {
    case 'es':
      return 'Mi primer proyecto';
    case 'ja':
      return '最初のプロジェクト';
    default:
      return 'My First Project';
  }
};

const serializeUserSummary = (user) => ({
  id: user.publicId,
  email: user.email,
  username: user.username ?? null,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl ?? '',
  locale: user.preferences?.locale || user.locale
});

export const serializeMember = (member) => ({
  id: member.publicId,
  role: member.role,
  status: member.status,
  invitedAt: member.invitedAt,
  acceptedAt: member.acceptedAt,
  joinedAt: member.joinedAt,
  removedAt: member.removedAt,
  invitedByUserId: member.invitedById?.publicId ?? null,
  user: member.userId ? serializeUserSummary(member.userId) : null
});

export const serializeProject = ({ membership, project, memberCounts = null }) => ({
  id: project.publicId,
  title: project.name,
  description: project.description,
  role: membership?.role ?? null,
  membershipStatus: membership?.status ?? null,
  ownerUserId: project.ownerId?.publicId ?? null,
  defaultLocale: project.defaultLocale,
  updatedAt: project.updatedAt,
  memberCounts
});

const buildMemberCounts = (members) =>
  members.reduce(
    (counts, member) => {
      counts.total += 1;
      counts.byStatus[member.status] = (counts.byStatus[member.status] ?? 0) + 1;
      return counts;
    },
    {
      total: 0,
      byStatus: {
        active: 0,
        pending: 0,
        declined: 0,
        removed: 0
      }
    }
  );

const loadProjectMembers = ({ projectId }) =>
  ProjectMember.find({ projectId })
    .populate('userId', 'publicId email username displayName avatarUrl locale preferences')
    .populate('invitedById', 'publicId username displayName')
    .sort({ createdAt: 1 });

const buildProjectActivityMessage = ({
  type,
  actor,
  projectTitle,
  subjectDisplayName,
  role
}) => {
  switch (type) {
    case 'project.created':
      return `${actor.displayName} created ${projectTitle}.`;
    case 'project.updated':
      return `${actor.displayName} renamed the project.`;
    case 'member.invited':
      return `${actor.displayName} invited ${subjectDisplayName} as ${role}.`;
    case 'invite.accepted':
      return `${subjectDisplayName} accepted the invite.`;
    case 'invite.declined':
      return `${subjectDisplayName} declined the invite.`;
    case 'member.role_changed':
      return `${actor.displayName} changed ${subjectDisplayName} to ${role}.`;
    case 'member.removed':
      return `${actor.displayName} removed ${subjectDisplayName}.`;
    case 'ownership.transferred':
      return `${actor.displayName} transferred ownership to ${subjectDisplayName}.`;
    default:
      return `${actor.displayName} updated ${projectTitle}.`;
  }
};

const createProjectRecords = async ({
  owner,
  title,
  session,
  starter = false
}) => {
  const now = new Date();

  const [project] = await Project.create(
    [
      {
        name: title,
        ownerId: owner._id,
        defaultLocale: owner.preferences?.locale || owner.locale,
        status: 'active'
      }
    ],
    { session }
  );

  const membership = {
    publicId: generatePublicId('pmm'),
    projectId: project._id,
    userId: owner._id,
    role: 'owner',
    status: 'active',
    invitedById: owner._id,
    invitedAt: now,
    acceptedAt: now,
    joinedAt: now,
    removedAt: null
  };

  await ProjectMember.updateOne(
    {
      projectId: project._id,
      userId: owner._id
    },
    {
      $setOnInsert: {
        publicId: membership.publicId,
        projectId: project._id,
        userId: owner._id
      },
      $set: {
        role: 'owner',
        status: 'active',
        invitedById: owner._id,
        invitedAt: now,
        acceptedAt: now,
        joinedAt: now,
        removedAt: null
      }
    },
    {
      upsert: true,
      session
    }
  );

  const activityEvent = await createActivityEvent({
    projectId: project._id,
    actorId: owner._id,
    type: 'project.created',
    message: buildProjectActivityMessage({
      type: 'project.created',
      actor: owner,
      projectTitle: project.name
    }),
    payload: {
      targetType: 'project',
      targetId: project.publicId,
      starter
    },
    session
  });

  await createAuditLog({
    scope: 'project',
    projectId: project._id,
    actorId: owner._id,
    action: 'project.created',
    targetType: 'project',
    targetId: project.publicId,
    metadata: {
      title: project.name,
      starter
    },
    session
  });

  return {
    project,
    membership,
    activityEvent
  };
};

export const createStarterProjectForUser = async ({ user, session }) => {
  const { project } = await createProjectRecords({
    owner: user,
    title: getStarterProjectTitle(user.preferences?.locale || user.locale),
    session,
    starter: true
  });

  user.starterProjectId = project._id;
  return project;
};

export const createProjectForUser = async ({ owner, title }) => {
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    throw badRequest('Project title is required.');
  }

  let createdProject = null;
  let createdActivity = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const records = await createProjectRecords({
        owner,
        title: trimmedTitle,
        session
      });

      createdProject = records.project;
      createdActivity = records.activityEvent;
    });
  } finally {
    await session.endSession();
  }

  emitToProjectRoom(
    createdProject.publicId,
    'activity:new',
    buildActivityBroadcast({
      event: createdActivity,
      actor: owner,
      projectPublicId: createdProject.publicId
    })
  );

  return Project.findById(createdProject._id).populate(
    'ownerId',
    'publicId displayName username'
  );
};

export const updateProjectDetails = async ({ project, actor, title }) => {
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    throw badRequest('Project title is required.');
  }

  if (trimmedTitle === project.name) {
    return project;
  }

  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      project.name = trimmedTitle;
      await project.save({ session });

      activityEvent = await createActivityEvent({
        projectId: project._id,
        actorId: actor._id,
        type: 'project.updated',
        message: buildProjectActivityMessage({
          type: 'project.updated',
          actor,
          projectTitle: project.name
        }),
        payload: {
          targetType: 'project',
          targetId: project.publicId,
          changedFields: ['title']
        },
        session
      });

      await createAuditLog({
        scope: 'project',
        projectId: project._id,
        actorId: actor._id,
        action: 'project.updated',
        targetType: 'project',
        targetId: project.publicId,
        metadata: {
          changedFields: ['title'],
          title: project.name
        },
        session
      });
    });
  } finally {
    await session.endSession();
  }

  emitToProjectRoom(
    project.publicId,
    'activity:new',
    buildActivityBroadcast({
      event: activityEvent,
      actor,
      projectPublicId: project.publicId
    })
  );

  return project;
};

export const listUserProjects = async ({ userId }) => {
  const memberships = await ProjectMember.find({
    userId,
    status: 'active'
  })
    .populate('projectId', 'publicId name description ownerId defaultLocale updatedAt')
    .sort({ updatedAt: -1 });

  const projectIds = memberships.map((membership) => membership.projectId?._id).filter(Boolean);
  const memberRows = projectIds.length
    ? await ProjectMember.find({ projectId: { $in: projectIds } }).select('projectId status')
    : [];

  const countsByProject = new Map();
  for (const row of memberRows) {
    const key = String(row.projectId);
    const bucket =
      countsByProject.get(key) ??
      {
        total: 0,
        byStatus: {
          active: 0,
          pending: 0,
          declined: 0,
          removed: 0
        }
      };

    bucket.total += 1;
    bucket.byStatus[row.status] = (bucket.byStatus[row.status] ?? 0) + 1;
    countsByProject.set(key, bucket);
  }

  return memberships
    .filter((membership) => membership.projectId)
    .map((membership) =>
      serializeProject({
        membership,
        project: membership.projectId,
        memberCounts: countsByProject.get(String(membership.projectId._id)) ?? null
      })
    );
};

export const getDashboardReadModel = async ({ user }) => {
  const [projects, dashboardSummary] = await Promise.all([
    listUserProjects({
      userId: user._id
    }),
    buildDashboardSummary({
      user
    })
  ]);

  return {
    projects,
    invites: dashboardSummary.invites,
    unreadSummary: dashboardSummary.unreadSummary,
    pendingInviteCount: dashboardSummary.pendingInviteCount,
    activeProjectIds: dashboardSummary.activeProjectIds,
    activity: dashboardSummary.activity
  };
};

export const getProjectMembersReadModel = async ({ projectId }) => {
  const members = await loadProjectMembers({ projectId });

  return members
    .sort((left, right) => {
      const statusDelta =
        (MEMBER_STATUS_ORDER[left.status] ?? 99) - (MEMBER_STATUS_ORDER[right.status] ?? 99);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const roleDelta =
        (MEMBER_ROLE_ORDER[left.role] ?? 99) - (MEMBER_ROLE_ORDER[right.role] ?? 99);
      if (roleDelta !== 0) {
        return roleDelta;
      }

      return (left.userId?.displayName ?? '').localeCompare(right.userId?.displayName ?? '');
    })
    .map(serializeMember);
};

export const getProjectWorkspaceReadModel = async ({ project, membership }) => {
  const [members, activity, scripts] = await Promise.all([
    getProjectMembersReadModel({ projectId: project._id }),
    listProjectActivity({ projectId: project._id, limit: 10 }),
    listProjectScriptsReadModel({ projectId: project._id })
  ]);

  return {
    project: serializeProject({
      membership,
      project
    }),
    members,
    memberSummary: buildMemberCounts(
      members.map((member) => ({
        status: member.status
      }))
    ),
    activity: activity.map(serializeActivityEvent),
    scripts,
    canManageMembers: membership.role === 'owner'
  };
};

export const getProjectActivityReadModel = async ({
  projectId,
  limit = 20,
  page = 1,
  filter = 'all'
}) => {
  const normalizedFilter = normalizeActivityFilter(filter);
  const [activity, totalItems] = await Promise.all([
    listProjectActivity({
      projectId,
      limit,
      page,
      filter: normalizedFilter
    }),
    countProjectActivity({
      projectId,
      filter: normalizedFilter
    })
  ]);
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return {
    items: activity.map(serializeActivityEvent),
    filter: normalizedFilter,
    pagination: {
      page,
      pageSize: limit,
      totalItems,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    }
  };
};

export const getProjectAuditReadModel = async ({ projectId, limit = 40 }) => {
  const logs = await listProjectAudit({
    projectId,
    limit
  });

  return logs.map(serializeAuditLog);
};

const resolveMemberRecord = async ({ projectId, memberPublicId }) => {
  const member = await findProjectMemberByPublicId({
    projectId,
    memberPublicId
  });

  if (!member) {
    throw notFound('Project member not found.');
  }

  return member;
};

export const changeMemberRole = async ({
  project,
  actor,
  memberPublicId,
  nextRole
}) => {
  if (!['editor', 'reviewer'].includes(nextRole)) {
    throw badRequest('Role must be editor or reviewer.');
  }

  const target = await resolveMemberRecord({
    projectId: project._id,
    memberPublicId
  });

  if (target.role === 'owner') {
    throw forbidden('Owner role cannot be changed through this route.');
  }

  if (target.status !== 'active') {
    throw badRequest('Only active members can have their role changed.');
  }

  if (target.role === nextRole) {
    const populated = await ProjectMember.findById(target._id).populate(
      'userId',
      'publicId email username displayName avatarUrl locale preferences'
    );
    return serializeMember(populated);
  }

  let activityEvent = null;
  let targetUser = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      target.role = nextRole;
      await target.save({ session });

      targetUser = await User.findById(target.userId).session(session);

      activityEvent = await createActivityEvent({
        projectId: project._id,
        actorId: actor._id,
        type: 'member.role_changed',
        message: buildProjectActivityMessage({
          type: 'member.role_changed',
          actor,
          projectTitle: project.name,
          subjectDisplayName: targetUser.displayName,
          role: nextRole
        }),
        payload: {
          targetType: 'member',
          targetId: target.publicId,
          memberUserId: targetUser.publicId,
          newRole: nextRole
        },
        session
      });

      await createAuditLog({
        scope: 'project',
        projectId: project._id,
        actorId: actor._id,
        action: 'member.role_changed',
        targetType: 'member',
        targetId: target.publicId,
        metadata: {
          userId: targetUser.publicId,
          role: nextRole
        },
        session
      });
    });
  } finally {
    await session.endSession();
  }

  emitToUserRoom(targetUser.publicId, 'permission:changed', {
    projectId: project.publicId,
    newRole: nextRole,
    ts: activityEvent.createdAt.toISOString()
  });
  emitToProjectRoom(
    project.publicId,
    'activity:new',
    buildActivityBroadcast({
      event: activityEvent,
      actor,
      projectPublicId: project.publicId
    })
  );

  const updatedMember = await ProjectMember.findById(target._id)
    .populate('userId', 'publicId email username displayName avatarUrl locale preferences')
    .populate('invitedById', 'publicId username displayName');

  return serializeMember(updatedMember);
};

export const removeMemberFromProject = async ({
  project,
  actor,
  memberPublicId
}) => {
  const target = await resolveMemberRecord({
    projectId: project._id,
    memberPublicId
  });

  if (String(target.userId) === String(actor._id)) {
    throw forbidden('Owners cannot remove themselves through this route.');
  }

  if (target.status === 'removed') {
    throw badRequest('This member has already been removed.');
  }

  let activityEvent = null;
  let targetUser = null;
  let previousStatus = target.status;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      previousStatus = target.status;
      target.status = 'removed';
      target.removedAt = now;
      await target.save({ session });

      targetUser = await User.findById(target.userId).session(session);

      activityEvent = await createActivityEvent({
        projectId: project._id,
        actorId: actor._id,
        type: 'member.removed',
        message: buildProjectActivityMessage({
          type: 'member.removed',
          actor,
          projectTitle: project.name,
          subjectDisplayName: targetUser.displayName
        }),
        payload: {
          targetType: 'member',
          targetId: target.publicId,
          memberUserId: targetUser.publicId,
          previousStatus
        },
        session
      });

      await createAuditLog({
        scope: 'project',
        projectId: project._id,
        actorId: actor._id,
        action: 'member.removed',
        targetType: 'member',
        targetId: target.publicId,
        metadata: {
          userId: targetUser.publicId,
          previousStatus
        },
        session
      });
    });
  } finally {
    await session.endSession();
  }

  if (previousStatus === 'pending') {
    emitToUserRoom(targetUser.publicId, 'invite:updated', {
      inviteId: target.publicId,
      status: 'removed',
      projectId: project.publicId,
      ts: activityEvent.createdAt.toISOString()
    });
  } else {
    emitToUserRoom(targetUser.publicId, 'project:access-revoked', {
      projectId: project.publicId,
      reason: 'member_removed',
      ts: activityEvent.createdAt.toISOString()
    });
  }

  await evictUserFromProjectRooms({
    userPublicId: targetUser.publicId,
    projectPublicId: project.publicId
  });
  const presence = presenceService.forceRemoveUser(project.publicId, targetUser.publicId);
  if (presence.removed) {
    emitToProjectRoom(project.publicId, 'presence:user-left', {
      userId: targetUser.publicId
    });
  }

  emitToProjectRoom(
    project.publicId,
    'activity:new',
    buildActivityBroadcast({
      event: activityEvent,
      actor,
      projectPublicId: project.publicId
    })
  );

  const updatedMember = await ProjectMember.findById(target._id)
    .populate('userId', 'publicId email username displayName avatarUrl locale preferences')
    .populate('invitedById', 'publicId username displayName');

  return serializeMember(updatedMember);
};

export const transferProjectOwnership = async ({
  project,
  actor,
  memberPublicId
}) => {
  const target = await resolveMemberRecord({
    projectId: project._id,
    memberPublicId
  });

  if (target.status !== 'active') {
    throw badRequest('Ownership can only be transferred to an active member.');
  }

  if (String(target.userId) === String(actor._id)) {
    throw badRequest('Ownership is already assigned to this user.');
  }

  let previousOwner = null;
  let nextOwnerUser = null;
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      previousOwner = await ProjectMember.findOne({
        projectId: project._id,
        userId: actor._id,
        role: 'owner',
        status: 'active'
      }).session(session);

      if (!previousOwner) {
        throw forbidden('Only the current owner can transfer ownership.');
      }

      previousOwner.role = 'editor';
      target.role = 'owner';
      await Promise.all([
        previousOwner.save({ session }),
        target.save({ session })
      ]);

      project.ownerId = target.userId;
      await project.save({ session });

      nextOwnerUser = await User.findById(target.userId).session(session);

      activityEvent = await createActivityEvent({
        projectId: project._id,
        actorId: actor._id,
        type: 'ownership.transferred',
        message: buildProjectActivityMessage({
          type: 'ownership.transferred',
          actor,
          projectTitle: project.name,
          subjectDisplayName: nextOwnerUser.displayName
        }),
        payload: {
          targetType: 'member',
          targetId: target.publicId,
          previousOwnerMemberId: previousOwner.publicId,
          nextOwnerUserId: nextOwnerUser.publicId
        },
        session
      });

      await createAuditLog({
        scope: 'project',
        projectId: project._id,
        actorId: actor._id,
        action: 'ownership.transferred',
        targetType: 'member',
        targetId: target.publicId,
        metadata: {
          previousOwnerMemberId: previousOwner.publicId,
          nextOwnerUserId: nextOwnerUser.publicId
        },
        session
      });
    });
  } finally {
    await session.endSession();
  }

  emitToUserRoom(actor.publicId, 'permission:changed', {
    projectId: project.publicId,
    newRole: 'editor',
    ts: activityEvent.createdAt.toISOString()
  });
  emitToUserRoom(nextOwnerUser.publicId, 'permission:changed', {
    projectId: project.publicId,
    newRole: 'owner',
    ts: activityEvent.createdAt.toISOString()
  });
  emitToProjectRoom(
    project.publicId,
    'activity:new',
    buildActivityBroadcast({
      event: activityEvent,
      actor,
      projectPublicId: project.publicId
    })
  );

  return {
    previousOwnerMemberId: previousOwner.publicId,
    newOwnerMemberId: target.publicId,
    newOwnerUserId: nextOwnerUser.publicId
  };
};

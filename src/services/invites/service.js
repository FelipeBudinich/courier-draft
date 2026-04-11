import mongoose from 'mongoose';

import { badRequest, conflict, forbidden, notFound } from '../../config/errors.js';
import { logger } from '../../config/logger.js';
import { ProjectMember, User } from '../../models/index.js';
import { generatePublicId } from '../../models/plugins/public-id.js';
import { buildActivityBroadcast, createActivityEvent } from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import { normalizeUsername } from '../auth/username.js';
import { clearInboxItemRead } from '../inbox/unread-state.js';
import { emitToProjectRoom, emitToUserRoom } from '../realtime/broadcaster.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const serializeInvite = (membership) => ({
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

const serializeInviteMember = ({ membership, targetUser, actor }) => ({
  id: membership.publicId,
  role: membership.role,
  status: membership.status,
  invitedAt: membership.invitedAt,
  acceptedAt: membership.acceptedAt ?? null,
  joinedAt: membership.joinedAt ?? null,
  removedAt: membership.removedAt ?? null,
  invitedByUserId: actor.publicId,
  user: targetUser
    ? {
        id: targetUser.publicId,
        email: targetUser.email,
        username: targetUser.username ?? null,
        displayName: targetUser.displayName,
        avatarUrl: targetUser.avatarUrl ?? '',
        locale: targetUser.preferences?.locale || targetUser.locale
      }
    : null
});

const buildInviteMessage = ({ type, actor, targetUser, project, role }) => {
  switch (type) {
    case 'member.invited':
      return `${actor.displayName} invited ${targetUser.displayName} as ${role}.`;
    case 'invite.accepted':
      return `${targetUser.displayName} accepted the invite.`;
    case 'invite.declined':
      return `${targetUser.displayName} declined the invite.`;
    default:
      return `${actor.displayName} updated invitations for ${project.name}.`;
  }
};

const resolveInviteTarget = async ({ actor, userId, identifier }) => {
  if (userId) {
    const target = await User.findOne({
      publicId: userId
    });

    if (!target) {
      throw notFound('Selected user was not found.');
    }

    if (String(target._id) === String(actor._id)) {
      throw forbidden('You cannot invite yourself to a project.');
    }

    return target;
  }

  if (!identifier?.trim()) {
    throw badRequest('A selected user is required to send an invite.');
  }

  const normalized = normalizeUsername(identifier);
  const target = await User.findOne({
    $or: [
      { publicId: identifier.trim() },
      { email: identifier.trim().toLowerCase() },
      { username: normalized }
    ]
  });

  if (!target) {
    throw notFound('Selected user was not found.');
  }

  if (String(target._id) === String(actor._id)) {
    throw forbidden('You cannot invite yourself to a project.');
  }

  return target;
};

export const searchInviteCandidates = async ({ currentUser, query, limit = 8 }) => {
  const trimmed = query?.trim();
  if (!trimmed) {
    return [];
  }

  const pattern = new RegExp(escapeRegex(trimmed), 'i');

  const users = await User.find({
    _id: { $ne: currentUser._id },
    $or: [
      { displayName: pattern },
      { email: pattern },
      { username: pattern }
    ]
  })
    .sort({ username: 1, email: 1 })
    .limit(limit)
    .select('publicId email username displayName avatarUrl');

  return users.map((user) => ({
    id: user.publicId,
    email: user.email,
    username: user.username ?? null,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? ''
  }));
};

export const listPendingInvitesForUser = async ({ userId }) => {
  const invites = await ProjectMember.find({
    userId,
    status: 'pending'
  })
    .populate('projectId', 'publicId name')
    .populate('invitedById', 'publicId username displayName')
    .sort({ invitedAt: -1, updatedAt: -1 });

  return invites.map(serializeInvite);
};

export const createProjectInvite = async ({
  project,
  actor,
  role,
  userId,
  identifier
}) => {
  if (!['editor', 'reviewer'].includes(role)) {
    throw badRequest('Invites can only assign editor or reviewer roles.');
  }

  const targetUser = await resolveInviteTarget({
    actor,
    userId,
    identifier
  });

  const existingMembership = await ProjectMember.findOne({
    projectId: project._id,
    userId: targetUser._id
  });

  if (existingMembership?.status === 'pending') {
    throw conflict('That user already has a pending invite for this project.');
  }

  if (existingMembership?.status === 'active') {
    throw conflict('That user is already an active member of this project.');
  }

  const membershipPublicId = existingMembership?.publicId ?? generatePublicId('pmm');
  let membership = null;
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const now = new Date();

      if (!existingMembership) {
        membership = await ProjectMember.findOneAndUpdate(
          {
            projectId: project._id,
            userId: targetUser._id
          },
          {
            $setOnInsert: {
              publicId: membershipPublicId,
              projectId: project._id,
              userId: targetUser._id
            },
            $set: {
              role,
              status: 'pending',
              invitedById: actor._id,
              invitedAt: now,
              acceptedAt: null,
              joinedAt: null,
              removedAt: null
            }
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
            session
          }
        );
      } else {
        membership = await ProjectMember.findOneAndUpdate(
          {
            _id: existingMembership._id
          },
          {
            $set: {
              role,
              status: 'pending',
              invitedById: actor._id,
              invitedAt: now,
              acceptedAt: null,
              joinedAt: null,
              removedAt: null
            }
          },
          {
            new: true,
            session
          }
        );
      }

      if (!membership) {
        throw conflict('That user already has a membership record for this project.');
      }

      activityEvent = await createActivityEvent({
        projectId: project._id,
        actorId: actor._id,
        type: 'member.invited',
        message: buildInviteMessage({
          type: 'member.invited',
          actor,
          targetUser,
          project,
          role
        }),
        payload: {
          targetType: 'member',
          targetId: membership.publicId,
          memberUserId: targetUser.publicId,
          role
        },
        session
      });

      await createAuditLog({
        scope: 'project',
        projectId: project._id,
        actorId: actor._id,
        action: 'invite.created',
        targetType: 'member',
        targetId: membership.publicId,
        metadata: {
          userId: targetUser.publicId,
          role
        },
        session
      });
    });
  } finally {
    await session.endSession();
  }

  emitToUserRoom(targetUser.publicId, 'invite:created', {
    inviteId: membership.publicId,
    projectId: project.publicId,
    projectTitle: project.name,
    role,
    invitedBy: {
      userId: actor.publicId,
      username: actor.username ?? null
    },
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

  try {
    await clearInboxItemRead({
      userId: targetUser._id,
      itemId: membership.publicId
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        targetUserId: targetUser.publicId,
        inviteId: membership.publicId
      },
      'Failed to clear inbox read state for invite'
    );
  }

  return serializeInviteMember({
    membership,
    targetUser,
    actor
  });
};

const resolveInviteForUser = async ({ invitePublicId, user }) => {
  const invite = await ProjectMember.findOne({
    publicId: invitePublicId,
    userId: user._id
  }).populate('projectId', 'publicId name');

  if (!invite) {
    throw notFound('Invite not found.');
  }

  if (invite.status !== 'pending') {
    throw badRequest('Only pending invites can be updated.');
  }

  return invite;
};

const updateInviteStatus = async ({
  invitePublicId,
  user,
  nextStatus,
  auditAction,
  activityType
}) => {
  const invite = await resolveInviteForUser({
    invitePublicId,
    user
  });

  let activityEvent = null;
  const ts = new Date();

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const sessionInvite = await ProjectMember.findById(invite._id).session(session);
      if (!sessionInvite || sessionInvite.status !== 'pending') {
        throw badRequest('Only pending invites can be updated.');
      }

      sessionInvite.status = nextStatus;
      if (nextStatus === 'active') {
        sessionInvite.acceptedAt = ts;
        sessionInvite.joinedAt = ts;
        sessionInvite.removedAt = null;
      } else {
        sessionInvite.acceptedAt = null;
      }

      await sessionInvite.save({ session });

      activityEvent = await createActivityEvent({
        projectId: invite.projectId._id,
        actorId: user._id,
        type: activityType,
        message: buildInviteMessage({
          type: activityType,
          actor: user,
          targetUser: user,
          project: invite.projectId
        }),
        payload: {
          targetType: 'member',
          targetId: invite.publicId,
          memberUserId: user.publicId,
          status: nextStatus
        },
        session
      });

      await createAuditLog({
        scope: 'project',
        projectId: invite.projectId._id,
        actorId: user._id,
        action: auditAction,
        targetType: 'member',
        targetId: invite.publicId,
        metadata: {
          userId: user.publicId,
          status: nextStatus
        },
        session
      });
    });
  } finally {
    await session.endSession();
  }

  emitToUserRoom(user.publicId, 'invite:updated', {
    inviteId: invite.publicId,
    status: nextStatus === 'active' ? 'accepted' : nextStatus,
    projectId: invite.projectId.publicId,
    ts: activityEvent.createdAt.toISOString()
  });
  emitToProjectRoom(
    invite.projectId.publicId,
    'activity:new',
    buildActivityBroadcast({
      event: activityEvent,
      actor: user,
      projectPublicId: invite.projectId.publicId
    })
  );

  return {
    id: invite.publicId,
    status: nextStatus,
    projectId: invite.projectId.publicId
  };
};

export const acceptInvite = ({ invitePublicId, user }) =>
  updateInviteStatus({
    invitePublicId,
    user,
    nextStatus: 'active',
    auditAction: 'invite.accepted',
    activityType: 'invite.accepted'
  });

export const declineInvite = ({ invitePublicId, user }) =>
  updateInviteStatus({
    invitePublicId,
    user,
    nextStatus: 'declined',
    auditAction: 'invite.declined',
    activityType: 'invite.declined'
  });

import { roleHelpers } from '../../middleware/auth.js';

export const canReadNote = (projectRole) => Boolean(projectRole);

export const canCreateNote = (projectRole) => Boolean(projectRole);

export const canEditNote = ({
  projectRole,
  currentUserId,
  authorUserId
}) =>
  roleHelpers.canEditNote(projectRole, currentUserId, authorUserId);

export const canDeleteNote = ({
  projectRole,
  currentUserId,
  authorUserId
}) =>
  roleHelpers.canEditNote(projectRole, currentUserId, authorUserId);

import { forbidden, notFound, unauthorized } from '../config/errors.js';
import { findProjectMembershipByPublicId } from '../models/lookups.js';

const roleRank = {
  reviewer: 1,
  editor: 2,
  owner: 3
};

export const roleHelpers = {
  roleRank,
  hasMinimumRole(currentRole, minimumRole) {
    return (roleRank[currentRole] ?? 0) >= (roleRank[minimumRole] ?? 0);
  },
  canEditProjectContent(role) {
    return this.hasMinimumRole(role, 'editor');
  },
  canEditNote(role, currentUserId, authorId) {
    if (this.hasMinimumRole(role, 'editor')) {
      return true;
    }

    return role === 'reviewer' && String(currentUserId) === String(authorId);
  }
};

const renderFragmentAuthError = (res) =>
  res.status(401).render('pages/fragment-error.njk', {
    title: 'Authentication required',
    message: 'Sign in to view this fragment.'
  });

export const requireAuth = (req, res, next) => {
  if (req.currentUser) {
    return next();
  }

  if (req.surface === 'api') {
    return next(unauthorized());
  }

  if (req.surface === 'fragment') {
    return renderFragmentAuthError(res);
  }

  const returnTo = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?returnTo=${returnTo}`);
};

export const loadProjectMembership = (req, _res, next) => {
  Promise.resolve()
    .then(() =>
      findProjectMembershipByPublicId({
        projectPublicId: req.params.projectId,
        userId: req.currentUser?._id
      })
    )
    .then(({ project, membership }) => {
      if (!project || !membership) {
        return next(notFound('Project not found.'));
      }

      req.project = project;
      req.projectMembership = membership;
      req.projectRole = membership.role;
      next();
    })
    .catch(next);
};

export const requireProjectRole = (minimumRole) => (req, _res, next) => {
  if (!req.projectMembership) {
    return next(unauthorized());
  }

  if (!roleHelpers.hasMinimumRole(req.projectMembership.role, minimumRole)) {
    return next(forbidden('You do not have permission to access this project area.'));
  }

  next();
};

export const requireNoteMutationAccess = (req, _res, next) => {
  if (!req.note) {
    return next(notFound('Note not found.'));
  }

  const canEdit = roleHelpers.canEditNote(
    req.projectRole,
    req.currentUser._id,
    req.note.authorId
  );

  if (!canEdit) {
    return next(forbidden('You do not have permission to modify this note.'));
  }

  next();
};

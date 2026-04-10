import {
  forbidden,
  notFound,
  onboardingRequired,
  unauthorized
} from '../config/errors.js';
import { findProjectMembershipByPublicId } from '../models/lookups.js';
import { buildOnboardingRedirect } from '../services/auth/return-to.js';
import { hasCompletedOnboarding } from '../services/auth/service.js';

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

const renderFragmentOnboardingError = (res) =>
  res.status(403).render('pages/fragment-error.njk', {
    title: 'Profile incomplete',
    message: 'Choose a username before using this part of the app.'
  });

const isAllowedDuringOnboarding = (req) => {
  const pathname = req.path;
  const method = req.method.toUpperCase();

  if (method === 'POST' && pathname === '/logout') {
    return true;
  }

  if (method === 'POST' && pathname === '/locale') {
    return true;
  }

  if (method === 'GET' && pathname === '/settings/profile') {
    return true;
  }

  if (pathname === '/api/v1/me' && (method === 'GET' || method === 'PATCH')) {
    return true;
  }

  if (pathname === '/api/v1/me/preferences' && method === 'PATCH') {
    return true;
  }

  return false;
};

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

export const enforceOnboarding = (req, res, next) => {
  if (!req.currentUser || hasCompletedOnboarding(req.currentUser)) {
    return next();
  }

  if (isAllowedDuringOnboarding(req)) {
    return next();
  }

  if (req.originalUrl?.startsWith('/api/v1')) {
    return next(onboardingRequired());
  }

  if (req.originalUrl?.startsWith('/fragments')) {
    return renderFragmentOnboardingError(res);
  }

  return res.redirect(buildOnboardingRedirect());
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

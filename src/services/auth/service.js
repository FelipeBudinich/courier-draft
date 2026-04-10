import mongoose from 'mongoose';

import { badRequest, conflict } from '../../config/errors.js';
import { resolveLocale } from '../../config/i18n.js';
import { Project, User } from '../../models/index.js';
import { createAuditLog } from '../audit/service.js';
import { createStarterProjectForUser } from '../projects/service.js';
import { buildGoogleAuthRequest, exchangeGoogleCodeForProfile } from './google-oauth.js';
import { buildOnboardingRedirect, sanitizeReturnTo } from './return-to.js';
import { assertValidUsername } from './username.js';

export const hasCompletedOnboarding = (user) => Boolean(user?.username);

const resolveStarterProjectRedirect = async (user) => {
  if (!user?.starterProjectId) {
    return null;
  }

  const project = await Project.findById(user.starterProjectId).select('publicId');
  return project ? `/projects/${project.publicId}` : null;
};

export const buildAuthBootstrap = async (user) => ({
  user: {
    id: user.publicId,
    email: user.email,
    username: user.username ?? null,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? '',
    locale: user.preferences?.locale || user.locale,
    onboardingRequired: !hasCompletedOnboarding(user),
    starterProjectId: user.starterProjectId
      ? (await Project.findById(user.starterProjectId).select('publicId'))?.publicId ?? null
      : null
  }
});

export const getPostSignInRedirect = async ({ user, returnTo }) => {
  if (!hasCompletedOnboarding(user)) {
    return buildOnboardingRedirect();
  }

  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (safeReturnTo && safeReturnTo !== '/app' && safeReturnTo !== '/') {
    return safeReturnTo;
  }

  return (await resolveStarterProjectRedirect(user)) ?? '/app';
};

export const getPostUsernameClaimRedirect = async ({ user }) =>
  (await resolveStarterProjectRedirect(user)) ?? '/app';

export const beginGoogleAuthFlow = ({ req, returnTo }) => {
  const authRequest = buildGoogleAuthRequest({
    returnTo: sanitizeReturnTo(returnTo)
  });

  req.session.oauth = {
    state: authRequest.state,
    returnTo: authRequest.returnTo
  };

  return authRequest.url;
};

export const completeGoogleAuthFlow = async ({ req, code, state }) => {
  if (!code) {
    throw badRequest('Google sign-in could not be completed.');
  }

  const expectedState = req.session.oauth?.state;
  const returnTo = req.session.oauth?.returnTo ?? '/app';
  delete req.session.oauth;

  if (!expectedState || state !== expectedState) {
    throw badRequest('Google sign-in state could not be verified.');
  }

  const profile = await exchangeGoogleCodeForProfile({
    code
  });

  let authenticatedUser = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      let user = await User.findOne({
        googleSub: profile.googleSub
      }).session(session);

      let createdUser = false;

      if (!user) {
        const matchingEmailUser = await User.findOne({
          email: profile.email
        }).session(session);

        if (matchingEmailUser) {
          if (matchingEmailUser.googleSub && matchingEmailUser.googleSub !== profile.googleSub) {
            throw conflict('This email is already linked to a different Google account.');
          }

          matchingEmailUser.googleSub = profile.googleSub;
          user = matchingEmailUser;
        } else {
          [user] = await User.create(
            [
              {
                email: profile.email,
                googleSub: profile.googleSub,
                displayName: profile.displayName,
                avatarUrl: profile.avatarUrl,
                locale: resolveLocale(profile.locale),
                preferences: {
                  locale: resolveLocale(profile.locale)
                }
              }
            ],
            { session }
          );
          createdUser = true;
        }
      }

      if (!user.avatarUrl && profile.avatarUrl) {
        user.avatarUrl = profile.avatarUrl;
      }

      user.lastSeenAt = new Date();

      if (createdUser) {
        await createAuditLog({
          scope: 'account',
          actorId: user._id,
          action: 'user.created',
          targetType: 'user',
          targetId: user.publicId,
          metadata: {
            email: user.email,
            authProvider: 'google'
          },
          session
        });

        await createStarterProjectForUser({
          user,
          session
        });
      }

      await createAuditLog({
        scope: 'account',
        actorId: user._id,
        action: 'auth.login_succeeded',
        targetType: 'user',
        targetId: user.publicId,
        metadata: {
          authProvider: 'google'
        },
        session
      });

      await user.save({ session });
      authenticatedUser = user;
    });
  } finally {
    await session.endSession();
  }

  return {
    user: authenticatedUser,
    returnTo
  };
};

export const updateCurrentUserProfile = async ({ user, displayName, username }) => {
  const session = await mongoose.startSession();
  let claimedUsername = false;

  try {
    await session.withTransaction(async () => {
      const sessionUser = await User.findById(user._id).session(session);

      if (displayName !== undefined) {
        const trimmedDisplayName = displayName.trim();
        if (!trimmedDisplayName) {
          throw badRequest('Display name is required.');
        }

        sessionUser.displayName = trimmedDisplayName;
      }

      if (username !== undefined) {
        const normalizedUsername = assertValidUsername(username);
        claimedUsername = !sessionUser.username;

        if (sessionUser.username !== normalizedUsername) {
          sessionUser.username = normalizedUsername;

          await createAuditLog({
            scope: 'account',
            actorId: sessionUser._id,
            action: claimedUsername ? 'username.claimed' : 'username.updated',
            targetType: 'user',
            targetId: sessionUser.publicId,
            metadata: {
              username: normalizedUsername
            },
            session
          });
        }
      }

      await sessionUser.save({ session });
      user.displayName = sessionUser.displayName;
      user.username = sessionUser.username;
      user.avatarUrl = sessionUser.avatarUrl;
      user.locale = sessionUser.locale;
      user.preferences = sessionUser.preferences;
      user.starterProjectId = sessionUser.starterProjectId;
    });
  } finally {
    await session.endSession();
  }

  return {
    claimedUsername,
    redirectTo: claimedUsername ? await getPostUsernameClaimRedirect({ user }) : null
  };
};

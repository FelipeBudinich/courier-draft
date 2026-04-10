import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import { supportedLocales } from '../../../config/env.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import {
  buildAuthBootstrap,
  getPostSignInRedirect,
  updateCurrentUserProfile
} from '../../../services/auth/service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    username: z.string().trim().min(3).max(30).optional()
  })
  .refine((payload) => payload.displayName !== undefined || payload.username !== undefined, {
    message: 'At least one profile field must be provided.'
  });

const updatePreferencesSchema = z.object({
  locale: z.enum(supportedLocales).optional()
});

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const bootstrap = await buildAuthBootstrap(req.currentUser);

    sendApiOk(res, {
      ...bootstrap,
      redirectTo: bootstrap.user.onboardingRequired
        ? null
        : await getPostSignInRedirect({
            user: req.currentUser,
            returnTo: '/app'
          }),
      csrfToken: res.locals.csrfToken
    });
  })
);

router.patch(
  '/me',
  requireAuth,
  validate({ body: updateProfileSchema }),
  asyncRoute(async (req, res) => {
    const { claimedUsername, redirectTo } = await updateCurrentUserProfile({
      user: req.currentUser,
      displayName: req.body.displayName,
      username: req.body.username
    });

    const bootstrap = await buildAuthBootstrap(req.currentUser);

    sendApiOk(res, {
      ...bootstrap,
      claimedUsername,
      redirectTo
    });
  })
);

router.patch(
  '/me/preferences',
  requireAuth,
  validate({ body: updatePreferencesSchema }),
  asyncRoute(async (req, res) => {
    if (req.body.locale) {
      req.currentUser.locale = req.body.locale;
      req.currentUser.preferences.locale = req.body.locale;
    }

    await req.currentUser.save();

    sendApiOk(res, {
      user: {
        id: req.currentUser.publicId,
        locale: req.currentUser.preferences.locale
      }
    });
  })
);

export default router;

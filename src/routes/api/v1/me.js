import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import { supportedLocales } from '../../../config/env.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  username: z.string().trim().min(3).max(30).regex(/^[a-z0-9_]+$/).optional()
});

const updatePreferencesSchema = z.object({
  locale: z.enum(supportedLocales).optional()
});

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    sendApiOk(res, {
      user: {
        id: req.currentUser.publicId,
        email: req.currentUser.email,
        username: req.currentUser.username,
        displayName: req.currentUser.displayName,
        locale: req.currentUser.preferences.locale || req.currentUser.locale
      },
      csrfToken: res.locals.csrfToken
    });
  })
);

router.patch(
  '/me',
  requireAuth,
  validate({ body: updateProfileSchema }),
  asyncRoute(async (req, res) => {
    if (req.body.displayName !== undefined) {
      req.currentUser.displayName = req.body.displayName;
    }

    if (req.body.username !== undefined) {
      req.currentUser.username = req.body.username.toLowerCase();
    }

    await req.currentUser.save();

    sendApiOk(res, {
      user: {
        id: req.currentUser.publicId,
        email: req.currentUser.email,
        username: req.currentUser.username,
        displayName: req.currentUser.displayName,
        locale: req.currentUser.preferences.locale || req.currentUser.locale
      }
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


import { Router } from 'express';
import { z } from 'zod';

import { supportedLocales, env } from '../../config/env.js';
import { asyncRoute } from '../../config/errors.js';
import { validate } from '../../middleware/validation.js';

const router = Router();

const localeSchema = z.object({
  locale: z.enum(supportedLocales),
  returnTo: z.string().optional()
});

router.post(
  '/locale',
  validate({ body: localeSchema }),
  asyncRoute(async (req, res) => {
    const locale = req.body.locale;

    res.cookie(env.localeCookieName, locale, {
      httpOnly: false,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: 365 * 24 * 60 * 60 * 1000
    });

    if (req.currentUser) {
      req.currentUser.locale = locale;
      req.currentUser.preferences.locale = locale;
      await req.currentUser.save();
    }

    const returnTo =
      req.body.returnTo || req.get('referer') || (req.currentUser ? '/app' : '/');

    res.redirect(returnTo);
  })
);

export default router;


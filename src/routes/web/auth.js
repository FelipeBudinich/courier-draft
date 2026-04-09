import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute, notFound } from '../../config/errors.js';
import { env } from '../../config/env.js';
import { seedFixtures } from '../../models/seed.js';
import { User } from '../../models/index.js';
import { setFlash } from '../../middleware/request-context.js';
import { validate } from '../../middleware/validation.js';
import { renderTodoPage } from './helpers.js';

const router = Router();

const devLoginSchema = z.object({
  email: z.string().email(),
  returnTo: z.string().optional().default('/app')
});

router.get(
  '/login',
  asyncRoute(async (req, res) => {
    if (req.currentUser) {
      return res.redirect('/app');
    }

    res.render('pages/login.njk', {
      returnTo: req.query.returnTo ?? '/app',
      seededUsers: Object.values(seedFixtures.users),
      authBypassEnabled: env.authBypassEnabled
    });
  })
);

router.get(
  '/auth/google',
  asyncRoute(async (_req, res) => {
    renderTodoPage(
      res,
      {
        titleKey: 'pages.oauth.title',
        headingKey: 'pages.oauth.heading',
        descriptionKey: 'pages.oauth.description'
      },
      501
    );
  })
);

router.get(
  '/auth/google/callback',
  asyncRoute(async (_req, res) => {
    renderTodoPage(
      res,
      {
        titleKey: 'pages.oauthCallback.title',
        headingKey: 'pages.oauthCallback.heading',
        descriptionKey: 'pages.oauthCallback.description'
      },
      501
    );
  })
);

router.post(
  '/auth/dev-login',
  validate({ body: devLoginSchema }),
  asyncRoute(async (req, res, next) => {
    if (!env.authBypassEnabled || env.isProduction) {
      return next(notFound('Route not found.'));
    }

    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (!user) {
      setFlash(req, {
        type: 'error',
        message: `No seeded user exists for ${req.body.email}.`
      });
      return res.redirect('/login');
    }

    req.session.user = {
      id: String(user._id),
      publicId: user.publicId
    };

    req.session.save(() => {
      res.redirect(req.body.returnTo || '/app');
    });
  })
);

router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    req.session.destroy(() => {
      res.clearCookie(env.sessionName);
      res.redirect('/login');
    });
  })
);

export default router;

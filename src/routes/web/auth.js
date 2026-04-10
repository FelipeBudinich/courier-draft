import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute, notFound } from '../../config/errors.js';
import { env } from '../../config/env.js';
import { seedFixtures } from '../../models/seed.js';
import { User } from '../../models/index.js';
import { setFlash } from '../../middleware/request-context.js';
import { validate } from '../../middleware/validation.js';
import {
  beginGoogleAuthFlow,
  completeGoogleAuthFlow,
  getPostSignInRedirect
} from '../../services/auth/service.js';
import { sanitizeReturnTo } from '../../services/auth/return-to.js';
import { attachUserSession, destroyUserSession } from '../../services/auth/session.js';

const router = Router();

const devLoginSchema = z.object({
  email: z.string().email(),
  returnTo: z.string().optional().default('/app')
});

const saveSession = (req) =>
  new Promise((resolve) => {
    req.session.save(resolve);
  });

router.get(
  '/login',
  asyncRoute(async (req, res) => {
    if (req.currentUser) {
      return res.redirect(
        await getPostSignInRedirect({
          user: req.currentUser,
          returnTo: req.query.returnTo ?? '/app'
        })
      );
    }

    const users = env.authBypassEnabled
      ? await User.find({}).sort({ email: 1 }).select('email displayName')
      : Object.values(seedFixtures.users);

    res.render('pages/login.njk', {
      returnTo: sanitizeReturnTo(req.query.returnTo, '/app'),
      seededUsers: users,
      authBypassEnabled: env.authBypassEnabled
    });
  })
);

router.get(
  '/auth/google',
  asyncRoute(async (req, res) => {
    const redirectUrl = beginGoogleAuthFlow({
      req,
      returnTo: req.query.returnTo ?? '/app'
    });

    await saveSession(req);
    res.redirect(redirectUrl);
  })
);

router.get(
  '/auth/google/callback',
  asyncRoute(async (req, res) => {
    if (req.query.error) {
      setFlash(req, {
        type: 'error',
        message: 'Google sign-in was cancelled or could not be completed.'
      });
      return res.redirect('/login');
    }

    try {
      const { user, returnTo } = await completeGoogleAuthFlow({
        req,
        code: req.query.code,
        state: req.query.state
      });

      attachUserSession(req, user);
      await saveSession(req);

      res.redirect(
        await getPostSignInRedirect({
          user,
          returnTo
        })
      );
    } catch (error) {
      setFlash(req, {
        type: 'error',
        message: error.message
      });
      res.redirect('/login');
    }
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

    user.lastSeenAt = new Date();
    await user.save();

    attachUserSession(req, user);
    await saveSession(req);

    res.redirect(
      await getPostSignInRedirect({
        user,
        returnTo: req.body.returnTo
      })
    );
  })
);

router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    await destroyUserSession(req, res);
    res.redirect('/login');
  })
);

export default router;

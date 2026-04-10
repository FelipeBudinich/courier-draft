import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { buildAuthBootstrap, getPostSignInRedirect } from '../../services/auth/service.js';
import { listPendingInvitesForUser } from '../../services/invites/service.js';
import { getDashboardReadModel } from '../../services/projects/service.js';

const router = Router();

router.get(
  '/',
  asyncRoute(async (req, res) => {
    if (req.currentUser) {
      return res.redirect(
        await getPostSignInRedirect({
          user: req.currentUser,
          returnTo: '/app'
        })
      );
    }

    res.render('pages/home.njk');
  })
);

router.get(
  '/app',
  requireAuth,
  asyncRoute(async (req, res) => {
    const [dashboard, invites] = await Promise.all([
      getDashboardReadModel({
        user: req.currentUser
      }),
      listPendingInvitesForUser({
        userId: req.currentUser._id
      })
    ]);

    res.render('pages/dashboard.njk', {
      pageTitle: 'Dashboard',
      projects: dashboard.projects,
      invites,
      activity: dashboard.activity,
      hasStarterProject: Boolean(req.currentUser.starterProjectId)
    });
  })
);

router.get(
  '/inbox',
  requireAuth,
  asyncRoute(async (req, res) => {
    const invites = await listPendingInvitesForUser({
      userId: req.currentUser._id
    });

    res.render('pages/inbox.njk', {
      invites
    });
  })
);

router.get(
  '/settings/profile',
  requireAuth,
  asyncRoute(async (req, res) => {
    const authBootstrap = await buildAuthBootstrap(req.currentUser);

    res.render('pages/settings-profile.njk', {
      user: req.currentUser,
      onboarding: req.query.onboarding === '1' || !req.currentUser.username,
      starterProjectId: authBootstrap.user.starterProjectId
    });
  })
);

router.get(
  '/settings/preferences',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.render('pages/settings-preferences.njk', {
      user: req.currentUser
    });
  })
);

router.get(
  '/projects/new',
  requireAuth,
  asyncRoute(async (_req, res) => {
    res.render('pages/projects/new.njk', {
      pageTitle: 'New project'
    });
  })
);

export default router;

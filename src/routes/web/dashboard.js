import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { serializeTemplateJson } from '../fragments/helpers.js';
import { buildAuthBootstrap, getPostSignInRedirect } from '../../services/auth/service.js';
import {
  buildUserInboxReadModel,
  normalizeInboxFilter
} from '../../services/inbox/inbox-read-model.js';
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
    const dashboard = await getDashboardReadModel({
      user: req.currentUser
    });
    const dashboardBoot = {
      inboxSummaryUrl: '/fragments/inbox/summary',
      inboxItemsUrl: '/fragments/inbox/items',
      activeProjectIds: dashboard.activeProjectIds,
      unreadSummary: dashboard.unreadSummary
    };

    res.render('pages/dashboard.njk', {
      pageTitle: 'Dashboard',
      projects: dashboard.projects,
      invites: dashboard.invites,
      activity: dashboard.activity,
      unreadSummary: dashboard.unreadSummary,
      dashboardBootJson: serializeTemplateJson(dashboardBoot),
      hasStarterProject: Boolean(req.currentUser.starterProjectId)
    });
  })
);

router.get(
  '/inbox',
  requireAuth,
  asyncRoute(async (req, res) => {
    const filter = normalizeInboxFilter(req.query.filter);
    const page = req.query.page ? Number.parseInt(String(req.query.page), 10) : 1;
    const inbox = await buildUserInboxReadModel({
      user: req.currentUser,
      filter,
      page
    });
    const inboxBoot = {
      inboxSummaryUrl: '/fragments/inbox/summary',
      inboxItemsUrl: '/fragments/inbox/items',
      activeProjectIds: inbox.activeProjectIds,
      filter: inbox.filter,
      page: inbox.pagination.page,
      unreadSummary: inbox.summary.unread
    };

    res.render('pages/inbox.njk', {
      inbox,
      inboxBootJson: serializeTemplateJson(inboxBoot)
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

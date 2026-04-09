import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { ActivityEvent, ProjectMember } from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

router.get(
  '/',
  asyncRoute(async (req, res) => {
    if (req.currentUser) {
      return res.redirect('/app');
    }

    res.render('pages/home.njk');
  })
);

router.get(
  '/app',
  requireAuth,
  asyncRoute(async (req, res) => {
    const memberships = await ProjectMember.find({ userId: req.currentUser._id })
      .populate('projectId')
      .sort({ updatedAt: -1 });

    const projectIds = memberships.map((membership) => membership.projectId?._id).filter(Boolean);
    const activity = await ActivityEvent.find({ projectId: { $in: projectIds } })
      .sort({ createdAt: -1 })
      .limit(5);

    res.render('pages/dashboard.njk', {
      memberships,
      activity
    });
  })
);

router.get(
  '/inbox',
  requireAuth,
  asyncRoute(async (_req, res) => {
    res.render('pages/todo-page.njk', {
      titleKey: 'pages.inbox.title',
      headingKey: 'pages.inbox.heading',
      descriptionKey: 'pages.inbox.description'
    });
  })
);

router.get(
  '/settings/profile',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.render('pages/settings-profile.njk', {
      user: req.currentUser
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
    res.render('pages/todo-page.njk', {
      titleKey: 'pages.newProject.title',
      headingKey: 'pages.newProject.heading',
      descriptionKey: 'pages.newProject.description'
    });
  })
);

export default router;

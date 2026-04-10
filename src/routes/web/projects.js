import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../middleware/auth.js';
import {
  getProjectActivityReadModel,
  getProjectAuditReadModel,
  getProjectMembersReadModel,
  getProjectWorkspaceReadModel
} from '../../services/projects/service.js';

const router = Router();

router.get(
  '/projects/:projectId',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const workspace = await getProjectWorkspaceReadModel({
      project: req.project,
      membership: req.projectMembership
    });

    res.render('pages/projects/workspace.njk', {
      project: workspace.project,
      members: workspace.members,
      memberSummary: workspace.memberSummary,
      activity: workspace.activity,
      scripts: workspace.scripts,
      canManageMembers: workspace.canManageMembers,
      currentRole: req.projectRole
    });
  })
);

router.get(
  '/projects/:projectId/members',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const members = await getProjectMembersReadModel({
      projectId: req.project._id
    });

    res.render('pages/projects/members.njk', {
      project: {
        id: req.project.publicId,
        title: req.project.name
      },
      members,
      canManageMembers: req.projectRole === 'owner'
    });
  })
);

router.get(
  '/projects/:projectId/activity',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const activity = await getProjectActivityReadModel({
      projectId: req.project._id
    });

    res.render('pages/projects/activity.njk', {
      project: {
        id: req.project.publicId,
        title: req.project.name
      },
      activity
    });
  })
);

router.get(
  '/projects/:projectId/audit',
  requireAuth,
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const audit = await getProjectAuditReadModel({
      projectId: req.project._id
    });

    res.render('pages/projects/audit.njk', {
      project: {
        id: req.project.publicId,
        title: req.project.name
      },
      audit
    });
  })
);

router.get(
  '/projects/:projectId/characters',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (_req, res) => {
    res.render('pages/todo-page.njk', {
      titleKey: 'pages.projectCharacters.heading',
      headingKey: 'pages.projectCharacters.heading',
      descriptionKey: 'pages.projectCharacters.description'
    });
  })
);

router.get(
  '/projects/:projectId/locations',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (_req, res) => {
    res.render('pages/todo-page.njk', {
      titleKey: 'pages.projectLocations.heading',
      headingKey: 'pages.projectLocations.heading',
      descriptionKey: 'pages.projectLocations.description'
    });
  })
);

router.get(
  '/projects/:projectId/settings',
  requireAuth,
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const members = await getProjectMembersReadModel({
      projectId: req.project._id
    });

    res.render('pages/projects/settings.njk', {
      project: {
        id: req.project.publicId,
        title: req.project.name
      },
      ownershipCandidates: members.filter(
        (member) => member.status === 'active' && member.role !== 'owner'
      )
    });
  })
);

export default router;

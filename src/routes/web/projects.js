import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import {
  DocumentVersion,
  Note,
  OutlineNode,
  Scene,
  Script
} from '../../models/index.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
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

router.get(
  '/projects/:projectId/scripts/new',
  requireAuth,
  loadProjectMembership,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    res.render('pages/todo-page.njk', {
      titleKey: 'pages.newScript.title',
      headingKey: 'pages.newScript.heading',
      descriptionKey: 'pages.newScript.description'
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const outlineNodes = await OutlineNode.find({
      scriptId: req.script._id
    }).sort({ positionKey: 1 });

    const scenes = await Scene.find({ scriptId: req.script._id }).sort({ updatedAt: -1 });

    res.render('pages/script-page.njk', {
      project: req.project,
      script: req.script,
      outlineNodes,
      scenes
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/editor',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const scene = await Scene.findOne({ scriptId: req.script._id }).sort({ updatedAt: -1 });
    const notes = await Note.find({ scriptId: req.script._id }).sort({ updatedAt: -1 }).limit(10);
    const versions = scene
      ? await DocumentVersion.find({ docType: 'scene', docId: scene._id }).sort({ savedAt: -1 })
      : [];

    res.render('pages/editor-page.njk', {
      project: req.project,
      script: req.script,
      scene,
      notes,
      versions,
      canEdit: ['owner', 'editor'].includes(req.projectRole)
    });
  })
);

export default router;

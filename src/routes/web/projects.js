import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import {
  ActivityEvent,
  AuditLog,
  DocumentVersion,
  Note,
  OutlineNode,
  ProjectEntity,
  ProjectMember,
  Scene,
  Script
} from '../../models/index.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';

const router = Router();

const renderProjectPage = (res, locals) =>
  res.render('pages/project-page.njk', locals);

router.get(
  '/projects/:projectId',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const scripts = await Script.find({ projectId: req.project._id }).sort({ updatedAt: -1 });
    const members = await ProjectMember.find({ projectId: req.project._id }).populate('userId');

    renderProjectPage(res, {
      title: req.project.name,
      headingKey: 'pages.projectOverview.heading',
      descriptionKey: 'pages.projectOverview.description',
      project: req.project,
      scripts,
      members
    });
  })
);

router.get(
  '/projects/:projectId/members',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const members = await ProjectMember.find({ projectId: req.project._id })
      .populate('userId')
      .sort({ role: 1, createdAt: 1 });

    renderProjectPage(res, {
      title: `${req.project.name} members`,
      headingKey: 'pages.projectMembers.heading',
      descriptionKey: 'pages.projectMembers.description',
      project: req.project,
      members
    });
  })
);

router.get(
  '/projects/:projectId/activity',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const activity = await ActivityEvent.find({ projectId: req.project._id })
      .sort({ createdAt: -1 })
      .limit(20);

    renderProjectPage(res, {
      title: `${req.project.name} activity`,
      headingKey: 'pages.projectActivity.heading',
      descriptionKey: 'pages.projectActivity.description',
      project: req.project,
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
    const auditLogs = await AuditLog.find({ projectId: req.project._id })
      .sort({ createdAt: -1 })
      .limit(20);

    renderProjectPage(res, {
      title: `${req.project.name} audit`,
      headingKey: 'pages.projectAudit.heading',
      descriptionKey: 'pages.projectAudit.description',
      project: req.project,
      auditLogs
    });
  })
);

router.get(
  '/projects/:projectId/characters',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const entities = await ProjectEntity.find({
      projectId: req.project._id,
      type: 'character'
    }).sort({ canonicalName: 1 });

    renderProjectPage(res, {
      title: `${req.project.name} characters`,
      headingKey: 'pages.projectCharacters.heading',
      descriptionKey: 'pages.projectCharacters.description',
      project: req.project,
      entities
    });
  })
);

router.get(
  '/projects/:projectId/locations',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const entities = await ProjectEntity.find({
      projectId: req.project._id,
      type: 'location'
    }).sort({ canonicalName: 1 });

    renderProjectPage(res, {
      title: `${req.project.name} locations`,
      headingKey: 'pages.projectLocations.heading',
      descriptionKey: 'pages.projectLocations.description',
      project: req.project,
      entities
    });
  })
);

router.get(
  '/projects/:projectId/settings',
  requireAuth,
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    renderProjectPage(res, {
      title: `${req.project.name} settings`,
      headingKey: 'pages.projectSettings.heading',
      descriptionKey: 'pages.projectSettings.description',
      project: req.project
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

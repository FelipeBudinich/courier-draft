import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../middleware/auth.js';
import { getNotesPanelModel } from '../../services/notes/service.js';
import {
  assertProjectScriptFilter,
  buildProjectEntityPageModel
} from '../../services/entities/service.js';
import { rebuildProjectEntityRegistry } from '../../services/entities/entity-registry-rebuild.js';
import {
  getProjectActivityReadModel,
  getProjectAuditReadModel,
  getProjectMembersReadModel,
  getProjectWorkspaceReadModel
} from '../../services/projects/service.js';
import { serializeTemplateJson } from '../fragments/helpers.js';

const router = Router();

router.get(
  '/projects/:projectId',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const [workspace, notesPanel] = await Promise.all([
      getProjectWorkspaceReadModel({
        project: req.project,
        membership: req.projectMembership
      }),
      getNotesPanelModel({
        project: req.project,
        currentUser: req.currentUser,
        projectRole: req.projectRole,
        surface: 'project'
      })
    ]);

    res.render('pages/projects/workspace.njk', {
      project: workspace.project,
      members: workspace.members,
      memberSummary: workspace.memberSummary,
      activity: workspace.activity,
      scripts: workspace.scripts,
      notesPanel,
      notesPanelBootJson: serializeTemplateJson(notesPanel),
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
  asyncRoute(async (req, res) => {
    await assertProjectScriptFilter({
      projectId: req.project._id,
      scriptPublicId: req.query.scriptId ? String(req.query.scriptId) : null
    });
    await rebuildProjectEntityRegistry({
      projectId: req.project._id
    });

    const page = await buildProjectEntityPageModel({
      project: req.project,
      projectRole: req.projectRole,
      type: 'character',
      q: req.query.q ? String(req.query.q) : '',
      scriptId: req.query.scriptId ? String(req.query.scriptId) : null,
      includeMerged: req.query.includeMerged === 'true',
      sort: req.query.sort ? String(req.query.sort) : null
    });

    res.render('pages/projects/characters.njk', {
      ...page,
      currentRole: req.projectRole
    });
  })
);

router.get(
  '/projects/:projectId/locations',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    await assertProjectScriptFilter({
      projectId: req.project._id,
      scriptPublicId: req.query.scriptId ? String(req.query.scriptId) : null
    });
    await rebuildProjectEntityRegistry({
      projectId: req.project._id
    });

    const page = await buildProjectEntityPageModel({
      project: req.project,
      projectRole: req.projectRole,
      type: 'location',
      q: req.query.q ? String(req.query.q) : '',
      scriptId: req.query.scriptId ? String(req.query.scriptId) : null,
      includeMerged: req.query.includeMerged === 'true',
      sort: req.query.sort ? String(req.query.sort) : null
    });

    res.render('pages/projects/locations.njk', {
      ...page,
      currentRole: req.projectRole
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

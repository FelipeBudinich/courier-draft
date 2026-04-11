import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { loadProjectMembership, requireAuth } from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
import { getOutlineReadModel } from '../../services/outline/service.js';
import { setSurface } from '../../middleware/request-context.js';
import {
  buildUserInboxReadModel,
  listPendingInboxInvites,
  normalizeInboxFilter
} from '../../services/inbox/inbox-read-model.js';
import { getNotesPanelModel } from '../../services/notes/service.js';
import {
  getProjectActivityReadModel,
  getProjectMembersReadModel
} from '../../services/projects/service.js';
import { renderFragment, serializeTemplateJson } from './helpers.js';
import scriptsFragmentsRouter from './scripts.js';

const router = Router();

router.use(setSurface('fragment'));
router.use(scriptsFragmentsRouter);

router.get(
  '/inbox/invites',
  requireAuth,
  asyncRoute(async (req, res) => {
    const invites = await listPendingInboxInvites({
      user: req.currentUser
    });

    renderFragment(res, 'partials/invites-list.njk', {
      invites
    });
  })
);

router.get(
  '/inbox/items',
  requireAuth,
  asyncRoute(async (req, res) => {
    const inbox = await buildUserInboxReadModel({
      user: req.currentUser,
      filter: normalizeInboxFilter(req.query.filter),
      page: req.query.page ? Number.parseInt(String(req.query.page), 10) : 1
    });

    renderFragment(res, 'partials/inbox-items.njk', {
      inbox
    });
  })
);

router.get(
  '/inbox/summary',
  requireAuth,
  asyncRoute(async (req, res) => {
    const inbox = await buildUserInboxReadModel({
      user: req.currentUser
    });

    renderFragment(res, 'partials/inbox-summary.njk', {
      inboxSummary: inbox.summary,
      inboxFilters: inbox.filters,
      currentFilter: inbox.filter
    });
  })
);

router.get(
  '/projects/:projectId/activity-feed',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const activity = await getProjectActivityReadModel({
      projectId: req.project._id,
      limit: 25,
      filter: req.query.type ? String(req.query.type) : 'all',
      page: req.query.page ? Number.parseInt(String(req.query.page), 10) : 1
    });

    renderFragment(res, 'partials/activity-feed.njk', {
      activity: activity.items,
      activityState: activity,
      projectId: req.project.publicId
    });
  })
);

router.get(
  '/projects/:projectId/members/list',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const members = await getProjectMembersReadModel({
      projectId: req.project._id
    });

    renderFragment(res, 'partials/members-list.njk', {
      members,
      projectId: req.project.publicId,
      canManageMembers: req.projectRole === 'owner'
    });
  })
);

router.get(
  '/projects/:projectId/notes-panel',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const notesPanel = await getNotesPanelModel({
      project: req.project,
      currentUser: req.currentUser,
      projectRole: req.projectRole,
      surface: 'project'
    });

    renderFragment(res, 'partials/notes-panel.njk', {
      notesPanel,
      notesPanelBootJson: serializeTemplateJson(notesPanel)
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/notes-panel',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const outline = await getOutlineReadModel({
      script: req.script
    });
    const notesPanel = await getNotesPanelModel({
      project: req.project,
      script: req.script,
      outlineNodes: outline.nodes,
      currentUser: req.currentUser,
      projectRole: req.projectRole,
      surface: req.query.surface ? String(req.query.surface) : 'script',
      sceneId: req.query.sceneId ? String(req.query.sceneId) : null,
      filters: {
        scope: req.query.scope ? String(req.query.scope) : undefined,
        ownership: req.query.ownership ? String(req.query.ownership) : undefined,
        noteType: req.query.noteType ? String(req.query.noteType) : undefined,
        detached: req.query.detached ? String(req.query.detached) : undefined
      }
    });

    renderFragment(res, 'partials/notes-panel.njk', {
      notesPanel,
      notesPanelBootJson: serializeTemplateJson(notesPanel)
    });
  })
);

export default router;

import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import {
  ActivityEvent,
  DocumentVersion,
  Note,
  OutlineNode,
  ProjectMember,
  Scene
} from '../../models/index.js';
import { loadProjectMembership, requireAuth } from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
import { setSurface } from '../../middleware/request-context.js';
import { renderFragment } from './helpers.js';

const router = Router();

router.use(setSurface('fragment'));

router.get(
  '/inbox/invites',
  requireAuth,
  asyncRoute(async (_req, res) => {
    renderFragment(res, 'partials/invites-list.njk', {
      invites: []
    });
  })
);

router.get(
  '/projects/:projectId/activity-feed',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const activity = await ActivityEvent.find({ projectId: req.project._id })
      .sort({ createdAt: -1 })
      .limit(10);

    renderFragment(res, 'partials/activity-feed.njk', { activity });
  })
);

router.get(
  '/projects/:projectId/members/list',
  requireAuth,
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const members = await ProjectMember.find({ projectId: req.project._id })
      .populate('userId')
      .sort({ role: 1, createdAt: 1 });

    renderFragment(res, 'partials/members-list.njk', { members });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/outline-tree',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const outlineNodes = await OutlineNode.find({ scriptId: req.script._id }).sort({
      positionKey: 1
    });

    renderFragment(res, 'partials/outline-tree.njk', { outlineNodes });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/notes-panel',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const notes = await Note.find({ scriptId: req.script._id }).sort({ updatedAt: -1 }).limit(10);

    renderFragment(res, 'partials/notes-panel.njk', { notes });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/version-sidebar',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const scenes = await Scene.find({ scriptId: req.script._id }).select('_id');
    const versions = await DocumentVersion.find({
      docType: 'scene',
      docId: { $in: scenes.map((scene) => scene._id) }
    }).sort({ savedAt: -1 });

    renderFragment(res, 'partials/version-sidebar.njk', { versions });
  })
);

export default router;


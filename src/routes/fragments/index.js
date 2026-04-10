import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { DocumentVersion, Note, Scene } from '../../models/index.js';
import { loadProjectMembership, requireAuth } from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
import { setSurface } from '../../middleware/request-context.js';
import { listPendingInvitesForUser } from '../../services/invites/service.js';
import {
  getProjectActivityReadModel,
  getProjectMembersReadModel
} from '../../services/projects/service.js';
import { renderFragment } from './helpers.js';
import scriptsFragmentsRouter from './scripts.js';

const router = Router();

router.use(setSurface('fragment'));
router.use(scriptsFragmentsRouter);

router.get(
  '/inbox/invites',
  requireAuth,
  asyncRoute(async (req, res) => {
    const invites = await listPendingInvitesForUser({
      userId: req.currentUser._id
    });

    renderFragment(res, 'partials/invites-list.njk', {
      invites
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
      limit: 10
    });

    renderFragment(res, 'partials/activity-feed.njk', { activity });
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

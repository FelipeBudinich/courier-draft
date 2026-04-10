import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { loadProjectMembership, requireAuth } from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
import { getOutlineReadModel } from '../../services/outline/service.js';
import { renderFragment } from './helpers.js';

const router = Router();

router.get(
  '/projects/:projectId/scripts/:scriptId/outline-tree',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const outline = await getOutlineReadModel({
      script: req.script
    });

    renderFragment(res, 'partials/outline-tree.njk', {
      project: {
        id: req.project.publicId,
        title: req.project.name
      },
      script: {
        id: req.script.publicId,
        sceneNumberMode: req.script.sceneNumberMode
      },
      outlineNodes: outline.nodes,
      permissions: {
        canEdit: ['owner', 'editor'].includes(req.projectRole)
      },
      surface: req.query.surface === 'editor' ? 'editor' : 'fragment',
      activeSceneId: req.query.sceneId ? String(req.query.sceneId) : null
    });
  })
);

export default router;

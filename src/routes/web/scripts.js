import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
import { getScriptDetailReadModel } from '../../services/scripts/service.js';

const router = Router();

const serializeProjectFrame = (project) => ({
  id: project.publicId,
  title: project.name
});

router.get(
  '/projects/:projectId/scripts/new',
  requireAuth,
  loadProjectMembership,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    res.render('pages/projects/script-new.njk', {
      project: serializeProjectFrame(req.project),
      currentRole: req.projectRole
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const detail = await getScriptDetailReadModel({
      project: req.project,
      script: req.script,
      projectRole: req.projectRole
    });

    res.render('pages/projects/script-show.njk', {
      project: serializeProjectFrame(req.project),
      script: detail.script,
      outlineNodes: detail.outline,
      activity: detail.activity,
      permissions: detail.permissions,
      currentRole: req.projectRole
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/editor',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const detail = await getScriptDetailReadModel({
      project: req.project,
      script: req.script,
      projectRole: req.projectRole
    });

    res.render('pages/projects/script-editor.njk', {
      project: serializeProjectFrame(req.project),
      script: detail.script,
      outlineNodes: detail.outline,
      activity: detail.activity,
      permissions: detail.permissions,
      currentRole: req.projectRole
    });
  })
);

export default router;

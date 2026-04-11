import { Router } from 'express';

import { asyncRoute, forbidden, notFound } from '../../../config/errors.js';
import { Project, ProjectMember } from '../../../models/index.js';
import { requireAuth } from '../../../middleware/auth.js';
import { loadScript } from '../../../middleware/resources.js';
import { exportScriptPdf } from '../../../services/export/export-service.js';

const router = Router();

const loadProjectExportAccess = (req, _res, next) => {
  Promise.resolve()
    .then(async () => {
      const project = await Project.findOne({
        publicId: req.params.projectId
      });

      if (!project) {
        throw notFound('Project not found.');
      }

      const membership = await ProjectMember.findOne({
        projectId: project._id,
        userId: req.currentUser._id,
        status: 'active'
      });

      if (!membership) {
        throw forbidden('You do not have access to this project.');
      }

      req.project = project;
      req.projectMembership = membership;
      req.projectRole = membership.role;
    })
    .then(() => next())
    .catch(next);
};

router.post(
  '/projects/:projectId/scripts/:scriptId/exports/pdf',
  requireAuth,
  loadProjectExportAccess,
  loadScript,
  asyncRoute(async (req, res) => {
    const result = await exportScriptPdf({
      project: req.project,
      script: req.script,
      actor: req.currentUser,
      locale: req.locale,
      input: req.body
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', result.contentDisposition);
    res.send(result.pdfBuffer);
  })
);

export default router;


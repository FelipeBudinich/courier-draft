import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../../middleware/auth.js';
import { loadScene, loadScript } from '../../../middleware/resources.js';
import { validate } from '../../../middleware/validation.js';
import { getOutlineReadModel } from '../../../services/outline/service.js';
import { parseSceneHeadSaveRequest } from '../../../services/scenes/document-schema.js';
import { buildSceneBootstrapPayload } from '../../../services/scenes/scene-bootstrap.js';
import { saveSceneHead } from '../../../services/scenes/scene-head-save.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const sceneParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_'),
  sceneId: z.string().startsWith('scn_')
});

const sceneHeadSaveSchema = z
  .object({
    baseHeadRevision: z.number().int().min(0),
    document: z.unknown()
  })
  .strict();

const createSaveStateLabels = (t) => ({
  saved: t('pages.editor.saveStates.saved'),
  saving: t('pages.editor.saveStates.saving'),
  unsaved: t('pages.editor.saveStates.unsaved'),
  failed: t('pages.editor.saveStates.failed'),
  readOnly: t('pages.editor.saveStates.readOnly'),
  stale: t('pages.editor.saveStates.stale')
});

router.get(
  '/projects/:projectId/scripts/:scriptId/scenes/:sceneId',
  requireAuth,
  validate({ params: sceneParamsSchema }),
  loadProjectMembership,
  loadScript,
  loadScene,
  asyncRoute(async (req, res) => {
    const t = res.locals.t;

    await req.scene.populate('updatedByUserId', 'publicId username displayName');

    const outline = await getOutlineReadModel({
      script: req.script
    });

    sendApiOk(
      res,
      buildSceneBootstrapPayload({
        project: req.project,
        script: req.script,
        scene: req.scene,
        projectRole: req.projectRole,
        outlineNodes: outline.nodes,
        saveStateLabels: createSaveStateLabels(t)
      })
    );
  })
);

router.put(
  '/projects/:projectId/scripts/:scriptId/scenes/:sceneId/head',
  requireAuth,
  validate({ params: sceneParamsSchema, body: sceneHeadSaveSchema }),
  loadProjectMembership,
  loadScript,
  loadScene,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const payload = parseSceneHeadSaveRequest(req.body);
    const result = await saveSceneHead({
      scene: req.scene,
      actor: req.currentUser,
      baseHeadRevision: payload.baseHeadRevision,
      document: payload.document
    });

    sendApiOk(res, result);
  })
);

export default router;

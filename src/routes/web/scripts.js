import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { notFound } from '../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
import { findSceneByPublicId } from '../../models/lookups.js';
import { getScriptDetailReadModel } from '../../services/scripts/service.js';
import { SCENE_TEXT_BLOCK_TYPES } from '../../services/scenes/document-constants.js';
import {
  buildSceneBootstrapPayload,
  resolveEditorSceneSelection
} from '../../services/scenes/scene-bootstrap.js';

const router = Router();

const serializeProjectFrame = (project) => ({
  id: project.publicId,
  title: project.name
});

const serializeJsonScriptData = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

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
    const t = res.locals.t;
    const detail = await getScriptDetailReadModel({
      project: req.project,
      script: req.script,
      projectRole: req.projectRole
    });
    const selection = resolveEditorSceneSelection({
      outlineNodes: detail.outline,
      requestedSceneId: req.query.sceneId ? String(req.query.sceneId) : null
    });

    if (req.query.sceneId && !selection.activeSceneId) {
      throw notFound('Scene not found.');
    }

    let activeScene = null;
    let editorBootJson = null;

    if (selection.activeSceneId) {
      activeScene = await findSceneByPublicId({
        projectId: req.project._id,
        scriptId: req.script._id,
        scenePublicId: selection.activeSceneId
      });

      if (!activeScene) {
        throw notFound('Scene not found.');
      }

      await activeScene.populate('updatedByUserId', 'publicId username displayName');

      editorBootJson = serializeJsonScriptData(
        buildSceneBootstrapPayload({
          project: req.project,
          script: detail.script,
          scene: activeScene,
          projectRole: req.projectRole,
          outlineNodes: detail.outline,
          saveStateLabels: {
            saved: t('pages.editor.saveStates.saved'),
            saving: t('pages.editor.saveStates.saving'),
            unsaved: t('pages.editor.saveStates.unsaved'),
            failed: t('pages.editor.saveStates.failed'),
            readOnly: t('pages.editor.saveStates.readOnly'),
            stale: t('pages.editor.saveStates.stale')
          }
        })
      );
    }

    res.render('pages/projects/script-editor.njk', {
      project: serializeProjectFrame(req.project),
      script: detail.script,
      outlineNodes: detail.outline,
      permissions: detail.permissions,
      currentRole: req.projectRole,
      sceneEntries: selection.sceneEntries,
      activeSceneId: selection.activeSceneId,
      activeScene,
      editorBootJson,
      blockTypeOptions: SCENE_TEXT_BLOCK_TYPES
    });
  })
);

export default router;

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
import { sceneSessionManager } from '../../services/collab/scene-session-manager.js';
import { getNotesPanelModel } from '../../services/notes/service.js';
import { getScriptDetailReadModel } from '../../services/scripts/service.js';
import { SCENE_TEXT_BLOCK_TYPES } from '../../services/scenes/document-constants.js';
import {
  buildSceneBootstrapPayload,
  resolveEditorSceneSelection
} from '../../services/scenes/scene-bootstrap.js';
import { serializeTemplateJson } from '../fragments/helpers.js';

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
    const notesPanel = await getNotesPanelModel({
      project: req.project,
      script: req.script,
      outlineNodes: detail.outline,
      currentUser: req.currentUser,
      projectRole: req.projectRole,
      surface: 'script'
    });

    res.render('pages/projects/script-show.njk', {
      project: serializeProjectFrame(req.project),
      script: detail.script,
      outlineNodes: detail.outline,
      activity: detail.activity,
      notesPanel,
      notesPanelBootJson: serializeTemplateJson(notesPanel),
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
    let notesPanel = null;

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
          currentUser: req.currentUser,
          projectRole: req.projectRole,
          outlineNodes: detail.outline,
          persistenceStateLabels: {
            persisted: t('pages.editor.persistenceStates.persisted'),
            unsaved: t('pages.editor.persistenceStates.unsaved'),
            failed: t('pages.editor.persistenceStates.failed'),
            readOnly: t('pages.editor.persistenceStates.readOnly'),
            reconnecting: t('pages.editor.connectionStates.reconnecting')
          },
          connectionStateLabels: {
            connecting: t('pages.editor.connectionStates.connecting'),
            connected: t('pages.editor.connectionStates.connected'),
            reconnecting: t('pages.editor.connectionStates.reconnecting'),
            unavailable: t('pages.editor.connectionStates.unavailable')
          },
          collaboration: {
            enabled: true,
            namespace: '/collab',
            sessionActive: sceneSessionManager.hasActiveSession(activeScene.publicId)
          }
        })
      );
    }

    notesPanel = await getNotesPanelModel({
      project: req.project,
      script: req.script,
      outlineNodes: detail.outline,
      currentUser: req.currentUser,
      projectRole: req.projectRole,
      surface: 'editor',
      sceneId: selection.activeSceneId
    });

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
      notesPanel,
      notesPanelBootJson: serializeTemplateJson(notesPanel),
      blockTypeOptions: SCENE_TEXT_BLOCK_TYPES
    });
  })
);

export default router;

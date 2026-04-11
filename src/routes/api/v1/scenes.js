import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute, conflict } from '../../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../../middleware/auth.js';
import { loadScene, loadScript } from '../../../middleware/resources.js';
import { validate } from '../../../middleware/validation.js';
import { getOutlineReadModel } from '../../../services/outline/service.js';
import { sceneSessionManager } from '../../../services/collab/scene-session-manager.js';
import { parseSceneHeadSaveRequest } from '../../../services/scenes/document-schema.js';
import { buildSceneBootstrapPayload } from '../../../services/scenes/scene-bootstrap.js';
import { saveSceneHead } from '../../../services/scenes/scene-head-save.js';
import {
  getSceneVersionDetail,
  listSceneVersions,
  majorSaveScene
} from '../../../services/versioning/checkpoint-service.js';
import { diffSceneVersions } from '../../../services/versioning/scene-diff-service.js';
import { restoreSceneVersion } from '../../../services/versioning/restore-service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const sceneParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_'),
  sceneId: z.string().startsWith('scn_')
});

const sceneVersionParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_'),
  sceneId: z.string().startsWith('scn_'),
  versionId: z.string().startsWith('ver_')
});

const compareSourceSchema = z
  .object({
    kind: z.enum(['currentHead', 'version']),
    versionId: z.string().startsWith('ver_').optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'version' && !value.versionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'versionId is required when kind=version.'
      });
    }
  });

const diffRequestSchema = z.union([
  z.object({}).strict(),
  z
    .object({
      left: compareSourceSchema,
      right: compareSourceSchema
    })
    .strict()
]);

const sceneHeadSaveSchema = z
  .object({
    baseHeadRevision: z.number().int().min(0),
    document: z.unknown()
  })
  .strict();

const createPersistenceStateLabels = (t) => ({
  persisted: t('pages.editor.persistenceStates.persisted'),
  unsaved: t('pages.editor.persistenceStates.unsaved'),
  failed: t('pages.editor.persistenceStates.failed'),
  readOnly: t('pages.editor.persistenceStates.readOnly'),
  reconnecting: t('pages.editor.connectionStates.reconnecting')
});

const createConnectionStateLabels = (t) => ({
  connecting: t('pages.editor.connectionStates.connecting'),
  connected: t('pages.editor.connectionStates.connected'),
  reconnecting: t('pages.editor.connectionStates.reconnecting'),
  unavailable: t('pages.editor.connectionStates.unavailable')
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
        currentUser: req.currentUser,
        projectRole: req.projectRole,
        outlineNodes: outline.nodes,
        persistenceStateLabels: createPersistenceStateLabels(t),
        connectionStateLabels: createConnectionStateLabels(t),
        collaboration: {
          enabled: true,
          namespace: '/collab',
          sessionActive: sceneSessionManager.hasActiveSession(req.scene.publicId)
        }
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
    if (sceneSessionManager.hasActiveSession(req.scene.publicId)) {
      throw conflict('This scene is currently managed by an active live collaboration session.');
    }

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

router.get(
  '/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions',
  requireAuth,
  validate({ params: sceneParamsSchema }),
  loadProjectMembership,
  loadScript,
  loadScene,
  asyncRoute(async (req, res) => {
    const versions = await listSceneVersions({
      scene: req.scene
    });

    sendApiOk(res, {
      versions
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions/:versionId',
  requireAuth,
  validate({ params: sceneVersionParamsSchema }),
  loadProjectMembership,
  loadScript,
  loadScene,
  asyncRoute(async (req, res) => {
    const version = await getSceneVersionDetail({
      project: req.project,
      scene: req.scene,
      versionId: req.params.versionId
    });

    sendApiOk(res, {
      version
    });
  })
);

router.post(
  '/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions/major-save',
  requireAuth,
  validate({ params: sceneParamsSchema }),
  loadProjectMembership,
  loadScript,
  loadScene,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const result = await majorSaveScene({
      project: req.project,
      script: req.script,
      scene: req.scene,
      actor: req.currentUser
    });

    sendApiOk(
      res,
      {
        scriptVersion: {
          id: result.scriptVersion.publicId,
          versionLabel: result.scriptVersion.versionLabel,
          majorSaveSequence: result.scriptVersion.majorSaveSequence
        },
        version: {
          id: result.createdVersions[0].version.publicId,
          versionLabel: result.createdVersions[0].version.versionLabel
        }
      },
      201
    );
  })
);

router.post(
  '/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions/:versionId/restore',
  requireAuth,
  validate({ params: sceneVersionParamsSchema }),
  loadProjectMembership,
  loadScript,
  loadScene,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const result = await restoreSceneVersion({
      project: req.project,
      script: req.script,
      scene: req.scene,
      actor: req.currentUser,
      versionId: req.params.versionId
    });

    sendApiOk(res, result);
  })
);

router.post(
  '/projects/:projectId/scripts/:scriptId/scenes/:sceneId/diff',
  requireAuth,
  validate({ params: sceneParamsSchema, body: diffRequestSchema }),
  loadProjectMembership,
  loadScript,
  loadScene,
  asyncRoute(async (req, res) => {
    const diff = await diffSceneVersions({
      project: req.project,
      scene: req.scene,
      compare:
        Object.keys(req.body ?? {}).length > 0
          ? req.body
          : null
    });

    sendApiOk(res, diff);
  })
);

export default router;

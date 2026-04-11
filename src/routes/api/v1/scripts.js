import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../../middleware/auth.js';
import { loadScript } from '../../../middleware/resources.js';
import { validate } from '../../../middleware/validation.js';
import {
  createOutlineNode,
  deleteOutlineNode,
  getOutlineReadModel,
  moveOutlineNode,
  updateOutlineNode
} from '../../../services/outline/service.js';
import {
  getScriptVersionCheckpointDetail,
  listScriptVersionCheckpoints,
  majorSaveScript
} from '../../../services/versioning/checkpoint-service.js';
import {
  createScript,
  deleteScript,
  getScriptDetailReadModel,
  listProjectScriptsReadModel,
  updateSceneNumberMode,
  updateScriptMetadata
} from '../../../services/scripts/service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const projectParamsSchema = z.object({
  projectId: z.string().startsWith('prj_')
});

const scriptParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_')
});

const scriptVersionParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_'),
  scriptVersionId: z.string().startsWith('svr_')
});

const outlineNodeParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_'),
  nodeId: z.string().startsWith('out_')
});

const insertSchema = z
  .object({
    beforeNodeId: z.string().startsWith('out_').optional(),
    afterNodeId: z.string().startsWith('out_').optional(),
    index: z.number().int().min(0).optional()
  })
  .optional();

const scriptBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  genre: z.string().trim().max(120).optional().default(''),
  status: z.string().trim().max(60).optional().default('draft'),
  language: z.string().trim().max(60).optional().default(''),
  authors: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([])
});

const sceneNumberingSchema = z.object({
  sceneNumberMode: z.enum(['off', 'auto', 'frozen'])
});

/* Insert contract: callers may send at most one of beforeNodeId, afterNodeId, or index.
 * Omitting insert appends to the end of the target container. */
const outlineCreateSchema = z.object({
  type: z.enum(['act', 'beat', 'scene']),
  title: z.string().trim().min(1).max(160),
  placementParentId: z.string().startsWith('out_').nullable().optional().default(null),
  actId: z.string().startsWith('out_').nullable().optional(),
  beatId: z.string().startsWith('out_').nullable().optional(),
  insert: insertSchema
});

const outlineUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  actId: z.string().startsWith('out_').nullable().optional(),
  beatId: z.string().startsWith('out_').nullable().optional(),
  manualSceneNumber: z.string().trim().max(40).nullable().optional()
});

const outlineMoveSchema = z.object({
  placementParentId: z.string().startsWith('out_').nullable().optional().default(null),
  insert: insertSchema,
  actId: z.string().startsWith('out_').nullable().optional(),
  beatId: z.string().startsWith('out_').nullable().optional()
});

router.get(
  '/projects/:projectId/scripts',
  requireAuth,
  validate({ params: projectParamsSchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const scripts = await listProjectScriptsReadModel({
      projectId: req.project._id
    });

    sendApiOk(res, {
      scripts
    });
  })
);

router.post(
  '/projects/:projectId/scripts',
  requireAuth,
  validate({ params: projectParamsSchema, body: scriptBodySchema }),
  loadProjectMembership,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const script = await createScript({
      project: req.project,
      actor: req.currentUser,
      input: req.body
    });

    sendApiOk(
      res,
      {
        script: {
          id: script.publicId
        }
      },
      201
    );
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId',
  requireAuth,
  validate({ params: scriptParamsSchema }),
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const detail = await getScriptDetailReadModel({
      project: req.project,
      script: req.script,
      projectRole: req.projectRole
    });

    sendApiOk(res, detail);
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/versions',
  requireAuth,
  validate({ params: scriptParamsSchema }),
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const versions = await listScriptVersionCheckpoints({
      script: req.script
    });

    sendApiOk(res, {
      versions
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/versions/:scriptVersionId',
  requireAuth,
  validate({ params: scriptVersionParamsSchema }),
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const version = await getScriptVersionCheckpointDetail({
      project: req.project,
      script: req.script,
      scriptVersionId: req.params.scriptVersionId
    });

    sendApiOk(res, {
      version
    });
  })
);

router.post(
  '/projects/:projectId/scripts/:scriptId/versions/major-save',
  requireAuth,
  validate({ params: scriptParamsSchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const result = await majorSaveScript({
      project: req.project,
      script: req.script,
      actor: req.currentUser
    });

    sendApiOk(
      res,
      {
        scriptVersion: {
          id: result.scriptVersion.publicId,
          versionLabel: result.scriptVersion.versionLabel,
          majorSaveSequence: result.scriptVersion.majorSaveSequence,
          summary: result.scriptVersion.summary ?? {}
        },
        snapshots: result.createdVersions.map(({ version, docType, document }) => ({
          versionId: version.publicId,
          docType,
          docId: document.publicId
        }))
      },
      201
    );
  })
);

router.patch(
  '/projects/:projectId/scripts/:scriptId',
  requireAuth,
  validate({ params: scriptParamsSchema, body: scriptBodySchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const script = await updateScriptMetadata({
      project: req.project,
      script: req.script,
      actor: req.currentUser,
      input: req.body
    });

    sendApiOk(res, {
      script: {
        id: script.publicId
      }
    });
  })
);

router.delete(
  '/projects/:projectId/scripts/:scriptId',
  requireAuth,
  validate({ params: scriptParamsSchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const result = await deleteScript({
      project: req.project,
      script: req.script,
      actor: req.currentUser
    });

    sendApiOk(res, result);
  })
);

router.patch(
  '/projects/:projectId/scripts/:scriptId/scene-numbering',
  requireAuth,
  validate({ params: scriptParamsSchema, body: sceneNumberingSchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const script = await updateSceneNumberMode({
      project: req.project,
      script: req.script,
      actor: req.currentUser,
      sceneNumberMode: req.body.sceneNumberMode
    });

    sendApiOk(res, {
      script: {
        id: script.publicId,
        sceneNumberMode: script.sceneNumberMode
      }
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/outline',
  requireAuth,
  validate({ params: scriptParamsSchema }),
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const outline = await getOutlineReadModel({
      script: req.script
    });

    sendApiOk(res, {
      outline: outline.nodes
    });
  })
);

router.post(
  '/projects/:projectId/scripts/:scriptId/outline/nodes',
  requireAuth,
  validate({ params: scriptParamsSchema, body: outlineCreateSchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const node = await createOutlineNode({
      project: req.project,
      script: req.script,
      actor: req.currentUser,
      type: req.body.type,
      title: req.body.title,
      placementParentId: req.body.placementParentId,
      actId: req.body.actId,
      beatId: req.body.beatId,
      insert: req.body.insert ?? {}
    });

    sendApiOk(
      res,
      {
        nodeId: node.publicId
      },
      201
    );
  })
);

router.patch(
  '/projects/:projectId/scripts/:scriptId/outline/nodes/:nodeId',
  requireAuth,
  validate({ params: outlineNodeParamsSchema, body: outlineUpdateSchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const node = await updateOutlineNode({
      project: req.project,
      script: req.script,
      actor: req.currentUser,
      nodePublicId: req.params.nodeId,
      updates: req.body
    });

    sendApiOk(res, {
      nodeId: node.publicId
    });
  })
);

router.post(
  '/projects/:projectId/scripts/:scriptId/outline/nodes/:nodeId/move',
  requireAuth,
  validate({ params: outlineNodeParamsSchema, body: outlineMoveSchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const node = await moveOutlineNode({
      project: req.project,
      script: req.script,
      actor: req.currentUser,
      nodePublicId: req.params.nodeId,
      placementParentId: req.body.placementParentId,
      insert: req.body.insert ?? {},
      semanticOverrides: {
        ...(Object.prototype.hasOwnProperty.call(req.body, 'actId')
          ? { actId: req.body.actId }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, 'beatId')
          ? { beatId: req.body.beatId }
          : {})
      }
    });

    sendApiOk(res, {
      nodeId: node.publicId
    });
  })
);

router.delete(
  '/projects/:projectId/scripts/:scriptId/outline/nodes/:nodeId',
  requireAuth,
  validate({ params: outlineNodeParamsSchema }),
  loadProjectMembership,
  loadScript,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const result = await deleteOutlineNode({
      project: req.project,
      script: req.script,
      actor: req.currentUser,
      nodePublicId: req.params.nodeId
    });

    sendApiOk(res, result);
  })
);

export default router;

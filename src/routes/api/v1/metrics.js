import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth
} from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import {
  assertProjectScriptFilter,
  listProjectEntityMetrics
} from '../../../services/entities/service.js';
import { rebuildProjectEntityRegistry } from '../../../services/entities/entity-registry-rebuild.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const projectParamsSchema = z.object({
  projectId: z.string().startsWith('prj_')
});

const characterMetricsQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  scriptId: z.string().startsWith('scr_').optional(),
  includeMerged: z
    .enum(['true', 'false'])
    .optional()
    .default('false'),
  sort: z
    .enum([
      'canonicalName',
      'sceneCount',
      'dialogueLineCount',
      'dialogueBlockCount'
    ])
    .optional()
});

const locationMetricsQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  scriptId: z.string().startsWith('scr_').optional(),
  includeMerged: z
    .enum(['true', 'false'])
    .optional()
    .default('false'),
  sort: z.enum(['canonicalName', 'sceneCount', 'scriptCount']).optional()
});

router.get(
  '/projects/:projectId/metrics/characters',
  requireAuth,
  validate({ params: projectParamsSchema, query: characterMetricsQuerySchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    await assertProjectScriptFilter({
      projectId: req.project._id,
      scriptPublicId: req.query.scriptId ?? null
    });
    await rebuildProjectEntityRegistry({
      projectId: req.project._id
    });

    const metrics = await listProjectEntityMetrics({
      project: req.project,
      type: 'character',
      q: req.query.q,
      scriptId: req.query.scriptId ?? null,
      includeMerged: req.query.includeMerged === 'true',
      sort: req.query.sort ?? null
    });

    sendApiOk(res, {
      metrics
    });
  })
);

router.get(
  '/projects/:projectId/metrics/locations',
  requireAuth,
  validate({ params: projectParamsSchema, query: locationMetricsQuerySchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    await assertProjectScriptFilter({
      projectId: req.project._id,
      scriptPublicId: req.query.scriptId ?? null
    });
    await rebuildProjectEntityRegistry({
      projectId: req.project._id
    });

    const metrics = await listProjectEntityMetrics({
      project: req.project,
      type: 'location',
      q: req.query.q,
      scriptId: req.query.scriptId ?? null,
      includeMerged: req.query.includeMerged === 'true',
      sort: req.query.sort ?? null
    });

    sendApiOk(res, {
      metrics
    });
  })
);

export default router;

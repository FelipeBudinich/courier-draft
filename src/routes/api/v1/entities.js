import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute, notFound } from '../../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import { findProjectEntityByPublicId } from '../../../models/lookups.js';
import { createActionKey, runSingleFlight } from '../../../services/ops/idempotency.js';
import {
  assertProjectScriptFilter,
  createManualProjectEntity,
  getEntityAutocompleteSuggestions,
  listProjectEntities,
  mergeProjectEntities,
  updateManualProjectEntity
} from '../../../services/entities/service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const projectParamsSchema = z.object({
  projectId: z.string().startsWith('prj_')
});

const entityParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  entityId: z.string().startsWith('ent_')
});

const entityQuerySchema = z.object({
  type: z.enum(['character', 'location']),
  q: z.string().trim().optional().default(''),
  scriptId: z.string().startsWith('scr_').optional(),
  autocomplete: z
    .enum(['true', 'false'])
    .optional()
    .default('false'),
  includeMerged: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
});

const createEntitySchema = z.object({
  type: z.enum(['character', 'location']),
  canonicalName: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(50).optional().default([])
});

const updateEntitySchema = z
  .object({
    canonicalName: z.string().trim().min(1).max(160).optional(),
    aliases: z.array(z.string().trim().min(1).max(160)).max(50).optional()
  })
  .refine(
    (payload) =>
      Object.prototype.hasOwnProperty.call(payload, 'canonicalName') ||
      Object.prototype.hasOwnProperty.call(payload, 'aliases'),
    {
      message: 'canonicalName or aliases is required.'
    }
  );

const mergeEntitySchema = z.object({
  targetEntityId: z.string().startsWith('ent_')
});

const loadProjectEntity = (req, _res, next) => {
  Promise.resolve()
    .then(() =>
      findProjectEntityByPublicId({
        projectId: req.project._id,
        entityPublicId: req.params.entityId
      })
    )
    .then((entity) => {
      if (!entity) {
        return next(notFound('Entity not found.'));
      }

      req.entity = entity;
      next();
    })
    .catch(next);
};

router.get(
  '/projects/:projectId/entities',
  requireAuth,
  validate({ params: projectParamsSchema, query: entityQuerySchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    await assertProjectScriptFilter({
      projectId: req.project._id,
      scriptPublicId: req.query.scriptId ?? null
    });

    if (req.query.autocomplete === 'true') {
      const entities = await getEntityAutocompleteSuggestions({
        project: req.project,
        type: req.query.type,
        q: req.query.q
      });

      sendApiOk(res, {
        entities
      });
      return;
    }

    const entities = await listProjectEntities({
      project: req.project,
      type: req.query.type,
      q: req.query.q,
      scriptId: req.query.scriptId ?? null,
      includeMerged: req.query.includeMerged === 'true'
    });

    sendApiOk(res, {
      entities
    });
  })
);

router.post(
  '/projects/:projectId/entities',
  requireAuth,
  validate({ params: projectParamsSchema, body: createEntitySchema }),
  loadProjectMembership,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const entity = await createManualProjectEntity({
      project: req.project,
      actor: req.currentUser,
      type: req.body.type,
      canonicalName: req.body.canonicalName,
      aliases: req.body.aliases ?? []
    });

    sendApiOk(
      res,
      {
        entity: {
          id: entity.publicId
        }
      },
      201
    );
  })
);

router.patch(
  '/projects/:projectId/entities/:entityId',
  requireAuth,
  validate({ params: entityParamsSchema, body: updateEntitySchema }),
  loadProjectMembership,
  loadProjectEntity,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const entity = await updateManualProjectEntity({
      project: req.project,
      actor: req.currentUser,
      entity: req.entity,
      canonicalName: req.body.canonicalName ?? req.entity.canonicalName,
      aliases:
        req.body.aliases ??
        (req.entity.aliases ?? []).map((alias) => alias.display)
    });

    sendApiOk(res, {
      entity: {
        id: entity.publicId
      }
    });
  })
);

router.post(
  '/projects/:projectId/entities/:entityId/merge',
  requireAuth,
  validate({ params: entityParamsSchema, body: mergeEntitySchema }),
  loadProjectMembership,
  loadProjectEntity,
  requireProjectRole('editor'),
  asyncRoute(async (req, res) => {
    const targetEntity = await findProjectEntityByPublicId({
      projectId: req.project._id,
      entityPublicId: req.body.targetEntityId
    });

    if (!targetEntity) {
      throw notFound('Target entity not found.');
    }

    const result = await runSingleFlight({
      key: createActionKey(
        'entity-merge',
        String(req.currentUser._id),
        String(req.project._id),
        String(req.entity._id),
        String(targetEntity._id)
      ),
      action: () =>
        mergeProjectEntities({
          project: req.project,
          actor: req.currentUser,
          sourceEntity: req.entity,
          targetEntity
        })
    });

    sendApiOk(res, {
      sourceEntityId: result.sourceEntity.publicId,
      targetEntityId: result.targetEntity.publicId
    });
  })
);

export default router;

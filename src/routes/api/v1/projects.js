import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireProjectRole
} from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import { createProjectInvite } from '../../../services/invites/service.js';
import {
  changeMemberRole,
  createProjectForUser,
  getDashboardReadModel,
  getProjectActivityReadModel,
  getProjectAuditReadModel,
  getProjectMembersReadModel,
  getProjectWorkspaceReadModel,
  removeMemberFromProject,
  transferProjectOwnership,
  updateProjectDetails
} from '../../../services/projects/service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const projectParamsSchema = z.object({
  projectId: z.string().startsWith('prj_')
});

const memberParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  memberId: z.string().startsWith('pmm_')
});

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(120)
});

const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(120)
});

const inviteSchema = z
  .object({
    userId: z.string().startsWith('usr_').optional(),
    identifier: z.string().trim().min(1).max(160).optional(),
    role: z.enum(['editor', 'reviewer'])
  })
  .refine((payload) => payload.userId || payload.identifier, {
    message: 'A selected user is required.'
  });

const roleSchema = z.object({
  role: z.enum(['editor', 'reviewer'])
});

const ownershipTransferSchema = z.object({
  memberId: z.string().startsWith('pmm_')
});

router.get(
  '/projects',
  requireAuth,
  asyncRoute(async (req, res) => {
    const dashboard = await getDashboardReadModel({
      user: req.currentUser
    });

    sendApiOk(res, {
      projects: dashboard.projects
    });
  })
);

router.post(
  '/projects',
  requireAuth,
  validate({ body: createProjectSchema }),
  asyncRoute(async (req, res) => {
    const project = await createProjectForUser({
      owner: req.currentUser,
      title: req.body.title
    });

    sendApiOk(
      res,
      {
        project: {
          id: project.publicId,
          title: project.name,
          ownerUserId: project.ownerId?.publicId ?? null
        }
      },
      201
    );
  })
);

router.get(
  '/projects/:projectId',
  requireAuth,
  validate({ params: projectParamsSchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const workspace = await getProjectWorkspaceReadModel({
      project: req.project,
      membership: req.projectMembership
    });

    sendApiOk(res, workspace);
  })
);

router.patch(
  '/projects/:projectId',
  requireAuth,
  validate({ params: projectParamsSchema, body: updateProjectSchema }),
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const project = await updateProjectDetails({
      project: req.project,
      actor: req.currentUser,
      title: req.body.title
    });

    sendApiOk(res, {
      project: {
        id: project.publicId,
        title: project.name
      }
    });
  })
);

router.get(
  '/projects/:projectId/members',
  requireAuth,
  validate({ params: projectParamsSchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const members = await getProjectMembersReadModel({
      projectId: req.project._id
    });

    sendApiOk(res, {
      members
    });
  })
);

router.post(
  '/projects/:projectId/invites',
  requireAuth,
  validate({ params: projectParamsSchema, body: inviteSchema }),
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const member = await createProjectInvite({
      project: req.project,
      actor: req.currentUser,
      role: req.body.role,
      userId: req.body.userId,
      identifier: req.body.identifier
    });

    sendApiOk(
      res,
      {
        member
      },
      201
    );
  })
);

router.patch(
  '/projects/:projectId/members/:memberId',
  requireAuth,
  validate({ params: memberParamsSchema, body: roleSchema }),
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const member = await changeMemberRole({
      project: req.project,
      actor: req.currentUser,
      memberPublicId: req.params.memberId,
      nextRole: req.body.role
    });

    sendApiOk(res, {
      member
    });
  })
);

router.delete(
  '/projects/:projectId/members/:memberId',
  requireAuth,
  validate({ params: memberParamsSchema }),
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const member = await removeMemberFromProject({
      project: req.project,
      actor: req.currentUser,
      memberPublicId: req.params.memberId
    });

    sendApiOk(res, {
      member
    });
  })
);

router.post(
  '/projects/:projectId/ownership-transfer',
  requireAuth,
  validate({ params: projectParamsSchema, body: ownershipTransferSchema }),
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const transfer = await transferProjectOwnership({
      project: req.project,
      actor: req.currentUser,
      memberPublicId: req.body.memberId
    });

    sendApiOk(res, {
      transfer
    });
  })
);

router.get(
  '/projects/:projectId/activity',
  requireAuth,
  validate({ params: projectParamsSchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const activity = await getProjectActivityReadModel({
      projectId: req.project._id
    });

    sendApiOk(res, {
      activity
    });
  })
);

router.get(
  '/projects/:projectId/audit',
  requireAuth,
  validate({ params: projectParamsSchema }),
  loadProjectMembership,
  requireProjectRole('owner'),
  asyncRoute(async (req, res) => {
    const audit = await getProjectAuditReadModel({
      projectId: req.project._id
    });

    sendApiOk(res, {
      audit
    });
  })
);

export default router;

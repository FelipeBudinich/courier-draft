import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import { listPendingInboxInvites } from '../../../services/inbox/inbox-read-model.js';
import {
  acceptInvite,
  declineInvite,
} from '../../../services/invites/service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const inviteParamsSchema = z.object({
  inviteId: z.string().startsWith('pmm_')
});

router.get(
  '/invites',
  requireAuth,
  asyncRoute(async (req, res) => {
    const invites = await listPendingInboxInvites({
      user: req.currentUser
    });

    sendApiOk(res, {
      invites
    });
  })
);

router.post(
  '/invites/:inviteId/accept',
  requireAuth,
  validate({ params: inviteParamsSchema }),
  asyncRoute(async (req, res) => {
    const invite = await acceptInvite({
      invitePublicId: req.params.inviteId,
      user: req.currentUser
    });

    sendApiOk(res, {
      invite
    });
  })
);

router.post(
  '/invites/:inviteId/decline',
  requireAuth,
  validate({ params: inviteParamsSchema }),
  asyncRoute(async (req, res) => {
    const invite = await declineInvite({
      invitePublicId: req.params.inviteId,
      user: req.currentUser
    });

    sendApiOk(res, {
      invite
    });
  })
);

export default router;

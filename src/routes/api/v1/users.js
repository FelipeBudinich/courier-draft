import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute } from '../../../config/errors.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import { searchInviteCandidates } from '../../../services/invites/service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const userSearchSchema = z.object({
  q: z.string().trim().min(1).max(80)
});

router.get(
  '/users/search',
  requireAuth,
  validate({ query: userSearchSchema }),
  asyncRoute(async (req, res) => {
    const users = await searchInviteCandidates({
      currentUser: req.currentUser,
      query: req.query.q
    });

    sendApiOk(res, {
      users
    });
  })
);

export default router;

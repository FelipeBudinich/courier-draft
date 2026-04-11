import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute, notFound } from '../../../config/errors.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validation.js';
import { getInboxItemForUser } from '../../../services/inbox/inbox-read-model.js';
import {
  markAllInboxItemsRead,
  markInboxItemRead
} from '../../../services/inbox/unread-state.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const inboxItemParamsSchema = z.object({
  itemId: z.string().regex(/^(act|pmm)_[a-z0-9]+$/i)
});

router.post(
  '/inbox/read-all',
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await markAllInboxItemsRead({
      userId: req.currentUser._id
    });

    sendApiOk(res, {
      readAll: true,
      lastReadAllAt: result.lastReadAllAt
    });
  })
);

router.post(
  '/inbox/items/:itemId/read',
  requireAuth,
  validate({ params: inboxItemParamsSchema }),
  asyncRoute(async (req, res) => {
    const item = await getInboxItemForUser({
      user: req.currentUser,
      itemId: req.params.itemId
    });

    if (!item) {
      throw notFound('Inbox item not found.');
    }

    await markInboxItemRead({
      userId: req.currentUser._id,
      itemId: req.params.itemId
    });

    sendApiOk(res, {
      itemId: req.params.itemId,
      read: true
    });
  })
);

export default router;

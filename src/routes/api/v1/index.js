import { Router } from 'express';

import { setSurface } from '../../../middleware/request-context.js';
import meRouter from './me.js';
import placeholdersRouter from './placeholders.js';

const router = Router();

router.use(setSurface('api'));
router.use(meRouter);
router.use(placeholdersRouter);

export default router;


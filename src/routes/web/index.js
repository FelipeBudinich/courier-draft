import { Router } from 'express';

import { setSurface } from '../../middleware/request-context.js';
import authRouter from './auth.js';
import dashboardRouter from './dashboard.js';
import localeRouter from './locale.js';
import projectRouter from './projects.js';
import scriptsRouter from './scripts.js';

const router = Router();

router.use(setSurface('web'));
router.use(authRouter);
router.use(localeRouter);
router.use(dashboardRouter);
router.use(projectRouter);
router.use(scriptsRouter);

export default router;

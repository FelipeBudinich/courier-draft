import { Router } from 'express';

import { setSurface } from '../../../middleware/request-context.js';
import exportsRouter from './exports.js';
import invitesRouter from './invites.js';
import meRouter from './me.js';
import notesRouter from './notes.js';
import placeholdersRouter from './placeholders.js';
import projectsRouter from './projects.js';
import scenesRouter from './scenes.js';
import scriptsRouter from './scripts.js';
import usersRouter from './users.js';

const router = Router();

router.use(setSurface('api'));
router.use(meRouter);
router.use(usersRouter);
router.use(invitesRouter);
router.use(projectsRouter);
router.use(exportsRouter);
router.use(scriptsRouter);
router.use(scenesRouter);
router.use(notesRouter);
router.use(placeholdersRouter);

export default router;

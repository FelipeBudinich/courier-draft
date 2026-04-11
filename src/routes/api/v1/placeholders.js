import { Router } from 'express';

import {
  loadProjectMembership,
  requireAuth,
  requireNoteMutationAccess,
  requireProjectRole
} from '../../../middleware/auth.js';
import { loadNote, loadScene, loadScript } from '../../../middleware/resources.js';
import { asyncRoute } from '../../../config/errors.js';
import { sendNotImplemented } from './helpers.js';

const router = Router();

const placeholderRoutes = [
  {
    method: 'get',
    path: '/projects/:projectId/scripts/:scriptId/scenes/:sceneId',
    todo: 'Scene bootstrap read model',
    project: true,
    script: true,
    scene: true
  },
  {
    method: 'patch',
    path: '/projects/:projectId/scripts/:scriptId/scenes/:sceneId',
    todo: 'Scene metadata update',
    project: true,
    script: true,
    scene: true,
    role: 'editor'
  },
  {
    method: 'get',
    path: '/projects/:projectId/notes',
    todo: 'Project notes read model',
    project: true
  },
  {
    method: 'post',
    path: '/projects/:projectId/notes',
    todo: 'Note creation',
    project: true
  },
  {
    method: 'get',
    path: '/projects/:projectId/notes/:noteId',
    todo: 'Note detail',
    project: true,
    note: true
  },
  {
    method: 'patch',
    path: '/projects/:projectId/notes/:noteId',
    todo: 'Note update',
    project: true,
    note: true,
    noteMutation: true
  },
  {
    method: 'delete',
    path: '/projects/:projectId/notes/:noteId',
    todo: 'Note delete',
    project: true,
    note: true,
    noteMutation: true
  },
  {
    method: 'get',
    path: '/projects/:projectId/entities',
    todo: 'Entity registry read model',
    project: true
  },
  {
    method: 'post',
    path: '/projects/:projectId/entities',
    todo: 'Entity creation',
    project: true,
    role: 'editor'
  },
  {
    method: 'patch',
    path: '/projects/:projectId/entities/:entityId',
    todo: 'Entity update',
    project: true,
    role: 'editor'
  },
  {
    method: 'post',
    path: '/projects/:projectId/entities/:entityId/merge',
    todo: 'Entity merge',
    project: true,
    role: 'editor'
  },
  {
    method: 'get',
    path: '/projects/:projectId/metrics/characters',
    todo: 'Character metrics',
    project: true
  },
  {
    method: 'get',
    path: '/projects/:projectId/metrics/locations',
    todo: 'Location metrics',
    project: true
  },
  {
    method: 'post',
    path: '/projects/:projectId/scripts/:scriptId/exports/pdf',
    todo: 'PDF export',
    project: true,
    script: true
  }
];

for (const route of placeholderRoutes) {
  const middlewares = [requireAuth];

  if (route.project) {
    middlewares.push(loadProjectMembership);
  }

  if (route.script) {
    middlewares.push(loadScript);
  }

  if (route.scene) {
    middlewares.push(loadScene);
  }

  if (route.note) {
    middlewares.push(loadNote);
  }

  if (route.role) {
    middlewares.push(requireProjectRole(route.role));
  }

  if (route.noteMutation) {
    middlewares.push(requireNoteMutationAccess);
  }

  router[route.method](
    route.path,
    ...middlewares,
    asyncRoute(async (_req, res) => {
      sendNotImplemented(res, route.path, route.todo);
    })
  );
}

export default router;

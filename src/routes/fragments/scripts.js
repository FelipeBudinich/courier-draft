import { Router } from 'express';

import { asyncRoute } from '../../config/errors.js';
import { loadProjectMembership, requireAuth } from '../../middleware/auth.js';
import { loadScript } from '../../middleware/resources.js';
import { findSceneByPublicId } from '../../models/lookups.js';
import { getOutlineReadModel } from '../../services/outline/service.js';
import {
  listSceneVersions,
  listScriptVersionCheckpoints
} from '../../services/versioning/checkpoint-service.js';
import { renderFragment, serializeTemplateJson } from './helpers.js';

const router = Router();

router.get(
  '/projects/:projectId/scripts/:scriptId/outline-tree',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const outline = await getOutlineReadModel({
      script: req.script
    });

    renderFragment(res, 'partials/outline-tree.njk', {
      project: {
        id: req.project.publicId,
        title: req.project.name
      },
      script: {
        id: req.script.publicId,
        sceneNumberMode: req.script.sceneNumberMode
      },
      outlineNodes: outline.nodes,
      permissions: {
        canEdit: ['owner', 'editor'].includes(req.projectRole)
      },
      surface: req.query.surface === 'editor' ? 'editor' : 'fragment',
      activeSceneId: req.query.sceneId ? String(req.query.sceneId) : null
    });
  })
);

router.get(
  '/projects/:projectId/scripts/:scriptId/version-sidebar',
  requireAuth,
  loadProjectMembership,
  loadScript,
  asyncRoute(async (req, res) => {
    const activeSceneId = req.query.sceneId ? String(req.query.sceneId) : null;
    const activeScene = activeSceneId
      ? await findSceneByPublicId({
          projectId: req.project._id,
          scriptId: req.script._id,
          scenePublicId: activeSceneId
        })
      : null;
    const [scriptVersions, sceneVersions] = await Promise.all([
      listScriptVersionCheckpoints({
        script: req.script
      }),
      activeScene
        ? listSceneVersions({
            scene: activeScene
          })
        : []
    ]);

    renderFragment(res, 'partials/version-sidebar.njk', {
      versionSidebar: {
        project: {
          id: req.project.publicId
        },
        script: {
          id: req.script.publicId,
          currentVersionLabel: req.script.currentVersionLabel ?? null,
          lastCheckpointAt: scriptVersions[0]?.createdAt ?? null
        },
        activeScene: activeScene
          ? {
              id: activeScene.publicId,
              title: activeScene.title
            }
          : null,
        permissions: {
          canMajorSave: ['owner', 'editor'].includes(req.projectRole),
          canRestoreScene: ['owner', 'editor'].includes(req.projectRole)
        },
        scriptVersions,
        sceneVersions
      },
      versionSidebarBootJson: serializeTemplateJson({
        versionSidebar: {
          project: {
            id: req.project.publicId
          },
          script: {
            id: req.script.publicId,
            currentVersionLabel: req.script.currentVersionLabel ?? null,
            lastCheckpointAt: scriptVersions[0]?.createdAt ?? null
          },
          activeScene: activeScene
            ? {
                id: activeScene.publicId,
                title: activeScene.title
              }
            : null,
          permissions: {
            canMajorSave: ['owner', 'editor'].includes(req.projectRole),
            canRestoreScene: ['owner', 'editor'].includes(req.projectRole)
          },
          scriptVersions,
          sceneVersions
        }
      })
    });
  })
);

export default router;

import { roleHelpers } from '../../middleware/auth.js';
import { serializeScript } from '../scripts/helpers.js';
import { extractSceneDerivedFields } from './derived-fields.js';
import { getSceneHeadDocument, getSceneHeadRevision } from './legacy-document.js';

const walkSceneNodes = (outlineNodes, collected = []) => {
  for (const node of outlineNodes) {
    if (node.type === 'scene' && node.sceneId) {
      collected.push({
        id: node.id,
        sceneId: node.sceneId,
        title: node.title,
        displaySceneNumber: node.displaySceneNumber ?? null
      });
    }

    if (node.children?.length) {
      walkSceneNodes(node.children, collected);
    }
  }

  return collected;
};

const serializeUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    id: user.publicId,
    username: user.username ?? null,
    displayName: user.displayName ?? null
  };
};

const serializeProjectFrame = (project) => ({
  publicId: project.publicId ?? project.id,
  title: project.name ?? project.title
});

const serializeScriptFrame = (script) => {
  if (script?.id && !script.publicId) {
    return {
      publicId: script.id,
      projectId: script.projectId ?? null,
      title: script.title,
      description: script.description ?? '',
      genre: script.genre ?? '',
      status: script.status,
      language: script.language ?? '',
      authors: script.authors ?? [],
      majorSaveSequence: script.majorSaveSequence ?? 0,
      currentVersionLabel: script.currentVersionLabel ?? null,
      sceneNumberMode: script.sceneNumberMode,
      createdByUserId: script.createdByUserId ?? null,
      updatedByUserId: script.updatedByUserId ?? null,
      createdAt: script.createdAt ?? null,
      updatedAt: script.updatedAt ?? null,
      counts: script.counts ?? {
        totalNodes: 0,
        actCount: 0,
        beatCount: 0,
        sceneCount: 0
      }
    };
  }

  return serializeScript(script);
};

export const listOutlineScenes = (outlineNodes) => walkSceneNodes(outlineNodes);

export const resolveEditorSceneSelection = ({
  outlineNodes,
  requestedSceneId = null
}) => {
  const scenes = listOutlineScenes(outlineNodes);

  if (!scenes.length) {
    return {
      sceneEntries: scenes,
      activeSceneId: null
    };
  }

  if (requestedSceneId) {
    const existingScene = scenes.find((scene) => scene.sceneId === requestedSceneId);

    return {
      sceneEntries: scenes,
      activeSceneId: existingScene ? requestedSceneId : null
    };
  }

  return {
    sceneEntries: scenes,
    activeSceneId: scenes[0].sceneId
  };
};

export const buildSceneBootstrapPayload = ({
  project,
  script,
  scene,
  projectRole,
  outlineNodes,
  saveStateLabels = null
}) => {
  const sceneEntries = listOutlineScenes(outlineNodes);
  const outlineNode = sceneEntries.find((candidate) => candidate.sceneId === scene.publicId);
  const document = getSceneHeadDocument(scene);
  const derived = extractSceneDerivedFields(document);

  return {
    project: serializeProjectFrame(project),
    script: serializeScriptFrame(script),
    scene: {
      publicId: scene.publicId,
      title: scene.title,
      outlineNodeId: scene.outlineNodeId ? outlineNode?.id ?? null : null,
      displayedSceneNumber: outlineNode?.displaySceneNumber ?? null,
      cachedSlugline: scene.structuredBody?.cachedSlugline ?? derived.cachedSlugline,
      headRevision: getSceneHeadRevision(scene),
      headUpdatedAt: scene.headUpdatedAt,
      updatedBy: serializeUser(scene.updatedByUserId)
    },
    capabilities: {
      canEdit: roleHelpers.canEditProjectContent(projectRole)
    },
    document,
    ui: {
      saveStates:
        saveStateLabels ?? {
        saved: 'Saved',
        saving: 'Saving…',
        unsaved: 'Unsaved changes',
        failed: 'Save failed',
        readOnly: 'Read-only',
        stale: 'Stale local copy'
      }
    }
  };
};

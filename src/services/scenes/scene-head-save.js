import { ZodError } from 'zod';

import { badRequest, staleState } from '../../config/errors.js';
import { Project, Scene } from '../../models/index.js';
import { remapAnchoredNotesForScene } from '../notes/service.js';
import { canonicalDocumentToPlainText } from './document-adapter.js';
import { extractSceneDerivedFields } from './derived-fields.js';
import { getSceneHeadDocument } from './legacy-document.js';
import { normalizeCanonicalSceneDocument } from './document-normalizer.js';

const buildStaleStateDetails = (scene) =>
  scene
    ? {
        sceneId: scene.publicId,
        headRevision: scene.headRevision ?? 0,
        headUpdatedAt: scene.headUpdatedAt,
        document: getSceneHeadDocument(scene),
        derived: {
          cachedSlugline: scene.structuredBody?.cachedSlugline ?? null,
          characterRefs: scene.structuredBody?.characterRefs ?? [],
          locationRefs: scene.structuredBody?.locationRefs ?? []
        }
      }
    : null;

export const saveSceneHead = async ({
  scene,
  actor,
  baseHeadRevision,
  document
}) => {
  let normalizedDocument = null;

  try {
    normalizedDocument = normalizeCanonicalSceneDocument(document);
  } catch (error) {
    if (error instanceof ZodError) {
      throw badRequest('Scene document validation failed.', {
        issues: error.issues
      });
    }

    throw error;
  }

  const derived = extractSceneDerivedFields(normalizedDocument);
  const headContent = canonicalDocumentToPlainText(normalizedDocument);
  const headUpdatedAt = new Date();

  const savedScene = await Scene.findOneAndUpdate(
    {
      _id: scene._id,
      headRevision: baseHeadRevision
    },
    {
      $set: {
        documentSchemaVersion: normalizedDocument.schemaVersion,
        headDocument: normalizedDocument,
        'structuredBody.blocks': normalizedDocument.blocks,
        'structuredBody.cachedSlugline': derived.cachedSlugline,
        'structuredBody.characterRefs': derived.characterRefs,
        'structuredBody.locationRefs': derived.locationRefs,
        headContent,
        headUpdatedAt,
        updatedByUserId: actor._id
      },
      $inc: {
        headRevision: 1
      }
    },
    {
      new: true
    }
  )
    .populate('updatedByUserId', 'publicId username displayName')
    .exec();

  if (!savedScene) {
    const latestScene = await Scene.findById(scene._id)
      .populate('updatedByUserId', 'publicId username displayName')
      .exec();

    throw staleState('A newer draft exists for this scene.', buildStaleStateDetails(latestScene));
  }

  const project = await Project.findById(savedScene.projectId).select('publicId name');
  if (project) {
    await remapAnchoredNotesForScene({
      project,
      scene: savedScene,
      document: getSceneHeadDocument(savedScene)
    });
  }

  return {
    sceneId: savedScene.publicId,
    headRevision: savedScene.headRevision,
    headUpdatedAt: savedScene.headUpdatedAt,
    document: getSceneHeadDocument(savedScene),
    derived
  };
};

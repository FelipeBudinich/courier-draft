import { Project, Scene } from '../../models/index.js';
import { remapAnchoredNotesForScene } from '../notes/service.js';
import { canonicalDocumentToPlainText } from '../scenes/document-adapter.js';
import { extractSceneDerivedFields } from '../scenes/derived-fields.js';
import { normalizeCanonicalSceneDocument } from '../scenes/document-normalizer.js';

export const persistSceneSessionHead = async ({
  sceneObjectId,
  actorId,
  document
}) => {
  const normalizedDocument = normalizeCanonicalSceneDocument(document);
  const derived = extractSceneDerivedFields(normalizedDocument);
  const headContent = canonicalDocumentToPlainText(normalizedDocument);
  const headUpdatedAt = new Date();

  const savedScene = await Scene.findByIdAndUpdate(
    sceneObjectId,
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
        updatedByUserId: actorId
      },
      $inc: {
        headRevision: 1
      }
    },
    {
      new: true
    }
  ).exec();

  const project = await Project.findById(savedScene.projectId).select('publicId name');
  if (project) {
    await remapAnchoredNotesForScene({
      project,
      scene: savedScene,
      document: normalizedDocument
    });
  }

  return {
    sceneId: savedScene.publicId,
    headRevision: savedScene.headRevision,
    headUpdatedAt: savedScene.headUpdatedAt,
    document: normalizedDocument,
    derived
  };
};

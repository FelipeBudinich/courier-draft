import { badRequest } from '../../config/errors.js';
import { OutlineNode, Scene } from '../../models/index.js';
import { buildOutlineTree } from '../outline/read-model.js';
import { normalizeCanonicalSceneDocument } from '../scenes/document-normalizer.js';
import { resolveSceneCurrentHeadState } from '../versioning/document-snapshot-service.js';

const buildOrderedIndexMap = (items) =>
  new Map(items.map((item, index) => [item, index + 1]));

export const loadCanonicalScriptExportContext = async ({
  project,
  script
}) => {
  const [outlineNodes, scenes] = await Promise.all([
    OutlineNode.find({
      projectId: project._id,
      scriptId: script._id
    }).sort({ positionKey: 1 }),
    Scene.find({
      projectId: project._id,
      scriptId: script._id
    }).select(
      [
        '_id',
        'publicId',
        'title',
        'projectId',
        'scriptId',
        'outlineNodeId',
        'headDocument',
        'headRevision',
        'headUpdatedAt',
        'currentMajorVersionId',
        'latestMajorVersionId'
      ].join(' ')
    )
  ]);

  const outlineTree = buildOutlineTree({
    nodes: outlineNodes,
    scenes,
    sceneNumberMode: script.sceneNumberMode
  });

  const sceneByPublicId = new Map(
    scenes.map((scene) => [scene.publicId, scene])
  );
  const actIndexByNodeId = buildOrderedIndexMap(
    outlineNodes
      .filter((node) => node.type === 'act')
      .map((node) => node.publicId)
  );
  const beatIndexByNodeId = buildOrderedIndexMap(
    outlineNodes
      .filter((node) => node.type === 'beat')
      .map((node) => node.publicId)
  );
  const canonicalSceneEntries = outlineTree.canonicalSceneNodes
    .filter((node) => node.sceneId)
    .map((node, index) => ({
      sceneId: node.sceneId,
      outlineNodeId: node.id,
      actNodeId: node.actId ?? null,
      beatNodeId: node.beatId ?? null,
      title: node.title,
      displaySceneNumber: node.displaySceneNumber ?? null,
      sceneOrder: index + 1,
      actOrder: actIndexByNodeId.get(node.actId) ?? 0,
      beatOrder: beatIndexByNodeId.get(node.beatId) ?? 0,
      scene: sceneByPublicId.get(node.sceneId) ?? null
    }))
    .filter((entry) => entry.scene);

  return {
    outlineNodes: outlineTree.nodes,
    canonicalSceneEntries
  };
};

const createBlockStreamEntry = ({
  sceneEntry,
  block,
  blockIndex
}) => ({
  id: `${sceneEntry.sceneId}:${block.id}`,
  sceneId: sceneEntry.sceneId,
  sceneTitle: sceneEntry.title,
  sceneNumber: sceneEntry.displaySceneNumber ?? null,
  outlineNodeId: sceneEntry.outlineNodeId,
  actNodeId: sceneEntry.actNodeId,
  beatNodeId: sceneEntry.beatNodeId,
  sceneOrder: sceneEntry.sceneOrder,
  actOrder: sceneEntry.actOrder,
  beatOrder: sceneEntry.beatOrder,
  blockId: block.id,
  blockOrder: blockIndex,
  type: block.type,
  text: block.text ?? '',
  left: block.left ?? null,
  right: block.right ?? null
});

export const assembleCanonicalScriptBlocks = async ({
  canonicalSceneEntries
}) => {
  if (!canonicalSceneEntries.length) {
    throw badRequest('This script has no scenes to export.');
  }

  const sceneDocuments = await Promise.all(
    canonicalSceneEntries.map(async (sceneEntry) => {
      const currentHeadState = await resolveSceneCurrentHeadState({
        scene: sceneEntry.scene,
        flushLive: true
      });

      return {
        ...sceneEntry,
        document: normalizeCanonicalSceneDocument(currentHeadState.contentSnapshot)
      };
    })
  );
  const blockStream = [];

  sceneDocuments.forEach((sceneEntry) => {
    sceneEntry.document.blocks.forEach((block, blockIndex) => {
      blockStream.push(
        createBlockStreamEntry({
          sceneEntry,
          block,
          blockIndex
        })
      );
    });
  });

  if (!blockStream.length) {
    throw badRequest('This script has no exportable screenplay blocks.');
  }

  return {
    scenes: sceneDocuments,
    blockStream
  };
};


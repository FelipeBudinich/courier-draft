import mongoose from 'mongoose';

import { badRequest, notFound } from '../../config/errors.js';
import { DocumentVersion, Note, OutlineNode, Scene } from '../../models/index.js';
import {
  createActivityEvent,
  listScriptActivity,
  serializeActivityEvent
} from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import { rebuildProjectEntityRegistry } from '../entities/entity-registry-rebuild.js';
import { applySceneNumbering } from '../numbering/service.js';
import { emitToScriptRoom } from '../realtime/broadcaster.js';
import { buildOutlineTree } from './read-model.js';
import {
  buildRebalancedPositionKeys,
  resolveMidpointPositionKey,
  sortByPositionKey
} from './position-keys.js';
import {
  clearDeletedSemanticLinks,
  normalizeSceneSemanticLinks,
  resolveSceneCreateSemanticLinks,
  validatePlacementParent
} from './semantics.js';
import { buildScriptActivityMessage, emitScriptActivity } from '../scripts/helpers.js';
import { emptySceneDocument } from '../scenes/document-constants.js';

const idString = (value) => (value ? String(value) : null);

const loadOutlineContext = async ({ scriptId, session }) => {
  const nodeQuery = OutlineNode.find({ scriptId }).sort({ positionKey: 1 });
  const sceneQuery = Scene.find({ scriptId });

  if (session) {
    nodeQuery.session(session);
    sceneQuery.session(session);
  }

  const [nodes, scenes] = await Promise.all([nodeQuery, sceneQuery]);

  return {
    nodes,
    scenes,
    nodesById: new Map(nodes.map((node) => [idString(node._id), node])),
    nodesByPublicId: new Map(nodes.map((node) => [node.publicId, node])),
    scenesById: new Map(scenes.map((scene) => [idString(scene._id), scene])),
    scenesByPublicId: new Map(scenes.map((scene) => [scene.publicId, scene]))
  };
};

const serializeNodeDelta = ({ node, context }) => ({
  id: node.publicId,
  type: node.type,
  title: node.title,
  placementParentId:
    context.nodesById.get(idString(node.placementParentId))?.publicId ?? null,
  positionKey: node.positionKey,
  sceneId: context.scenesById.get(idString(node.sceneId))?.publicId ?? null,
  actId: context.nodesById.get(idString(node.actId))?.publicId ?? null,
  beatId: context.nodesById.get(idString(node.beatId))?.publicId ?? null,
  autoSceneNumber: node.autoSceneNumber ?? null,
  manualSceneNumber: node.manualSceneNumber ?? null
});

const createOutlineChangedPayload = ({
  projectPublicId,
  scriptPublicId,
  actor,
  op,
  node = null,
  deletedNodeId = null,
  renumberedNodeIds = [],
  context
}) => ({
  projectId: projectPublicId,
  scriptId: scriptPublicId,
  op,
  actor: {
    userId: actor.publicId,
    username: actor.username ?? null
  },
  ...(node ? { node: serializeNodeDelta({ node, context }) } : {}),
  ...(deletedNodeId ? { deletedNodeId } : {}),
  ...(renumberedNodeIds.length ? { renumberedNodeIds } : {}),
  ts: new Date().toISOString()
});

const resolveInsertDescriptor = (insert = {}) => {
  const candidates = ['beforeNodeId', 'afterNodeId', 'index'].filter((fieldName) =>
    Object.prototype.hasOwnProperty.call(insert, fieldName) &&
    insert[fieldName] !== undefined &&
    insert[fieldName] !== null &&
    insert[fieldName] !== ''
  );

  if (candidates.length > 1) {
    throw badRequest('Only one insert hint may be provided at a time.');
  }

  return insert;
};

const resolveInsertionIndex = ({ siblings, insert }) => {
  const normalizedInsert = resolveInsertDescriptor(insert);

  if (Object.prototype.hasOwnProperty.call(normalizedInsert, 'beforeNodeId')) {
    const index = siblings.findIndex((node) => node.publicId === normalizedInsert.beforeNodeId);
    if (index === -1) {
      throw badRequest('beforeNodeId must reference a sibling in the target container.');
    }

    return index;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedInsert, 'afterNodeId')) {
    const index = siblings.findIndex((node) => node.publicId === normalizedInsert.afterNodeId);
    if (index === -1) {
      throw badRequest('afterNodeId must reference a sibling in the target container.');
    }

    return index + 1;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedInsert, 'index')) {
    const nextIndex = Number.parseInt(normalizedInsert.index, 10);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex > siblings.length) {
      throw badRequest('index must be an integer within the sibling range.');
    }

    return nextIndex;
  }

  return siblings.length;
};

const resolvePositionAssignment = ({ siblings, insert, targetKey }) => {
  const insertionIndex = resolveInsertionIndex({
    siblings,
    insert
  });
  const previousSibling = siblings[insertionIndex - 1] ?? null;
  const nextSibling = siblings[insertionIndex] ?? null;
  const midpointKey = resolveMidpointPositionKey({
    previousKey: previousSibling?.positionKey ?? null,
    nextKey: nextSibling?.positionKey ?? null
  });

  if (midpointKey) {
    return {
      positionKey: midpointKey,
      siblingUpdates: []
    };
  }

  const orderedNodes = [...siblings];
  orderedNodes.splice(insertionIndex, 0, {
    _id: targetKey,
    positionKey: null
  });

  const rebalancedNodes = buildRebalancedPositionKeys(orderedNodes);
  const siblingPositions = new Map(siblings.map((node) => [idString(node._id), node.positionKey]));

  return {
    positionKey: rebalancedNodes[insertionIndex].positionKey,
    siblingUpdates: rebalancedNodes
      .filter((node) => idString(node._id) !== idString(targetKey))
      .filter((node) => siblingPositions.get(idString(node._id)) !== node.positionKey)
      .map((node) => ({
        _id: node._id,
        positionKey: node.positionKey
      }))
  };
};

const applySiblingUpdates = async ({ siblingUpdates, session }) => {
  if (!siblingUpdates.length) {
    return;
  }

  await OutlineNode.bulkWrite(
    siblingUpdates.map((update) => ({
      updateOne: {
        filter: { _id: update._id },
        update: {
          $set: {
            positionKey: update.positionKey
          }
        }
      }
    })),
    session ? { session } : {}
  );
};

const buildChildrenMap = (nodes) => {
  const childrenByParent = new Map();

  for (const node of nodes) {
    const parentKey = idString(node.placementParentId) ?? 'root';
    const bucket = childrenByParent.get(parentKey) ?? [];
    bucket.push(node);
    childrenByParent.set(parentKey, bucket);
  }

  return childrenByParent;
};

const collectSubtreeNodeIds = ({ rootNodeId, nodes }) => {
  const childrenByParent = buildChildrenMap(nodes);
  const subtreeNodeIds = new Set();
  const stack = [rootNodeId];

  while (stack.length) {
    const currentId = stack.pop();
    if (!currentId || subtreeNodeIds.has(currentId)) {
      continue;
    }

    subtreeNodeIds.add(currentId);
    const children = childrenByParent.get(currentId) ?? [];
    children.forEach((child) => stack.push(idString(child._id)));
  }

  return subtreeNodeIds;
};

export const synchronizeSceneNumbering = async ({
  script,
  session,
  context = null
}) => {
  const outlineContext =
    context ?? (await loadOutlineContext({ scriptId: script._id, session }));
  const outlineTree = buildOutlineTree({
    nodes: outlineContext.nodes,
    scenes: outlineContext.scenes,
    sceneNumberMode: script.sceneNumberMode
  });
  const sceneDocsByPublicId = new Map(
    outlineContext.nodes.map((node) => [node.publicId, node])
  );
  const sceneNodesInOrder = outlineTree.canonicalSceneNodes.map((node) =>
    sceneDocsByPublicId.get(node.id)
  );
  const { autoSceneNumbers } = applySceneNumbering({
    sceneNumberMode: script.sceneNumberMode,
    sceneNodes: sceneNodesInOrder
  });
  const renumberedNodeIds = [];
  const bulkUpdates = [];

  for (const node of sceneNodesInOrder) {
    const nextAutoSceneNumber = autoSceneNumbers.get(idString(node._id)) ?? null;
    if ((node.autoSceneNumber ?? null) === nextAutoSceneNumber) {
      continue;
    }

    node.autoSceneNumber = nextAutoSceneNumber;
    renumberedNodeIds.push(node.publicId);
    bulkUpdates.push({
      updateOne: {
        filter: { _id: node._id },
        update: {
          $set: {
            autoSceneNumber: nextAutoSceneNumber
          }
        }
      }
    });
  }

  if (bulkUpdates.length) {
    await OutlineNode.bulkWrite(bulkUpdates, session ? { session } : {});
  }

  return {
    outlineContext,
    outlineTree,
    renumberedNodeIds
  };
};

const touchScript = async ({ script, actor, session }) => {
  script.updatedByUserId = actor._id;
  await script.save({ session });
};

const createOutlineActivityAndAudit = async ({
  project,
  script,
  actor,
  type,
  node,
  session,
  metadata = {}
}) => {
  const activityEvent = await createActivityEvent({
    projectId: project._id,
    actorId: actor._id,
    type,
    message: buildScriptActivityMessage({
      type,
      actor,
      scriptTitle: script.title,
      nodeTitle: node.title,
      nodeType: node.type
    }),
    payload: {
      targetType: 'outline_node',
      targetId: node.publicId,
      scriptId: script.publicId,
      nodeId: node.publicId,
      nodeType: node.type,
      ...metadata
    },
    session
  });

  await createAuditLog({
    scope: 'project',
    projectId: project._id,
    actorId: actor._id,
    action: type,
    targetType: 'outline_node',
    targetId: node.publicId,
    metadata: {
      scriptId: script.publicId,
      nodeType: node.type,
      title: node.title,
      ...metadata
    },
    session
  });

  return activityEvent;
};

const deleteSceneArtifacts = async ({ sceneIds, deletedOutlineNodeIds = [], session }) => {
  if (!sceneIds.length && !deletedOutlineNodeIds.length) {
    return;
  }

  const noteQuery = [];
  if (sceneIds.length) {
    noteQuery.push({
      sceneId: { $in: sceneIds }
    });
  }

  if (deletedOutlineNodeIds.length) {
    noteQuery.push({
      containerId: {
        $in: deletedOutlineNodeIds
      }
    });
  }

  const notes = await Note.find({
    $or: noteQuery
  })
    .select('_id')
    .session(session);
  const noteIds = notes.map((note) => note._id);

  await Promise.all([
    DocumentVersion.deleteMany({
      docType: 'scene',
      docId: { $in: sceneIds }
    }).session(session),
    noteIds.length
      ? DocumentVersion.deleteMany({
          docType: 'note',
          docId: { $in: noteIds }
        }).session(session)
      : Promise.resolve(),
    Note.deleteMany({
      $or: noteQuery
    }).session(session),
    Scene.deleteMany({
      _id: { $in: sceneIds }
    }).session(session)
  ]);
};

const applyBeatRelinkRules = async ({ beatNode, nodes, session }) => {
  if (!beatNode || beatNode.type !== 'beat') {
    return;
  }

  const nodesById = new Map(nodes.map((node) => [idString(node._id), node]));
  const parentNode = nodesById.get(idString(beatNode.placementParentId));
  const inheritedActId = parentNode?.type === 'act' ? parentNode._id : null;
  const affectedScenes = nodes.filter(
    (node) => node.type === 'scene' && idString(node.beatId) === idString(beatNode._id)
  );

  if (!affectedScenes.length || !inheritedActId) {
    return;
  }

  const updates = affectedScenes
    .filter((sceneNode) => idString(sceneNode.actId) !== idString(inheritedActId))
    .map((sceneNode) => {
      sceneNode.actId = inheritedActId;
      return {
        updateOne: {
          filter: { _id: sceneNode._id },
          update: {
            $set: {
              actId: inheritedActId
            }
          }
        }
      };
    });

  if (!updates.length) {
    return;
  }

  await OutlineNode.bulkWrite(updates, session ? { session } : {});
};

export const getOutlineReadModel = async ({ script, session = null }) => {
  const outlineContext = await loadOutlineContext({
    scriptId: script._id,
    session
  });

  return buildOutlineTree({
    nodes: outlineContext.nodes,
    scenes: outlineContext.scenes,
    sceneNumberMode: script.sceneNumberMode
  });
};

export const getScriptActivitySummary = async ({ projectId, scriptPublicId, limit = 10 }) => {
  const activity = await listScriptActivity({
    projectId,
    scriptPublicId,
    limit
  });

  return activity.map(serializeActivityEvent);
};

export const createOutlineNode = async ({
  project,
  script,
  actor,
  type,
  title,
  placementParentId = null,
  actId = null,
  beatId = null,
  insert = {}
}) => {
  const trimmedTitle = String(title ?? '').trim();
  if (!trimmedTitle) {
    throw badRequest('Outline nodes require a title.');
  }

  let createdNode = null;
  let outlineContext = null;
  let activityEvent = null;
  let renumberedNodeIds = [];

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const context = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      outlineContext = context;

      const parentNode = placementParentId
        ? context.nodesByPublicId.get(placementParentId) ?? null
        : null;

      if (placementParentId && !parentNode) {
        throw notFound('Outline parent not found.');
      }

      validatePlacementParent({
        type,
        parentNode
      });

      const siblings = sortByPositionKey(
        context.nodes.filter(
          (node) => idString(node.placementParentId) === idString(parentNode?._id ?? null)
        )
      );
      const { positionKey, siblingUpdates } = resolvePositionAssignment({
        siblings,
        insert,
        targetKey: 'new-node'
      });

      await applySiblingUpdates({
        siblingUpdates,
        session
      });

      let scene = null;
      let normalizedLinks = {
        actId: null,
        beatId: null
      };

      if (type === 'scene') {
        normalizedLinks = resolveSceneCreateSemanticLinks({
          parentNode,
          actId: actId ? context.nodesByPublicId.get(actId)?._id ?? null : null,
          beatId: beatId ? context.nodesByPublicId.get(beatId)?._id ?? null : null,
          nodesById: context.nodesById
        });

        [scene] = await Scene.create(
          [
            {
              projectId: project._id,
              scriptId: script._id,
              outlineNodeId: null,
              title: trimmedTitle,
              documentSchemaVersion: 1,
              structuredBody: {
                blocks: emptySceneDocument().blocks,
                cachedSlugline: null,
                characterRefs: [],
                locationRefs: []
              },
              headDocument: emptySceneDocument(),
              headRevision: 0,
              headContent: '',
              headUpdatedAt: new Date(),
              updatedByUserId: actor._id
            }
          ],
          { session }
        );
      }

      [createdNode] = await OutlineNode.create(
        [
          {
            projectId: project._id,
            scriptId: script._id,
            type,
            title: trimmedTitle,
            placementParentId: parentNode?._id ?? null,
            positionKey,
            sceneId: scene?._id ?? null,
            actId: normalizedLinks.actId,
            beatId: normalizedLinks.beatId,
            autoSceneNumber: null,
            manualSceneNumber: null
          }
        ],
        { session }
      );

      if (scene) {
        scene.outlineNodeId = createdNode._id;
        await scene.save({ session });
      }

      await touchScript({
        script,
        actor,
        session
      });

      const refreshedContext = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      const numberingResult = await synchronizeSceneNumbering({
        script,
        session,
        context: refreshedContext
      });

      outlineContext = numberingResult.outlineContext;
      renumberedNodeIds = numberingResult.renumberedNodeIds;
      activityEvent = await createOutlineActivityAndAudit({
        project,
        script,
        actor,
        type: 'outline.node_created',
        node: createdNode,
        session,
        metadata: {
          renumberedNodeIds
        }
      });
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
  emitToScriptRoom(
    script.publicId,
    'outline:changed',
    createOutlineChangedPayload({
      projectPublicId: project.publicId,
      scriptPublicId: script.publicId,
      actor,
      op: 'created',
      node: createdNode,
      renumberedNodeIds,
      context: outlineContext
    })
  );

  return createdNode;
};

export const updateOutlineNode = async ({
  project,
  script,
  actor,
  nodePublicId,
  updates
}) => {
  let updatedNode = null;
  let outlineContext = null;
  let renumberedNodeIds = [];
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const context = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      outlineContext = context;

      const node = context.nodesByPublicId.get(nodePublicId);
      if (!node) {
        throw notFound('Outline node not found.');
      }

      const nextTitle = Object.prototype.hasOwnProperty.call(updates, 'title')
        ? String(updates.title ?? '').trim()
        : node.title;
      if (!nextTitle) {
        throw badRequest('Outline nodes require a title.');
      }

      node.title = nextTitle;

      if (node.type !== 'scene') {
        if (Object.prototype.hasOwnProperty.call(updates, 'actId') ||
            Object.prototype.hasOwnProperty.call(updates, 'beatId') ||
            Object.prototype.hasOwnProperty.call(updates, 'manualSceneNumber')) {
          throw badRequest('Only scene nodes may update semantic links or manual scene numbers.');
        }
      } else {
        const nextActId = Object.prototype.hasOwnProperty.call(updates, 'actId')
          ? updates.actId
            ? context.nodesByPublicId.get(updates.actId)?._id ?? null
            : null
          : node.actId;
        const nextBeatId = Object.prototype.hasOwnProperty.call(updates, 'beatId')
          ? updates.beatId
            ? context.nodesByPublicId.get(updates.beatId)?._id ?? null
            : null
          : node.beatId;
        const normalizedLinks = normalizeSceneSemanticLinks({
          actId: nextActId,
          beatId: nextBeatId,
          nodesById: context.nodesById
        });

        node.actId = normalizedLinks.actId;
        node.beatId = normalizedLinks.beatId;
        node.manualSceneNumber =
          Object.prototype.hasOwnProperty.call(updates, 'manualSceneNumber')
            ? updates.manualSceneNumber
              ? String(updates.manualSceneNumber).trim().toUpperCase()
              : null
            : node.manualSceneNumber;

        const scene = context.scenesById.get(idString(node.sceneId));
        if (scene) {
          scene.title = nextTitle;
          await scene.save({ session });
        }
      }

      await node.save({ session });
      await touchScript({
        script,
        actor,
        session
      });

      const refreshedContext = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      const numberingResult = await synchronizeSceneNumbering({
        script,
        session,
        context: refreshedContext
      });

      outlineContext = numberingResult.outlineContext;
      renumberedNodeIds = numberingResult.renumberedNodeIds;
      updatedNode = outlineContext.nodesByPublicId.get(nodePublicId);
      activityEvent = await createOutlineActivityAndAudit({
        project,
        script,
        actor,
        type: 'outline.node_updated',
        node: updatedNode,
        session,
        metadata: {
          renumberedNodeIds
        }
      });
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
  emitToScriptRoom(
    script.publicId,
    'outline:changed',
    createOutlineChangedPayload({
      projectPublicId: project.publicId,
      scriptPublicId: script.publicId,
      actor,
      op: 'updated',
      node: updatedNode,
      renumberedNodeIds,
      context: outlineContext
    })
  );

  return updatedNode;
};

export const moveOutlineNode = async ({
  project,
  script,
  actor,
  nodePublicId,
  placementParentId = null,
  insert = {},
  semanticOverrides = {}
}) => {
  let movedNode = null;
  let outlineContext = null;
  let renumberedNodeIds = [];
  let activityEvent = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const context = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      outlineContext = context;

      const node = context.nodesByPublicId.get(nodePublicId);
      if (!node) {
        throw notFound('Outline node not found.');
      }

      const nextParentNode = placementParentId
        ? context.nodesByPublicId.get(placementParentId) ?? null
        : null;

      if (placementParentId && !nextParentNode) {
        throw notFound('Target outline parent not found.');
      }

      validatePlacementParent({
        type: node.type,
        parentNode: nextParentNode
      });

      const subtreeNodeIds = collectSubtreeNodeIds({
        rootNodeId: idString(node._id),
        nodes: context.nodes
      });
      if (nextParentNode && subtreeNodeIds.has(idString(nextParentNode._id))) {
        throw badRequest('Outline nodes cannot be moved inside their own subtree.');
      }

      const siblings = sortByPositionKey(
        context.nodes.filter(
          (candidate) =>
            idString(candidate._id) !== idString(node._id) &&
            idString(candidate.placementParentId) ===
              idString(nextParentNode?._id ?? null)
        )
      );
      const { positionKey, siblingUpdates } = resolvePositionAssignment({
        siblings,
        insert,
        targetKey: idString(node._id)
      });

      await applySiblingUpdates({
        siblingUpdates,
        session
      });

      node.placementParentId = nextParentNode?._id ?? null;
      node.positionKey = positionKey;

      if (node.type === 'scene' &&
          (Object.prototype.hasOwnProperty.call(semanticOverrides, 'actId') ||
            Object.prototype.hasOwnProperty.call(semanticOverrides, 'beatId'))) {
        const normalizedLinks = normalizeSceneSemanticLinks({
          actId: Object.prototype.hasOwnProperty.call(semanticOverrides, 'actId')
            ? semanticOverrides.actId
              ? context.nodesByPublicId.get(semanticOverrides.actId)?._id ?? null
              : null
            : node.actId,
          beatId: Object.prototype.hasOwnProperty.call(semanticOverrides, 'beatId')
            ? semanticOverrides.beatId
              ? context.nodesByPublicId.get(semanticOverrides.beatId)?._id ?? null
              : null
            : node.beatId,
          nodesById: context.nodesById
        });

        node.actId = normalizedLinks.actId;
        node.beatId = normalizedLinks.beatId;
      }

      await node.save({ session });

      const refreshedContext = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      await applyBeatRelinkRules({
        beatNode: node.type === 'beat' ? node : null,
        nodes: refreshedContext.nodes,
        session
      });
      await touchScript({
        script,
        actor,
        session
      });

      const fullyRefreshedContext = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      const numberingResult = await synchronizeSceneNumbering({
        script,
        session,
        context: fullyRefreshedContext
      });

      outlineContext = numberingResult.outlineContext;
      renumberedNodeIds = numberingResult.renumberedNodeIds;
      movedNode = outlineContext.nodesByPublicId.get(nodePublicId);
      activityEvent = await createOutlineActivityAndAudit({
        project,
        script,
        actor,
        type: 'outline.node_moved',
        node: movedNode,
        session,
        metadata: {
          renumberedNodeIds
        }
      });
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
  emitToScriptRoom(
    script.publicId,
    'outline:changed',
    createOutlineChangedPayload({
      projectPublicId: project.publicId,
      scriptPublicId: script.publicId,
      actor,
      op: 'moved',
      node: movedNode,
      renumberedNodeIds,
      context: outlineContext
    })
  );

  return movedNode;
};

export const deleteOutlineNode = async ({
  project,
  script,
  actor,
  nodePublicId
}) => {
  let deletedNode = null;
  let activityEvent = null;
  let outlineContext = null;
  let renumberedNodeIds = [];
  let deletedSceneCount = 0;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const context = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      outlineContext = context;

      const node = context.nodesByPublicId.get(nodePublicId);
      if (!node) {
        throw notFound('Outline node not found.');
      }

      deletedNode = node;
      const subtreeNodeIds = collectSubtreeNodeIds({
        rootNodeId: idString(node._id),
        nodes: context.nodes
      });
      const subtreeNodes = context.nodes.filter((candidate) =>
        subtreeNodeIds.has(idString(candidate._id))
      );
      const deletedActIds = new Set(
        subtreeNodes.filter((candidate) => candidate.type === 'act').map((candidate) => idString(candidate._id))
      );
      const deletedBeatIds = new Set(
        subtreeNodes.filter((candidate) => candidate.type === 'beat').map((candidate) => idString(candidate._id))
      );
      const deletedSceneIds = subtreeNodes
        .filter((candidate) => candidate.type === 'scene' && candidate.sceneId)
        .map((candidate) => candidate.sceneId);
      deletedSceneCount = deletedSceneIds.length;

      const remainingSceneUpdates = clearDeletedSemanticLinks({
        deletedNodeIds: subtreeNodeIds,
        deletedActIds,
        deletedBeatIds,
        sceneNodes: context.nodes.filter((candidate) => candidate.type === 'scene')
      });

      const relinkOperations = remainingSceneUpdates
        .filter(
          ({ node: sceneNode, actId, beatId }) =>
            idString(sceneNode.actId) !== idString(actId) ||
            idString(sceneNode.beatId) !== idString(beatId)
        )
        .map(({ node: sceneNode, actId, beatId }) => {
          sceneNode.actId = actId;
          sceneNode.beatId = beatId;
          return {
            updateOne: {
              filter: { _id: sceneNode._id },
              update: {
                $set: {
                  actId,
                  beatId
                }
              }
            }
          };
        });

      if (relinkOperations.length) {
        await OutlineNode.bulkWrite(relinkOperations, { session });
      }

      await Promise.all([
        OutlineNode.deleteMany({
          _id: { $in: [...subtreeNodeIds].map((nodeId) => new mongoose.Types.ObjectId(nodeId)) }
        }).session(session),
        deleteSceneArtifacts({
          sceneIds: deletedSceneIds,
          deletedOutlineNodeIds: [...subtreeNodeIds].map(
            (nodeId) => new mongoose.Types.ObjectId(nodeId)
          ),
          session
        })
      ]);

      await touchScript({
        script,
        actor,
        session
      });

      const refreshedContext = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      const numberingResult = await synchronizeSceneNumbering({
        script,
        session,
        context: refreshedContext
      });

      outlineContext = numberingResult.outlineContext;
      renumberedNodeIds = numberingResult.renumberedNodeIds;
      activityEvent = await createOutlineActivityAndAudit({
        project,
        script,
        actor,
        type: 'outline.node_deleted',
        node,
        session,
        metadata: {
          deletedNodeIds: subtreeNodes.map((candidate) => candidate.publicId),
          renumberedNodeIds
        }
      });
    });
  } finally {
    await session.endSession();
  }

  if (deletedSceneCount > 0) {
    await rebuildProjectEntityRegistry({
      projectId: project._id
    });
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
  emitToScriptRoom(
    script.publicId,
    'outline:changed',
    createOutlineChangedPayload({
      projectPublicId: project.publicId,
      scriptPublicId: script.publicId,
      actor,
      op: 'deleted',
      deletedNodeId: deletedNode.publicId,
      renumberedNodeIds,
      context: outlineContext
    })
  );

  return {
    deletedNodeId: deletedNode.publicId
  };
};

export const renumberScriptOutline = async ({
  project,
  script,
  actor,
  reason = 'scene_number_mode_changed'
}) => {
  let outlineContext = null;
  let renumberedNodeIds = [];

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const context = await loadOutlineContext({
        scriptId: script._id,
        session
      });
      const numberingResult = await synchronizeSceneNumbering({
        script,
        session,
        context
      });

      outlineContext = numberingResult.outlineContext;
      renumberedNodeIds = numberingResult.renumberedNodeIds;
      await touchScript({
        script,
        actor,
        session
      });
    });
  } finally {
    await session.endSession();
  }

  if (renumberedNodeIds.length) {
    emitToScriptRoom(
      script.publicId,
      'outline:changed',
      createOutlineChangedPayload({
        projectPublicId: project.publicId,
        scriptPublicId: script.publicId,
        actor,
        op: 'renumbered',
        renumberedNodeIds,
        context: outlineContext
      })
    );
  }

  return {
    reason,
    renumberedNodeIds
  };
};

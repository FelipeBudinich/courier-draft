import { badRequest } from '../../config/errors.js';

const idString = (value) => (value ? String(value) : null);

export const getAllowedChildTypes = (parentType = null) => {
  switch (parentType) {
    case null:
      return ['act', 'beat', 'scene'];
    case 'act':
      return ['beat', 'scene'];
    case 'beat':
      return ['scene'];
    default:
      return [];
  }
};

export const validatePlacementParent = ({ type, parentNode = null }) => {
  const allowed = getAllowedChildTypes(parentNode?.type ?? null);

  if (!allowed.includes(type)) {
    throw badRequest(`A ${type} node cannot be placed inside ${parentNode?.type ?? 'root'}.`);
  }
};

export const getActForBeat = ({ beatNode, nodesById }) => {
  if (!beatNode) {
    return null;
  }

  if (beatNode.type !== 'beat') {
    throw badRequest('Scene beat links must reference a beat node.');
  }

  if (!beatNode.placementParentId) {
    return null;
  }

  const parentNode = nodesById.get(idString(beatNode.placementParentId));
  if (!parentNode) {
    return null;
  }

  return parentNode.type === 'act' ? parentNode : null;
};

const resolveNodeRef = ({ fieldName, expectedType, nodeId, nodesById }) => {
  if (!nodeId) {
    return null;
  }

  const node = nodesById.get(idString(nodeId));
  if (!node || node.type !== expectedType) {
    throw badRequest(`${fieldName} must reference a ${expectedType} in this script.`);
  }

  return node;
};

export const normalizeSceneSemanticLinks = ({
  actId = null,
  beatId = null,
  nodesById
}) => {
  let actNode = resolveNodeRef({
    fieldName: 'actId',
    expectedType: 'act',
    nodeId: actId,
    nodesById
  });
  const beatNode = resolveNodeRef({
    fieldName: 'beatId',
    expectedType: 'beat',
    nodeId: beatId,
    nodesById
  });

  const inheritedActNode = getActForBeat({ beatNode, nodesById });
  if (inheritedActNode) {
    if (actNode && idString(actNode._id) !== idString(inheritedActNode._id)) {
      throw badRequest('Scene act/beat links must match the act that contains the selected beat.');
    }

    actNode = inheritedActNode;
  }

  return {
    actId: actNode?._id ?? null,
    beatId: beatNode?._id ?? null,
    actNode,
    beatNode
  };
};

export const resolveSceneCreateSemanticLinks = ({
  parentNode = null,
  actId = null,
  beatId = null,
  nodesById
}) => {
  const nextActId =
    actId ?? (parentNode?.type === 'act' ? parentNode._id : null);
  const nextBeatId =
    beatId ?? (parentNode?.type === 'beat' ? parentNode._id : null);

  return normalizeSceneSemanticLinks({
    actId: nextActId,
    beatId: nextBeatId,
    nodesById
  });
};

export const clearDeletedSemanticLinks = ({
  deletedNodeIds,
  deletedActIds,
  deletedBeatIds,
  sceneNodes
}) =>
  sceneNodes.map((node) => {
    let nextActId = node.actId ?? null;
    let nextBeatId = node.beatId ?? null;

    if (nextActId && deletedActIds.has(idString(nextActId))) {
      nextActId = null;
    }

    if (nextBeatId && deletedBeatIds.has(idString(nextBeatId))) {
      nextBeatId = null;
    }

    if (deletedNodeIds.has(idString(node._id))) {
      return null;
    }

    return {
      node,
      actId: nextActId,
      beatId: nextBeatId
    };
  }).filter(Boolean);

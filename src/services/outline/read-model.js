import { getDisplayedSceneNumber } from '../numbering/service.js';
import { getAllowedChildTypes } from './semantics.js';
import { sortByPositionKey } from './position-keys.js';

const idString = (value) => (value ? String(value) : null);

const attachTreeMetadata = ({ nodes, depth = 0, sceneNodes = [] }) => {
  nodes.forEach((node) => {
    node.depth = depth;
    node.canHaveChildren = getAllowedChildTypes(node.type).length > 0;
    node.allowedChildTypes = getAllowedChildTypes(node.type);

    if (node.type === 'scene') {
      sceneNodes.push(node);
    }

    attachTreeMetadata({
      nodes: node.children,
      depth: depth + 1,
      sceneNodes
    });
  });

  return sceneNodes;
};

export const buildOutlineTree = ({
  nodes,
  scenes = [],
  sceneNumberMode = 'auto'
}) => {
  const sortedNodes = sortByPositionKey(nodes);
  const nodePublicIds = new Map(sortedNodes.map((node) => [idString(node._id), node.publicId]));
  const scenePublicIds = new Map(scenes.map((scene) => [idString(scene._id), scene.publicId]));
  const treeNodesById = new Map();

  sortedNodes.forEach((node) => {
    treeNodesById.set(idString(node._id), {
      id: node.publicId,
      type: node.type,
      title: node.title,
      positionKey: node.positionKey,
      placementParentId: nodePublicIds.get(idString(node.placementParentId)) ?? null,
      sceneId: scenePublicIds.get(idString(node.sceneId)) ?? null,
      actId: nodePublicIds.get(idString(node.actId)) ?? null,
      beatId: nodePublicIds.get(idString(node.beatId)) ?? null,
      autoSceneNumber: node.autoSceneNumber ?? null,
      manualSceneNumber: node.manualSceneNumber ?? null,
      displaySceneNumber: getDisplayedSceneNumber({
        sceneNumberMode,
        manualSceneNumber: node.manualSceneNumber,
        autoSceneNumber: node.autoSceneNumber
      }),
      children: []
    });
  });

  const rootNodes = [];
  sortedNodes.forEach((node) => {
    const treeNode = treeNodesById.get(idString(node._id));
    const parentId = idString(node.placementParentId);

    if (!parentId || !treeNodesById.has(parentId)) {
      rootNodes.push(treeNode);
      return;
    }

    treeNodesById.get(parentId).children.push(treeNode);
  });

  const canonicalSceneNodes = attachTreeMetadata({
    nodes: rootNodes
  });

  return {
    nodes: rootNodes,
    canonicalSceneNodes
  };
};

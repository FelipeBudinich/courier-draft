import { badRequest } from '../../config/errors.js';

const dedupe = (items = []) => [...new Set(items.filter(Boolean))];

const flattenOutlineNodes = (nodes, entries = []) => {
  nodes.forEach((node) => {
    entries.push(node);
    flattenOutlineNodes(node.children ?? [], entries);
  });

  return entries;
};

export const resolveExportSelection = ({
  selection,
  outlineNodes,
  canonicalSceneEntries
}) => {
  const allSceneIds = canonicalSceneEntries
    .map((entry) => entry.sceneId)
    .filter(Boolean);

  if (selection.kind === 'full') {
    return {
      kind: 'full',
      selectedActNodeIds: [],
      selectedSceneIds: allSceneIds,
      selectedSceneIdSet: new Set(allSceneIds),
      selectedActCount: 0,
      selectedSceneCount: allSceneIds.length
    };
  }

  const actNodeIds = dedupe(selection.actNodeIds);
  const sceneIds = dedupe(selection.sceneIds);
  const flatOutlineNodes = flattenOutlineNodes(outlineNodes);
  const validActNodeIds = new Set(
    flatOutlineNodes
      .filter((node) => node.type === 'act')
      .map((node) => node.id)
  );
  const validSceneIds = new Set(allSceneIds);
  const invalidActNodeIds = actNodeIds.filter((id) => !validActNodeIds.has(id));
  const invalidSceneIds = sceneIds.filter((id) => !validSceneIds.has(id));

  if (invalidActNodeIds.length || invalidSceneIds.length) {
    throw badRequest('Selected acts or scenes do not belong to this script.', {
      invalidActNodeIds,
      invalidSceneIds
    });
  }

  const selectedSceneIds = [];
  const selectedSceneIdSet = new Set();

  canonicalSceneEntries.forEach((entry) => {
    const included =
      actNodeIds.includes(entry.actNodeId) || sceneIds.includes(entry.sceneId);

    if (!included || selectedSceneIdSet.has(entry.sceneId)) {
      return;
    }

    selectedSceneIds.push(entry.sceneId);
    selectedSceneIdSet.add(entry.sceneId);
  });

  if (!selectedSceneIds.length) {
    throw badRequest('Partial export selection must include at least one scene.');
  }

  return {
    kind: 'partial',
    selectedActNodeIds: actNodeIds,
    selectedSceneIds,
    selectedSceneIdSet,
    selectedActCount: actNodeIds.length,
    selectedSceneCount: selectedSceneIds.length
  };
};


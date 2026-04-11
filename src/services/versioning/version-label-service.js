import { OutlineNode, Scene } from '../../models/index.js';
import { buildOutlineTree } from '../outline/read-model.js';

const idString = (value) => (value ? String(value) : null);

const withSession = (query, session = null) => {
  if (session) {
    query.session(session);
  }

  return query;
};

const buildOrderedIndexMap = (items) =>
  new Map(items.map((item, index) => [item, index + 1]));

export const loadScriptVersionLabelContext = async ({ scriptId, session = null }) => {
  const [nodes, scenes] = await Promise.all([
    withSession(
      OutlineNode.find({ scriptId }).sort({ positionKey: 1 }),
      session
    ),
    withSession(Scene.find({ scriptId }).select('_id publicId'), session)
  ]);
  const outlineTree = buildOutlineTree({
    nodes,
    scenes
  });

  const scenePublicIdByObjectId = new Map(
    scenes.map((scene) => [idString(scene._id), scene.publicId])
  );

  return {
    actIndexByNodeId: buildOrderedIndexMap(
      nodes.filter((node) => node.type === 'act').map((node) => idString(node._id))
    ),
    beatIndexByNodeId: buildOrderedIndexMap(
      nodes.filter((node) => node.type === 'beat').map((node) => idString(node._id))
    ),
    sceneOrderBySceneId: buildOrderedIndexMap(
      outlineTree.canonicalSceneNodes
        .map((node) => node.sceneId)
        .filter(Boolean)
    ),
    sceneNodesBySceneId: new Map(
      outlineTree.canonicalSceneNodes
        .filter((node) => node.sceneId)
        .map((node) => [node.sceneId, node])
    ),
    scenePublicIdByObjectId
  };
};

const formatVersionLabel = ({
  actIndex = 0,
  beatIndex = 0,
  sceneIndex = 0,
  majorSaveSequence
}) => `${actIndex}.${beatIndex}.${sceneIndex}.${majorSaveSequence}`;

const resolveSceneLocation = ({
  context,
  scene = null,
  note = null
}) => {
  const explicitSceneId = scene?.publicId ?? idString(scene?._id) ?? null;
  const noteSceneId =
    note?.sceneId?.publicId ??
    idString(note?.sceneId) ??
    note?.anchor?.sceneId ??
    null;
  const candidateSceneId = explicitSceneId ?? noteSceneId;
  const normalizedSceneId =
    context.scenePublicIdByObjectId.get(candidateSceneId) ?? candidateSceneId;

  if (!normalizedSceneId) {
    return null;
  }

  const sceneNode =
    context.sceneNodesBySceneId.get(normalizedSceneId) ??
    context.sceneNodesBySceneId.get(scene?.publicId ?? null) ??
    null;

  if (!sceneNode) {
    return null;
  }

  return {
    actIndex: context.actIndexByNodeId.get(sceneNode.actId) ?? 0,
    beatIndex: context.beatIndexByNodeId.get(sceneNode.beatId) ?? 0,
    sceneIndex: context.sceneOrderBySceneId.get(sceneNode.sceneId) ?? 0
  };
};

export const buildScriptCheckpointVersionLabel = async ({
  script,
  majorSaveSequence,
  scopeType = 'script',
  scene = null,
  note = null,
  session = null
}) => {
  if (scopeType === 'script') {
    return formatVersionLabel({
      majorSaveSequence
    });
  }

  const context = await loadScriptVersionLabelContext({
    scriptId: script._id,
    session
  });
  const location = resolveSceneLocation({
    context,
    scene,
    note
  });

  if (!location) {
    return formatVersionLabel({
      majorSaveSequence
    });
  }

  return formatVersionLabel({
    ...location,
    majorSaveSequence
  });
};

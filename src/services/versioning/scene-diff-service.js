import { notFound } from '../../config/errors.js';
import {
  loadLatestMajorVersionForDocument,
  loadDocumentVersionForDocument,
  resolveSceneCurrentHeadState
} from './document-snapshot-service.js';
import { buildTextDiffSegments } from './diff-utils.js';

const flattenSceneBlocks = (document, lane = 'main', collected = []) => {
  for (const block of document?.blocks ?? []) {
    if (block.type === 'dual_dialogue') {
      flattenSceneBlocks(
        {
          blocks: block.left ?? []
        },
        'left',
        collected
      );
      flattenSceneBlocks(
        {
          blocks: block.right ?? []
        },
        'right',
        collected
      );
      continue;
    }

    collected.push({
      blockId: block.id ?? `${lane}-${collected.length + 1}`,
      blockType: block.type,
      lane,
      text: block.text ?? ''
    });
  }

  return collected;
};

const serializeCompareSource = ({
  kind,
  version = null
}) => ({
  kind,
  versionId: version?.publicId ?? null,
  versionLabel: version?.versionLabel ?? null,
  snapshotType: version?.snapshotType ?? null
});

const resolveRequestedSource = async ({
  project,
  scene,
  source
}) => {
  if (!source || source.kind === 'currentHead') {
    const currentHeadState = await resolveSceneCurrentHeadState({
      scene,
      flushLive: false
    });

    return {
      meta: serializeCompareSource({
        kind: 'currentHead'
      }),
      contentSnapshot: currentHeadState.contentSnapshot
    };
  }

  if (source.kind !== 'version' || !source.versionId) {
    throw notFound('Scene version not found.');
  }

  const version = await loadDocumentVersionForDocument({
    projectId: project._id,
    docType: 'scene',
    docId: scene._id,
    versionPublicId: source.versionId
  });

  if (!version) {
    throw notFound('Scene version not found.');
  }

  return {
    meta: serializeCompareSource({
      kind: 'version',
      version
    }),
    contentSnapshot: version.contentSnapshot
  };
};

const buildSceneDiffBlocks = ({
  leftSnapshot,
  rightSnapshot
}) => {
  const leftBlocks = flattenSceneBlocks(leftSnapshot);
  const rightBlocks = flattenSceneBlocks(rightSnapshot);
  const rightBlocksById = new Map(rightBlocks.map((block) => [block.blockId, block]));
  const matchedRightIds = new Set();
  const diffBlocks = [];

  for (const leftBlock of leftBlocks) {
    const rightBlock = rightBlocksById.get(leftBlock.blockId) ?? null;

    if (!rightBlock) {
      diffBlocks.push({
        blockId: leftBlock.blockId,
        blockType: leftBlock.blockType,
        lane: leftBlock.lane,
        status: 'deleted',
        segments: [
          {
            kind: 'deleted',
            text: leftBlock.text
          }
        ]
      });
      continue;
    }

    matchedRightIds.add(rightBlock.blockId);
    const segments = buildTextDiffSegments(leftBlock.text, rightBlock.text);
    const unchanged =
      leftBlock.blockType === rightBlock.blockType &&
      leftBlock.text === rightBlock.text &&
      leftBlock.lane === rightBlock.lane;

    diffBlocks.push({
      blockId: rightBlock.blockId,
      blockType: rightBlock.blockType,
      lane: rightBlock.lane,
      status: unchanged ? 'unchanged' : 'modified',
      segments: unchanged
        ? [
            {
              kind: 'unchanged',
              text: rightBlock.text
            }
          ]
        : segments
    });
  }

  for (const rightBlock of rightBlocks) {
    if (matchedRightIds.has(rightBlock.blockId)) {
      continue;
    }

    diffBlocks.push({
      blockId: rightBlock.blockId,
      blockType: rightBlock.blockType,
      lane: rightBlock.lane,
      status: 'added',
      segments: [
        {
          kind: 'added',
          text: rightBlock.text
        }
      ]
    });
  }

  return diffBlocks;
};

export const diffSceneVersions = async ({
  project,
  scene,
  compare = null
}) => {
  if (!compare) {
    const latestMajorVersion = await loadLatestMajorVersionForDocument({
      docType: 'scene',
      document: scene
    });

    if (!latestMajorVersion) {
      return {
        hasMajorVersion: false,
        compare: null,
        blocks: []
      };
    }

    const [left, right] = await Promise.all([
      resolveRequestedSource({
        project,
        scene,
        source: {
          kind: 'version',
          versionId: latestMajorVersion.publicId
        }
      }),
      resolveRequestedSource({
        project,
        scene,
        source: {
          kind: 'currentHead'
        }
      })
    ]);

    return {
      hasMajorVersion: true,
      compare: {
        left: left.meta,
        right: right.meta
      },
      blocks: buildSceneDiffBlocks({
        leftSnapshot: left.contentSnapshot,
        rightSnapshot: right.contentSnapshot
      })
    };
  }

  const [left, right] = await Promise.all([
    resolveRequestedSource({
      project,
      scene,
      source: compare.left
    }),
    resolveRequestedSource({
      project,
      scene,
      source: compare.right
    })
  ]);

  return {
    hasMajorVersion: true,
    compare: {
      left: left.meta,
      right: right.meta
    },
    blocks: buildSceneDiffBlocks({
      leftSnapshot: left.contentSnapshot,
      rightSnapshot: right.contentSnapshot
    })
  };
};

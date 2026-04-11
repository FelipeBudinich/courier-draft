import { notFound } from '../../config/errors.js';
import {
  loadLatestMajorVersionForDocument,
  loadDocumentVersionForDocument,
  resolveNoteCurrentHeadState
} from './document-snapshot-service.js';
import { buildTextDiffSegments } from './diff-utils.js';

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
  note,
  source
}) => {
  if (!source || source.kind === 'currentHead') {
    const currentHeadState = await resolveNoteCurrentHeadState({
      note,
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
    throw notFound('Note version not found.');
  }

  const version = await loadDocumentVersionForDocument({
    projectId: project._id,
    docType: 'note',
    docId: note._id,
    versionPublicId: source.versionId
  });

  if (!version) {
    throw notFound('Note version not found.');
  }

  return {
    meta: serializeCompareSource({
      kind: 'version',
      version
    }),
    contentSnapshot: version.contentSnapshot
  };
};

export const diffNoteVersions = async ({
  project,
  note,
  compare = null
}) => {
  if (!compare) {
    const latestMajorVersion = await loadLatestMajorVersionForDocument({
      docType: 'note',
      document: note
    });

    if (!latestMajorVersion) {
      return {
        hasMajorVersion: false,
        compare: null,
        segments: []
      };
    }

    const [left, right] = await Promise.all([
      resolveRequestedSource({
        project,
        note,
        source: {
          kind: 'version',
          versionId: latestMajorVersion.publicId
        }
      }),
      resolveRequestedSource({
        project,
        note,
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
      segments: buildTextDiffSegments(
        left.contentSnapshot?.text ?? '',
        right.contentSnapshot?.text ?? ''
      )
    };
  }

  const [left, right] = await Promise.all([
    resolveRequestedSource({
      project,
      note,
      source: compare.left
    }),
    resolveRequestedSource({
      project,
      note,
      source: compare.right
    })
  ]);

  return {
    hasMajorVersion: true,
    compare: {
      left: left.meta,
      right: right.meta
    },
    segments: buildTextDiffSegments(
      left.contentSnapshot?.text ?? '',
      right.contentSnapshot?.text ?? ''
    )
  };
};

import { describe, expect, it } from 'vitest';

import {
  hashDocumentSnapshot,
  stableStringifyVersionSnapshot
} from '../../src/services/versioning/content-hash-service.js';

describe('versioning content hash service', () => {
  it('produces stable hashes for semantically identical scene snapshots', () => {
    const first = {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_1',
          type: 'action',
          text: 'Courier crosses the alley.'
        }
      ]
    };
    const second = {
      blocks: [
        {
          text: 'Courier crosses the alley.',
          type: 'action',
          id: 'blk_1'
        }
      ],
      schemaVersion: 1
    };

    expect(
      stableStringifyVersionSnapshot({
        docType: 'scene',
        contentSnapshot: first
      })
    ).toBe(
      stableStringifyVersionSnapshot({
        docType: 'scene',
        contentSnapshot: second
      })
    );
    expect(
      hashDocumentSnapshot({
        docType: 'scene',
        contentSnapshot: first
      })
    ).toBe(
      hashDocumentSnapshot({
        docType: 'scene',
        contentSnapshot: second
      })
    );
  });

  it('normalizes note snapshots into a plain-text hash payload', () => {
    expect(
      stableStringifyVersionSnapshot({
        docType: 'note',
        contentSnapshot: {}
      })
    ).toBe('{"text":""}');
  });
});

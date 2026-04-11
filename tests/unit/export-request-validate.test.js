import { describe, expect, it } from 'vitest';

import { parseExportRequest } from '../../src/services/export/export-request-validate.js';

describe('export request validation', () => {
  it('accepts a full standard export request', () => {
    expect(
      parseExportRequest({
        format: 'standard',
        selection: {
          kind: 'full'
        }
      })
    ).toEqual({
      format: 'standard',
      selection: {
        kind: 'full'
      }
    });
  });

  it('rejects an empty partial selection', () => {
    expect(() =>
      parseExportRequest({
        format: 'mobile_9_16',
        selection: {
          kind: 'partial',
          actNodeIds: [],
          sceneIds: []
        }
      })
    ).toThrow(/Partial exports must include at least one act or scene/);
  });
});


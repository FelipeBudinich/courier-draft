import { describe, expect, it } from 'vitest';

import { buildTextDiffSegments } from '../../src/services/versioning/diff-utils.js';

describe('versioning diff utils', () => {
  it('renders ordered note-friendly segments for insertions', () => {
    expect(buildTextDiffSegments('Courier runs home', 'Courier runs back home')).toEqual([
      {
        kind: 'unchanged',
        text: 'Courier runs'
      },
      {
        kind: 'added',
        text: ' back'
      },
      {
        kind: 'unchanged',
        text: ' home'
      }
    ]);
  });

  it('renders deletions with strikethrough-ready segments', () => {
    expect(buildTextDiffSegments('Courier runs back home', 'Courier runs home')).toEqual([
      {
        kind: 'unchanged',
        text: 'Courier runs'
      },
      {
        kind: 'deleted',
        text: ' back'
      },
      {
        kind: 'unchanged',
        text: ' home'
      }
    ]);
  });
});

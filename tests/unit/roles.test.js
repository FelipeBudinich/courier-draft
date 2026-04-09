import { roleHelpers } from '../../src/middleware/auth.js';

describe('role helpers', () => {
  it('allows owner and editor to edit project content', () => {
    expect(roleHelpers.canEditProjectContent('owner')).toBe(true);
    expect(roleHelpers.canEditProjectContent('editor')).toBe(true);
    expect(roleHelpers.canEditProjectContent('reviewer')).toBe(false);
  });

  it('lets reviewers edit their own note only', () => {
    expect(roleHelpers.canEditNote('reviewer', 'abc', 'abc')).toBe(true);
    expect(roleHelpers.canEditNote('reviewer', 'abc', 'xyz')).toBe(false);
  });
});


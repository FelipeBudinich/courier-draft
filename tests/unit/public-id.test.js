import { generatePublicId } from '../../src/models/plugins/public-id.js';

describe('public id generation', () => {
  it('creates a prefixed identifier', () => {
    const value = generatePublicId('prj');
    expect(value.startsWith('prj_')).toBe(true);
    expect(value.length).toBeGreaterThan(8);
  });
});


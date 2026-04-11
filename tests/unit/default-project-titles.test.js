import {
  DEFAULT_PROJECT_TITLES,
  getNextDefaultProjectTitle
} from '../../src/services/projects/default-project-titles.js';

describe('default project titles', () => {
  it('returns Iliad for the first auto-assigned project title', () => {
    expect(getNextDefaultProjectTitle([])).toBe('Iliad');
  });

  it('returns the next unused base title in order', () => {
    expect(getNextDefaultProjectTitle(['Iliad', 'Odyssey'])).toBe('Aeneid');
  });

  it('skips manually occupied titles', () => {
    expect(getNextDefaultProjectTitle(['Iliad', 'Aeneid'])).toBe('Odyssey');
  });

  it('cycles with numeric suffixes after exhausting the base list', () => {
    expect(getNextDefaultProjectTitle(DEFAULT_PROJECT_TITLES)).toBe('Iliad 2');
    expect(
      getNextDefaultProjectTitle([...DEFAULT_PROJECT_TITLES, 'Iliad 2', 'Odyssey 2'])
    ).toBe('Aeneid 2');
  });

  it('uses exact trimmed matching only', () => {
    expect(getNextDefaultProjectTitle([' Iliad '])).toBe('Odyssey');
    expect(getNextDefaultProjectTitle(['iliad'])).toBe('Iliad');
  });
});

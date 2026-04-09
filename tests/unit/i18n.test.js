import { translate } from '../../src/config/i18n.js';

describe('i18n', () => {
  it('returns translated copy for a supported locale', () => {
    expect(translate('es', 'nav.dashboard')).toBe('Panel');
  });

  it('makes missing translations obvious outside production', () => {
    expect(translate('ja', 'does.not.exist')).toBe('[missing:ja:does.not.exist]');
  });
});


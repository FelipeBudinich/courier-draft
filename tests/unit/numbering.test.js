import { describe, expect, it } from 'vitest';

import {
  applySceneNumbering,
  getDisplayedSceneNumber
} from '../../src/services/numbering/service.js';

const buildSceneNode = ({
  id,
  manualSceneNumber = null,
  autoSceneNumber = null
}) => ({
  _id: id,
  manualSceneNumber,
  autoSceneNumber
});

describe('scene numbering service', () => {
  it('assigns sequential auto numbers and prefers manual overrides for display', () => {
    const result = applySceneNumbering({
      sceneNumberMode: 'auto',
      sceneNodes: [
        buildSceneNode({ id: 'a' }),
        buildSceneNode({ id: 'b', manualSceneNumber: '77' }),
        buildSceneNode({ id: 'c' })
      ]
    });

    expect(result.autoSceneNumbers.get('a')).toBe('1');
    expect(result.autoSceneNumbers.get('b')).toBe('2');
    expect(result.autoSceneNumbers.get('c')).toBe('3');
    expect(result.displayedNumbers.get('b')).toBe('77');
  });

  it('preserves frozen numbers and assigns suffixes to inserted scenes', () => {
    const result = applySceneNumbering({
      sceneNumberMode: 'frozen',
      sceneNodes: [
        buildSceneNode({ id: 'a', autoSceneNumber: '12' }),
        buildSceneNode({ id: 'b' }),
        buildSceneNode({ id: 'c', autoSceneNumber: '13' }),
        buildSceneNode({ id: 'd' })
      ]
    });

    expect(result.autoSceneNumbers.get('a')).toBe('12');
    expect(result.autoSceneNumbers.get('b')).toBe('12A');
    expect(result.autoSceneNumbers.get('c')).toBe('13');
    expect(result.autoSceneNumbers.get('d')).toBe('14');
  });

  it('rejects duplicate manual scene numbers', () => {
    expect(() =>
      applySceneNumbering({
        sceneNumberMode: 'auto',
        sceneNodes: [
          buildSceneNode({ id: 'a', manualSceneNumber: '10A' }),
          buildSceneNode({ id: 'b', manualSceneNumber: '10A' })
        ]
      })
    ).toThrow(/already in use/i);
  });

  it('hides displayed numbers when numbering is off', () => {
    expect(
      getDisplayedSceneNumber({
        sceneNumberMode: 'off',
        manualSceneNumber: '12',
        autoSceneNumber: '3'
      })
    ).toBeNull();
  });
});

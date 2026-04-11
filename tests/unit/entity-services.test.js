import {
  countDialogueLinesForText,
  extractCharactersFromSceneDocument
} from '../../src/services/entities/character-extract.js';
import {
  normalizeEntityAliasList,
  normalizeEntityName
} from '../../src/services/entities/entity-normalize.js';
import {
  extractLocationsFromSceneDocument,
  replaceSluglineLocation,
  splitSluglineParts
} from '../../src/services/entities/location-extract.js';

describe('entity services', () => {
  it('normalizes character names and aliases deterministically', () => {
    expect(normalizeEntityName('character', '  maria  del   sol ')).toEqual({
      display: 'MARIA DEL SOL',
      normalizedKey: 'MARIA DEL SOL'
    });
    expect(normalizeEntityAliasList('location', ['  kitchen  ', 'Kitchen', '']).map(
      (alias) => alias.normalizedKey
    )).toEqual(['KITCHEN']);
  });

  it('extracts characters from standard and dual-dialogue blocks with logical line counts', () => {
    expect(
      extractCharactersFromSceneDocument({
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug',
            type: 'slugline',
            text: 'INT. KITCHEN - DAY'
          },
          {
            id: 'blk_char_1',
            type: 'character',
            text: 'maria'
          },
          {
            id: 'blk_dia_1',
            type: 'dialogue',
            text: 'Line one.\n\nLine two.'
          },
          {
            id: 'blk_dual',
            type: 'dual_dialogue',
            left: [
              {
                id: 'blk_left_char',
                type: 'character',
                text: 'jon'
              },
              {
                id: 'blk_left_dialogue',
                type: 'dialogue',
                text: 'Left one.\nLeft two.'
              }
            ],
            right: [
              {
                id: 'blk_right_char',
                type: 'character',
                text: 'maria'
              },
              {
                id: 'blk_right_dialogue',
                type: 'dialogue',
                text: 'Right one.'
              }
            ]
          }
        ]
      })
    ).toEqual([
      {
        display: 'MARIA',
        normalizedKey: 'MARIA',
        dialogueBlockCount: 2,
        dialogueLineCount: 3
      },
      {
        display: 'JON',
        normalizedKey: 'JON',
        dialogueBlockCount: 1,
        dialogueLineCount: 2
      }
    ]);
  });

  it('counts only non-empty logical dialogue lines', () => {
    expect(countDialogueLinesForText('One\r\n\r\n Two \n   \nThree')).toBe(3);
  });

  it('extracts location candidates from conventional sluglines and can replace only the location segment', () => {
    expect(splitSluglineParts('INT. JOHN\'S CAR - MOVING - NIGHT')).toEqual({
      prefix: 'INT',
      location: 'JOHN\'S CAR - MOVING',
      suffix: 'NIGHT',
      slugline: 'INT. JOHN\'S CAR - MOVING - NIGHT'
    });

    expect(
      extractLocationsFromSceneDocument({
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug_1',
            type: 'slugline',
            text: 'EXT. CITY STREET - NIGHT'
          },
          {
            id: 'blk_slug_2',
            type: 'slugline',
            text: 'INT. KITCHEN - DAY'
          }
        ]
      })
    ).toEqual([
      {
        display: 'CITY STREET',
        normalizedKey: 'CITY STREET'
      },
      {
        display: 'KITCHEN',
        normalizedKey: 'KITCHEN'
      }
    ]);

    expect(
      replaceSluglineLocation('INT. KITCHEN - DAY', 'DINING ROOM')
    ).toBe('INT. DINING ROOM - DAY');
  });

  it('fails gracefully for irregular sluglines instead of crashing', () => {
    expect(splitSluglineParts('LATER THAT EVENING')).toBeNull();
    expect(
      extractLocationsFromSceneDocument({
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug',
            type: 'slugline',
            text: 'LATER THAT EVENING'
          }
        ]
      })
    ).toEqual([]);
  });
});

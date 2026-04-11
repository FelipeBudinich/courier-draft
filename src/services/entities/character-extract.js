import { parseCanonicalSceneDocument } from '../scenes/document-schema.js';

import { normalizeEntityName } from './entity-normalize.js';

const countDialogueLines = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;

const ensureCharacterAggregate = (aggregates, normalizedCharacter) => {
  const existing = aggregates.get(normalizedCharacter.normalizedKey);
  if (existing) {
    return existing;
  }

  const nextValue = {
    ...normalizedCharacter,
    dialogueBlockCount: 0,
    dialogueLineCount: 0
  };
  aggregates.set(normalizedCharacter.normalizedKey, nextValue);
  return nextValue;
};

const extractFromBlockSequence = (blocks, aggregates) => {
  let currentCharacter = null;

  blocks.forEach((block) => {
    if (block.type === 'dual_dialogue') {
      extractFromBlockSequence(block.left, aggregates);
      extractFromBlockSequence(block.right, aggregates);
      currentCharacter = null;
      return;
    }

    if (block.type === 'character') {
      const normalizedCharacter = normalizeEntityName('character', block.text, {
        preserveCase: false
      });

      currentCharacter = normalizedCharacter
        ? ensureCharacterAggregate(aggregates, normalizedCharacter)
        : null;
      return;
    }

    if (block.type === 'parenthetical') {
      return;
    }

    if (block.type === 'dialogue') {
      if (!currentCharacter) {
        return;
      }

      currentCharacter.dialogueBlockCount += 1;
      currentCharacter.dialogueLineCount += countDialogueLines(block.text);
      return;
    }

    currentCharacter = null;
  });
};

export const extractCharactersFromSceneDocument = (document) => {
  const parsedDocument = parseCanonicalSceneDocument(document);
  const aggregates = new Map();

  extractFromBlockSequence(parsedDocument.blocks, aggregates);

  return [...aggregates.values()];
};

export const countDialogueLinesForText = countDialogueLines;

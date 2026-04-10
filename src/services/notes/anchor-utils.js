import { badRequest } from '../../config/errors.js';
import { getSceneHeadDocument } from '../scenes/legacy-document.js';
import { normalizeCanonicalSceneDocument } from '../scenes/document-normalizer.js';

export const NOTE_ANCHOR_CONTEXT_CHARS = 24;

const isTextBlock = (block) => block && typeof block.text === 'string';

const collectTextBlocks = (blocks, collected = []) => {
  for (const block of blocks ?? []) {
    if (isTextBlock(block)) {
      collected.push(block);
      continue;
    }

    if (block?.type === 'dual_dialogue') {
      collectTextBlocks(block.left, collected);
      collectTextBlocks(block.right, collected);
    }
  }

  return collected;
};

export const listSceneTextBlocks = (document) =>
  collectTextBlocks(normalizeCanonicalSceneDocument(document).blocks);

export const findSceneTextBlock = ({ document, blockId }) =>
  listSceneTextBlocks(document).find((block) => block.id === blockId) ?? null;

export const buildAnchorContext = ({
  blockText,
  startOffset,
  endOffset
}) => ({
  contextBefore: blockText.slice(
    Math.max(0, startOffset - NOTE_ANCHOR_CONTEXT_CHARS),
    startOffset
  ),
  contextAfter: blockText.slice(
    endOffset,
    Math.min(blockText.length, endOffset + NOTE_ANCHOR_CONTEXT_CHARS)
  )
});

export const normalizeAnchorInput = ({
  scene,
  anchor
}) => {
  const sceneDocument = getSceneHeadDocument(scene);
  const block = findSceneTextBlock({
    document: sceneDocument,
    blockId: anchor?.blockId
  });

  if (!block) {
    throw badRequest('Anchor block was not found in the current scene draft.');
  }

  const startOffset = Number.parseInt(anchor?.startOffset, 10);
  const endOffset = Number.parseInt(anchor?.endOffset, 10);

  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset < startOffset ||
    endOffset > block.text.length
  ) {
    throw badRequest('Anchor offsets were invalid for the selected block.');
  }

  const selectedText = block.text.slice(startOffset, endOffset);
  if (selectedText !== String(anchor?.selectedText ?? '')) {
    throw badRequest('Anchor selected text did not match the current scene draft.');
  }

  const context = buildAnchorContext({
    blockText: block.text,
    startOffset,
    endOffset
  });

  return {
    sceneId: scene.publicId,
    blockId: block.id,
    startOffset,
    endOffset,
    selectedText,
    contextBefore: context.contextBefore,
    contextAfter: context.contextAfter,
    createdFromSceneHeadRevision: scene.headRevision ?? 0
  };
};

const findAllOccurrences = (text, search) => {
  if (!search) {
    return [];
  }

  const matches = [];
  let startIndex = 0;

  while (startIndex <= text.length) {
    const foundIndex = text.indexOf(search, startIndex);
    if (foundIndex === -1) {
      break;
    }

    matches.push(foundIndex);
    startIndex = foundIndex + 1;
  }

  return matches;
};

const findContextMatches = ({
  text,
  anchorLength,
  contextBefore,
  contextAfter
}) => {
  const matches = [];

  for (let startOffset = 0; startOffset <= text.length - anchorLength; startOffset += 1) {
    const endOffset = startOffset + anchorLength;
    const beforeMatches =
      !contextBefore ||
      text.slice(Math.max(0, startOffset - contextBefore.length), startOffset) ===
        contextBefore;
    const afterMatches =
      !contextAfter ||
      text.slice(endOffset, endOffset + contextAfter.length) === contextAfter;

    if (beforeMatches && afterMatches) {
      matches.push(startOffset);
    }
  }

  return matches;
};

export const remapAnchorToDocument = ({
  anchor,
  document
}) => {
  const block = findSceneTextBlock({
    document,
    blockId: anchor.blockId
  });

  if (!block) {
    return {
      status: 'detached',
      nextAnchor: anchor
    };
  }

  const currentSlice = block.text.slice(anchor.startOffset, anchor.endOffset);
  if (currentSlice === anchor.selectedText) {
    const context = buildAnchorContext({
      blockText: block.text,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset
    });

    return {
      status: 'kept',
      nextAnchor: {
        ...anchor,
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter
      }
    };
  }

  const exactMatches = findAllOccurrences(block.text, anchor.selectedText);
  if (exactMatches.length === 1) {
    const startOffset = exactMatches[0];
    const endOffset = startOffset + anchor.selectedText.length;
    const context = buildAnchorContext({
      blockText: block.text,
      startOffset,
      endOffset
    });

    return {
      status: 'moved',
      nextAnchor: {
        ...anchor,
        startOffset,
        endOffset,
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter
      }
    };
  }

  const anchorLength = anchor.endOffset - anchor.startOffset;
  const contextMatches = findContextMatches({
    text: block.text,
    anchorLength,
    contextBefore: anchor.contextBefore,
    contextAfter: anchor.contextAfter
  });

  if (contextMatches.length === 1) {
    const startOffset = contextMatches[0];
    const endOffset = startOffset + anchorLength;
    const context = buildAnchorContext({
      blockText: block.text,
      startOffset,
      endOffset
    });

    return {
      status: 'moved',
      nextAnchor: {
        ...anchor,
        startOffset,
        endOffset,
        selectedText: block.text.slice(startOffset, endOffset),
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter
      }
    };
  }

  return {
    status: 'detached',
    nextAnchor: anchor
  };
};

import { Fragment } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';

import {
  DEFAULT_BLOCK_TYPE,
  NEXT_BLOCK_TYPE_BY_CONTEXT,
  SCENE_BLOCK_TYPE_ORDER
} from '../../../src/services/scenes/document-constants.js';
import { createDualDialogueNode, createTextBlockNode } from './schema.js';

const getBlockInfoFromSelection = (resolvedPos) => {
  for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
    const node = resolvedPos.node(depth);

    if (node.type.name === 'screenplay_block') {
      return {
        depth,
        node,
        pos: resolvedPos.before(depth),
        parent: resolvedPos.node(depth - 1)
      };
    }
  }

  return null;
};

const getMappedSelection = (transaction, selection) => ({
  from: transaction.mapping.map(selection.from),
  to: transaction.mapping.map(selection.to)
});

const getCurrentBlockInfo = (state) => {
  const fromBlock = getBlockInfoFromSelection(state.selection.$from);
  const toBlock = getBlockInfoFromSelection(state.selection.$to);

  if (!fromBlock || !toBlock || fromBlock.pos !== toBlock.pos) {
    return null;
  }

  return fromBlock;
};

export const getCurrentBlockType = (state) =>
  getCurrentBlockInfo(state)?.node.attrs.blockType ?? null;

export const setCurrentBlockType = (blockType) => (state, dispatch) => {
  const blockInfo = getCurrentBlockInfo(state);

  if (!blockInfo) {
    return false;
  }

  const transaction = state.tr.setNodeMarkup(blockInfo.pos, undefined, {
    ...blockInfo.node.attrs,
    blockType
  });
  const mappedSelection = getMappedSelection(transaction, state.selection);

  transaction.setSelection(
    TextSelection.create(transaction.doc, mappedSelection.from, mappedSelection.to)
  );
  dispatch?.(transaction.scrollIntoView());

  return true;
};

export const cycleCurrentBlockType = (direction = 1) => (state, dispatch) => {
  const currentType = getCurrentBlockType(state) ?? DEFAULT_BLOCK_TYPE;
  const currentIndex = Math.max(SCENE_BLOCK_TYPE_ORDER.indexOf(currentType), 0);
  const nextIndex =
    (currentIndex + direction + SCENE_BLOCK_TYPE_ORDER.length) %
    SCENE_BLOCK_TYPE_ORDER.length;

  return setCurrentBlockType(SCENE_BLOCK_TYPE_ORDER[nextIndex])(state, dispatch);
};

export const insertContextBlock = () => (state, dispatch) => {
  const blockInfo = getCurrentBlockInfo(state);

  if (!blockInfo) {
    return false;
  }

  const blockStart = blockInfo.pos + 1;
  const blockEnd = blockInfo.pos + blockInfo.node.nodeSize - 1;

  if (state.selection.from < blockStart || state.selection.to > blockEnd) {
    return false;
  }

  const currentText = state.doc.textBetween(
    blockStart,
    state.selection.from,
    '\n',
    '\n'
  );
  const nextText = state.doc.textBetween(
    state.selection.to,
    blockEnd,
    '\n',
    '\n'
  );
  const currentType = blockInfo.node.attrs.blockType ?? DEFAULT_BLOCK_TYPE;
  const nextType = NEXT_BLOCK_TYPE_BY_CONTEXT[currentType] ?? DEFAULT_BLOCK_TYPE;
  const replacementNodes = Fragment.fromArray([
    createTextBlockNode({
      blockId: blockInfo.node.attrs.blockId,
      blockType: currentType,
      text: currentText
    }),
    createTextBlockNode({
      blockType: nextType,
      text: nextText
    })
  ]);

  let transaction = state.tr.replaceWith(
    blockInfo.pos,
    blockInfo.pos + blockInfo.node.nodeSize,
    replacementNodes
  );
  const nextCursor = Selection.near(
    transaction.doc.resolve(blockInfo.pos + replacementNodes.firstChild.nodeSize + 1),
    1
  );

  transaction = transaction.setSelection(nextCursor).scrollIntoView();
  dispatch?.(transaction);

  return true;
};

export const insertHardBreak = (schema) => (state, dispatch) => {
  const hardBreak = schema.nodes.hard_break.create();
  const transaction = state.tr.replaceSelectionWith(hardBreak).scrollIntoView();

  dispatch?.(transaction);

  return true;
};

export const deleteEmptyBlockBackward = () => (state, dispatch) => {
  if (!state.selection.empty || state.selection.$from.parentOffset !== 0) {
    return false;
  }

  const blockInfo = getCurrentBlockInfo(state);

  if (
    !blockInfo ||
    blockInfo.node.textContent.length > 0 ||
    blockInfo.parent.childCount <= 1
  ) {
    return false;
  }

  let transaction = state.tr.delete(
    blockInfo.pos,
    blockInfo.pos + blockInfo.node.nodeSize
  );
  const nextSelection = Selection.near(
    transaction.doc.resolve(
      Math.max(0, Math.min(blockInfo.pos, transaction.doc.content.size))
    ),
    -1
  );

  transaction = transaction.setSelection(nextSelection).scrollIntoView();
  dispatch?.(transaction);

  return true;
};

export const insertDualDialogue = () => (state, dispatch) => {
  const blockInfo = getCurrentBlockInfo(state);

  if (!blockInfo) {
    return false;
  }

  const insertPos = blockInfo.pos + blockInfo.node.nodeSize;
  let transaction = state.tr.insert(insertPos, createDualDialogueNode());
  const nextSelection = Selection.near(transaction.doc.resolve(insertPos + 1), 1);

  transaction = transaction.setSelection(nextSelection).scrollIntoView();
  dispatch?.(transaction);

  return true;
};

export const createBlockKeyBindings = (schema) => ({
  Tab: cycleCurrentBlockType(1),
  'Shift-Tab': cycleCurrentBlockType(-1),
  Enter: insertContextBlock(),
  'Shift-Enter': insertHardBreak(schema),
  Backspace: deleteEmptyBlockBackward()
});

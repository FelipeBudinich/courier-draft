const NOTE_CONTEXT_CHARS = 24;

const findBlockContext = ($pos) => {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === 'screenplay_block') {
      return {
        node,
        depth,
        start: $pos.start(depth)
      };
    }
  }

  return null;
};

export const buildSelectionAnchor = ({
  view,
  sceneId
}) => {
  const { selection, doc } = view.state;
  if (selection.empty) {
    return null;
  }

  const startBlock = findBlockContext(selection.$from);
  const endBlock = findBlockContext(selection.$to);

  if (
    !startBlock ||
    !endBlock ||
    startBlock.start !== endBlock.start ||
    startBlock.node.attrs.blockId !== endBlock.node.attrs.blockId
  ) {
    return null;
  }

  const blockNode = startBlock.node;
  const blockText = blockNode.textBetween(0, blockNode.content.size, '\n', '\n');
  const relativeFrom = selection.from - startBlock.start;
  const relativeTo = selection.to - startBlock.start;
  const selectedText = blockNode.textBetween(relativeFrom, relativeTo, '\n', '\n');

  if (!selectedText) {
    return null;
  }

  const startOffset = blockNode.textBetween(0, relativeFrom, '\n', '\n').length;
  const endOffset = blockNode.textBetween(0, relativeTo, '\n', '\n').length;

  return {
    sceneId,
    blockId: blockNode.attrs.blockId,
    startOffset,
    endOffset,
    selectedText,
    contextBefore: blockText.slice(
      Math.max(0, startOffset - NOTE_CONTEXT_CHARS),
      startOffset
    ),
    contextAfter: blockText.slice(
      endOffset,
      Math.min(blockText.length, endOffset + NOTE_CONTEXT_CHARS)
    )
  };
};

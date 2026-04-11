export const MORE_MARKER_TEXT = '(MORE)';
export const CONTINUED_SUFFIX = " (CONT'D)";

export const buildContinuedCharacterText = (text) =>
  `${String(text ?? '').trim()}${CONTINUED_SUFFIX}`.trim();

const getNextRemainingBodyItem = ({ items, cursor }) => {
  for (let index = cursor.itemIndex; index < items.length; index += 1) {
    const lineIndex = index === cursor.itemIndex ? cursor.lineIndex : 0;

    if (lineIndex < items[index].lines.length) {
      return {
        item: items[index],
        itemIndex: index,
        lineIndex
      };
    }
  }

  return null;
};

export const countRemainingBodyLines = ({ items, cursor }) => {
  let total = 0;

  for (let index = cursor.itemIndex; index < items.length; index += 1) {
    const lineIndex = index === cursor.itemIndex ? cursor.lineIndex : 0;
    total += Math.max(0, items[index].lines.length - lineIndex);
  }

  return total;
};

export const getDialogueKeepMinimum = ({ items, cursor }) => {
  const current = getNextRemainingBodyItem({ items, cursor });

  if (!current) {
    return 0;
  }

  if (current.item.blockType !== 'parenthetical') {
    return 1;
  }

  const linesRemaining = current.item.lines.length - current.lineIndex;
  const next = getNextRemainingBodyItem({
    items,
    cursor: {
      itemIndex: current.itemIndex + 1,
      lineIndex: 0
    }
  });

  if (next?.item?.blockType === 'dialogue') {
    return linesRemaining + 1;
  }

  return Math.max(1, linesRemaining);
};

export const takeDialogueBodyChunk = ({
  items,
  cursor,
  capacity
}) => {
  const chunk = [];
  const nextCursor = {
    itemIndex: cursor.itemIndex,
    lineIndex: cursor.lineIndex
  };

  while (capacity > chunk.length) {
    const current = getNextRemainingBodyItem({
      items,
      cursor: nextCursor
    });

    if (!current) {
      break;
    }

    const currentItem = current.item;
    const currentLineIndex = current.lineIndex;
    const linesRemaining = currentItem.lines.length - currentLineIndex;
    const next = getNextRemainingBodyItem({
      items,
      cursor: {
        itemIndex: current.itemIndex + 1,
        lineIndex: 0
      }
    });
    const slotsRemaining = capacity - chunk.length;
    const needsDialogueBuddy =
      currentItem.blockType === 'parenthetical' && next?.item?.blockType === 'dialogue';
    const minimumForItem = needsDialogueBuddy ? linesRemaining + 1 : 1;

    if (slotsRemaining < minimumForItem && chunk.length > 0) {
      break;
    }

    const takeCount =
      currentItem.blockType === 'parenthetical' &&
      linesRemaining > slotsRemaining &&
      chunk.length > 0
        ? 0
        : Math.min(linesRemaining, slotsRemaining);

    if (!takeCount) {
      break;
    }

    for (let index = 0; index < takeCount; index += 1) {
      chunk.push({
        blockId: currentItem.blockId,
        blockType: currentItem.blockType,
        text: currentItem.lines[currentLineIndex + index],
        sourceLineIndex: currentLineIndex + index
      });
    }

    nextCursor.itemIndex = current.itemIndex;
    nextCursor.lineIndex = currentLineIndex + takeCount;

    if (nextCursor.lineIndex >= currentItem.lines.length) {
      nextCursor.itemIndex += 1;
      nextCursor.lineIndex = 0;
    }
  }

  if (!chunk.length && capacity > 0) {
    const current = getNextRemainingBodyItem({
      items,
      cursor
    });

    if (current) {
      chunk.push({
        blockId: current.item.blockId,
        blockType: current.item.blockType,
        text: current.item.lines[current.lineIndex],
        sourceLineIndex: current.lineIndex
      });

      nextCursor.itemIndex = current.itemIndex;
      nextCursor.lineIndex = current.lineIndex + 1;

      if (nextCursor.lineIndex >= current.item.lines.length) {
        nextCursor.itemIndex += 1;
        nextCursor.lineIndex = 0;
      }
    }
  }

  return {
    chunk,
    cursor: nextCursor
  };
};


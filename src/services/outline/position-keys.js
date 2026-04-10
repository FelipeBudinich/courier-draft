const KEY_WIDTH = 12;

export const POSITION_KEY_STEP = 1024;

const MAX_POSITION_VALUE = 10 ** KEY_WIDTH - 1;

const parsePositionKey = (value) => {
  if (!value) {
    return null;
  }

  return Number.parseInt(String(value), 10);
};

export const formatPositionKey = (value) =>
  String(Math.max(0, Math.trunc(value))).padStart(KEY_WIDTH, '0');

export const comparePositionKeys = (left, right) =>
  String(left?.positionKey ?? left).localeCompare(String(right?.positionKey ?? right));

export const sortByPositionKey = (nodes) => [...nodes].sort(comparePositionKeys);

export const resolveMidpointPositionKey = ({ previousKey = null, nextKey = null }) => {
  const previousValue = parsePositionKey(previousKey);
  const nextValue = parsePositionKey(nextKey);

  if (previousValue === null && nextValue === null) {
    return formatPositionKey(POSITION_KEY_STEP);
  }

  if (previousValue === null) {
    if (nextValue <= 1) {
      return null;
    }

    return formatPositionKey(Math.floor(nextValue / 2));
  }

  if (nextValue === null) {
    if (previousValue + POSITION_KEY_STEP >= MAX_POSITION_VALUE) {
      return null;
    }

    return formatPositionKey(previousValue + POSITION_KEY_STEP);
  }

  const gap = nextValue - previousValue;
  if (gap <= 1) {
    return null;
  }

  return formatPositionKey(previousValue + Math.floor(gap / 2));
};

export const buildRebalancedPositionKeys = (nodesInOrder) =>
  nodesInOrder.map((node, index) => ({
    ...node,
    positionKey: formatPositionKey((index + 1) * POSITION_KEY_STEP)
  }));

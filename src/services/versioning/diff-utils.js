const coalesceSegments = (segments) => {
  if (!segments.length) {
    return [];
  }

  const merged = [segments[0]];

  for (let index = 1; index < segments.length; index += 1) {
    const current = segments[index];
    const previous = merged.at(-1);

    if (previous.kind === current.kind) {
      previous.text += current.text;
      continue;
    }

    merged.push(current);
  }

  return merged.filter((segment) => segment.text.length > 0);
};

const tokenizeText = (text = '') => {
  if (!text) {
    return [];
  }

  return text.match(/(\s+|[^\s]+)/g) ?? [];
};

export const buildTextDiffSegments = (leftText = '', rightText = '') => {
  const leftTokens = tokenizeText(leftText);
  const rightTokens = tokenizeText(rightText);
  const matrix = Array.from(
    { length: leftTokens.length + 1 },
    () => Array(rightTokens.length + 1).fill(0)
  );

  for (let leftIndex = 1; leftIndex <= leftTokens.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightTokens.length; rightIndex += 1) {
      if (leftTokens[leftIndex - 1] === rightTokens[rightIndex - 1]) {
        matrix[leftIndex][rightIndex] = matrix[leftIndex - 1][rightIndex - 1] + 1;
      } else {
        matrix[leftIndex][rightIndex] = Math.max(
          matrix[leftIndex - 1][rightIndex],
          matrix[leftIndex][rightIndex - 1]
        );
      }
    }
  }

  const segments = [];
  let leftIndex = leftTokens.length;
  let rightIndex = rightTokens.length;

  while (leftIndex > 0 || rightIndex > 0) {
    if (
      leftIndex > 0 &&
      rightIndex > 0 &&
      leftTokens[leftIndex - 1] === rightTokens[rightIndex - 1]
    ) {
      segments.push({
        kind: 'unchanged',
        text: leftTokens[leftIndex - 1]
      });
      leftIndex -= 1;
      rightIndex -= 1;
      continue;
    }

    if (
      rightIndex > 0 &&
      (leftIndex === 0 ||
        matrix[leftIndex][rightIndex - 1] >= matrix[leftIndex - 1][rightIndex])
    ) {
      segments.push({
        kind: 'added',
        text: rightTokens[rightIndex - 1]
      });
      rightIndex -= 1;
      continue;
    }

    segments.push({
      kind: 'deleted',
      text: leftTokens[leftIndex - 1]
    });
    leftIndex -= 1;
  }

  return coalesceSegments(segments.reverse());
};

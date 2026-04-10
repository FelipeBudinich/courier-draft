import { badRequest } from '../../config/errors.js';

const WHOLE_NUMBER_RE = /^\d+$/;
const NUMBER_WITH_SUFFIX_RE = /^(\d+)([A-Z]+)?$/;

const idString = (value) => String(value);

export const normalizeSceneNumberLabel = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  return normalized.length ? normalized : null;
};

const parseSceneNumber = (value) => {
  const normalized = normalizeSceneNumberLabel(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(NUMBER_WITH_SUFFIX_RE);
  if (!match) {
    return null;
  }

  return {
    value: normalized,
    base: Number.parseInt(match[1], 10),
    suffix: match[2] ?? ''
  };
};

const buildAlphabeticSuffix = (index) => {
  let current = index;
  let result = '';

  while (current >= 0) {
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26) - 1;
  }

  return result;
};

const nextAvailableSuffixNumber = ({ base, reserved }) => {
  let index = 0;

  while (true) {
    const candidate = `${base}${buildAlphabeticSuffix(index)}`;
    if (!reserved.has(candidate)) {
      return candidate;
    }

    index += 1;
  }
};

const nextAvailableWholeNumber = ({ startAt = 1, reserved }) => {
  let value = Math.max(1, startAt);

  while (reserved.has(String(value))) {
    value += 1;
  }

  return String(value);
};

export const getDisplayedSceneNumber = ({
  sceneNumberMode,
  manualSceneNumber = null,
  autoSceneNumber = null
}) => {
  if (sceneNumberMode === 'off') {
    return null;
  }

  return normalizeSceneNumberLabel(manualSceneNumber) ?? normalizeSceneNumberLabel(autoSceneNumber);
};

export const assertManualSceneNumbersUnique = (sceneNodes) => {
  const seen = new Map();

  for (const node of sceneNodes) {
    const manualSceneNumber = normalizeSceneNumberLabel(node.manualSceneNumber);
    if (!manualSceneNumber) {
      continue;
    }

    const existing = seen.get(manualSceneNumber);
    if (existing && existing !== idString(node._id ?? node.id)) {
      throw badRequest(`Manual scene number ${manualSceneNumber} is already in use.`);
    }

    seen.set(manualSceneNumber, idString(node._id ?? node.id));
  }
};

export const applySceneNumbering = ({ sceneNumberMode, sceneNodes }) => {
  const normalizedNodes = sceneNodes.map((node) => ({
    ...node,
    id: idString(node._id ?? node.id),
    manualSceneNumber: normalizeSceneNumberLabel(node.manualSceneNumber),
    autoSceneNumber: normalizeSceneNumberLabel(node.autoSceneNumber)
  }));

  assertManualSceneNumbersUnique(normalizedNodes);

  if (sceneNumberMode === 'off') {
    return {
      autoSceneNumbers: new Map(
        normalizedNodes.map((node) => [node.id, node.autoSceneNumber ?? null])
      ),
      displayedNumbers: new Map(normalizedNodes.map((node) => [node.id, null]))
    };
  }

  if (sceneNumberMode === 'auto') {
    const autoSceneNumbers = new Map();
    const displayedNumbers = new Map();
    const reservedDisplayed = new Set();

    normalizedNodes.forEach((node, index) => {
      const autoSceneNumber = String(index + 1);
      autoSceneNumbers.set(node.id, autoSceneNumber);

      const displayedSceneNumber = node.manualSceneNumber ?? autoSceneNumber;
      if (reservedDisplayed.has(displayedSceneNumber)) {
        throw badRequest(`Displayed scene number ${displayedSceneNumber} is already in use.`);
      }

      reservedDisplayed.add(displayedSceneNumber);
      displayedNumbers.set(node.id, displayedSceneNumber);
    });

    return {
      autoSceneNumbers,
      displayedNumbers
    };
  }

  const autoSceneNumbers = new Map();
  const displayedNumbers = new Map();
  const reservedDisplayed = new Set(
    normalizedNodes
      .map((node) => node.manualSceneNumber)
      .filter(Boolean)
  );
  const hasExistingGeneratedNumbers = normalizedNodes.some(
    (node) => !node.manualSceneNumber && node.autoSceneNumber
  );

  if (!hasExistingGeneratedNumbers) {
    let nextWhole = 1;

    for (const node of normalizedNodes) {
      if (node.manualSceneNumber) {
        displayedNumbers.set(node.id, node.manualSceneNumber);
        continue;
      }

      const autoSceneNumber = nextAvailableWholeNumber({
        startAt: nextWhole,
        reserved: reservedDisplayed
      });

      nextWhole = Number.parseInt(autoSceneNumber, 10) + 1;
      autoSceneNumbers.set(node.id, autoSceneNumber);
      displayedNumbers.set(node.id, autoSceneNumber);
      reservedDisplayed.add(autoSceneNumber);
    }

    return {
      autoSceneNumbers,
      displayedNumbers
    };
  }

  for (let index = 0; index < normalizedNodes.length; index += 1) {
    const node = normalizedNodes[index];

    if (node.manualSceneNumber) {
      displayedNumbers.set(node.id, node.manualSceneNumber);
      continue;
    }

    if (node.autoSceneNumber && !reservedDisplayed.has(node.autoSceneNumber)) {
      autoSceneNumbers.set(node.id, node.autoSceneNumber);
      displayedNumbers.set(node.id, node.autoSceneNumber);
      reservedDisplayed.add(node.autoSceneNumber);
      continue;
    }

    const previousValues = normalizedNodes
      .slice(0, index)
      .map(
        (candidate) =>
          candidate.manualSceneNumber ??
          displayedNumbers.get(candidate.id) ??
          candidate.autoSceneNumber
      )
      .filter(Boolean);
    const nextValues = normalizedNodes
      .slice(index + 1)
      .map((candidate) => candidate.manualSceneNumber ?? candidate.autoSceneNumber)
      .filter(Boolean);
    const previousParsedValues = previousValues.map(parseSceneNumber).filter(Boolean);
    const nextParsedValues = nextValues.map(parseSceneNumber).filter(Boolean);
    const previousBase = previousParsedValues.length
      ? previousParsedValues[previousParsedValues.length - 1].base
      : null;
    const nextWhole = nextParsedValues.find((candidate) => WHOLE_NUMBER_RE.test(candidate.value));
    const reservedParsedValues = [...reservedDisplayed]
      .map(parseSceneNumber)
      .filter(Boolean);
    const highestWhole =
      reservedParsedValues.length > 0
        ? Math.max(...reservedParsedValues.map((candidate) => candidate.base))
        : 0;

    let autoSceneNumber = null;
    if (!nextWhole) {
      autoSceneNumber = nextAvailableWholeNumber({
        startAt: highestWhole + 1,
        reserved: reservedDisplayed
      });
    } else if (previousBase === null) {
      autoSceneNumber = nextAvailableSuffixNumber({
        base: nextWhole.base,
        reserved: reservedDisplayed
      });
    } else {
      autoSceneNumber = nextAvailableSuffixNumber({
        base: previousBase,
        reserved: reservedDisplayed
      });
    }

    autoSceneNumbers.set(node.id, autoSceneNumber);
    displayedNumbers.set(node.id, autoSceneNumber);
    reservedDisplayed.add(autoSceneNumber);
  }

  return {
    autoSceneNumbers,
    displayedNumbers
  };
};

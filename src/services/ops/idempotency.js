const inflightActions = new Map();

export const createActionKey = (...parts) =>
  parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map((part) =>
      typeof part === 'string' ? part : JSON.stringify(part)
    )
    .join(':');

export const runSingleFlight = async ({ key, action }) => {
  if (inflightActions.has(key)) {
    return inflightActions.get(key);
  }

  const pending = Promise.resolve()
    .then(action)
    .finally(() => {
      inflightActions.delete(key);
    });

  inflightActions.set(key, pending);
  return pending;
};

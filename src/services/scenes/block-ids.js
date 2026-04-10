const createFallbackRandomString = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const generateBlockId = (prefix = 'blk') => {
  const randomId =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '') ??
    createFallbackRandomString();

  return `${prefix}_${randomId.slice(0, 16)}`;
};

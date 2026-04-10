import { badRequest } from '../../config/errors.js';

// Human-readable username rules for v1:
// - 3 to 30 characters
// - lowercase letters, numbers, and underscores only
// - must start with a letter
// - must end with a letter or number
export const USERNAME_PATTERN = /^(?=.{3,30}$)[a-z][a-z0-9_]*[a-z0-9]$/;

export const normalizeUsername = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const assertValidUsername = (value) => {
  const normalized = normalizeUsername(value);

  if (!normalized) {
    throw badRequest('Username is required.');
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    throw badRequest(
      'Username must be 3-30 characters, start with a letter, and use only lowercase letters, numbers, and underscores.'
    );
  }

  return normalized;
};

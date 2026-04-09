import { randomUUID } from 'node:crypto';

import { badRequest } from '../config/errors.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

const readIncomingToken = (req) =>
  req.get('x-csrf-token') ||
  req.get('csrf-token') ||
  req.body?._csrf ||
  req.query?._csrf;

export const attachCsrfToken = (req, res, next) => {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = randomUUID();
  }

  res.locals.csrfToken = req.session?.csrfToken ?? '';
  res.setHeader('x-csrf-token', res.locals.csrfToken);
  next();
};

export const csrfProtection = (req, _res, next) => {
  if (safeMethods.has(req.method)) {
    return next();
  }

  const expectedToken = req.session?.csrfToken;
  const incomingToken = readIncomingToken(req);

  if (!expectedToken || !incomingToken || expectedToken !== incomingToken) {
    return next(
      badRequest('CSRF token validation failed.', {
        reason: 'missing-or-invalid-token'
      })
    );
  }

  next();
};


import { AppError, toApiError } from '../config/errors.js';
import { env } from '../config/env.js';
import { reportError } from '../config/error-reporter.js';

const normalizeError = (error) => {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.name === 'MongoServerError' && error.code === 11000) {
    return new AppError({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'A unique value already exists.',
      details: error.keyValue
    });
  }

  return new AppError({
    statusCode: 500,
    code: 'SERVER_ERROR',
    message: env.isProduction ? 'An unexpected error occurred.' : error.message,
    details: env.isProduction ? undefined : { stack: error.stack },
    expose: !env.isProduction
  });
};

export const notFoundHandler = (req, _res, next) => {
  next(
    new AppError({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: req.surface === 'fragment'
        ? 'Fragment not found.'
        : 'Page not found.'
    })
  );
};

export const errorHandler = (error, req, res, _next) => {
  const normalized = normalizeError(error);
  const surface =
    req.surface ||
    (req.originalUrl?.startsWith('/api/v1')
      ? 'api'
      : req.originalUrl?.startsWith('/fragments')
        ? 'fragment'
        : 'web');

  if (normalized.statusCode >= 500) {
    reportError(normalized, {
      requestId: req.id,
      path: req.originalUrl,
      method: req.method
    });
  }

  if (surface === 'api') {
    const apiError = toApiError(normalized, req.id);
    return res.status(apiError.statusCode).json(apiError.body);
  }

  if (surface === 'fragment') {
    return res.status(normalized.statusCode).render('pages/fragment-error.njk', {
      title: normalized.code,
      message: normalized.message,
      requestId: req.id
    });
  }

  return res.status(normalized.statusCode).render('pages/error.njk', {
    title: normalized.code,
    message: normalized.message,
    requestId: req.id,
    statusCode: normalized.statusCode
  });
};

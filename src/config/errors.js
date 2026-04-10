export class AppError extends Error {
  constructor({
    statusCode = 500,
    code = 'SERVER_ERROR',
    message = 'Something went wrong.',
    details,
    expose = statusCode < 500
  } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export const badRequest = (message, details) =>
  new AppError({ statusCode: 400, code: 'INVALID_PAYLOAD', message, details });

export const conflict = (message = 'That resource already exists or is already in use.') =>
  new AppError({ statusCode: 409, code: 'CONFLICT', message });

export const staleState = (
  message = 'A newer version of this resource exists.',
  details
) => new AppError({ statusCode: 409, code: 'STALE_STATE', message, details });

export const unauthorized = (message = 'You must sign in to continue.') =>
  new AppError({ statusCode: 401, code: 'AUTH_REQUIRED', message });

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError({ statusCode: 403, code: 'FORBIDDEN', message });

export const onboardingRequired = (
  message = 'Complete your profile before accessing the app.'
) =>
  new AppError({ statusCode: 403, code: 'ONBOARDING_REQUIRED', message });

export const notFound = (message = 'The requested resource was not found.') =>
  new AppError({ statusCode: 404, code: 'NOT_FOUND', message });

export const rateLimited = (message = 'Too many requests. Please try again later.') =>
  new AppError({ statusCode: 429, code: 'RATE_LIMITED', message });

export const notImplemented = (message = 'Not implemented in foundation PR.', details) =>
  new AppError({ statusCode: 501, code: 'NOT_IMPLEMENTED', message, details });

export const toApiError = (error, requestId) => {
  const statusCode = error.statusCode ?? 500;
  const expose = error.expose ?? statusCode < 500;

  return {
    statusCode,
    body: {
      ok: false,
      error: {
        code: error.code ?? 'SERVER_ERROR',
        message: expose ? error.message : 'An unexpected error occurred.',
        ...(expose && error.details ? { details: error.details } : {})
      },
      requestId
    }
  };
};

export const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

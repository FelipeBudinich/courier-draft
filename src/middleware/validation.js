import { ZodError } from 'zod';

import { badRequest } from '../config/errors.js';

export const validate = (schemas = {}) => (req, _res, next) => {
  try {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body);
    }

    if (schemas.params) {
      req.params = schemas.params.parse(req.params);
    }

    if (schemas.query) {
      req.query = schemas.query.parse(req.query);
    }

    next();
  } catch (error) {
    if (error instanceof ZodError) {
      return next(
        badRequest('Request validation failed.', {
          issues: error.issues
        })
      );
    }

    next(error);
  }
};


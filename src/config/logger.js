import pino from 'pino';
import pinoHttp from 'pino-http';

import { env } from './env.js';
import { createRequestId } from './request-id.js';

export const logger = pino({
  level: env.logLevel,
  base: undefined
});

export const createHttpLogger = () =>
  pinoHttp({
    logger,
    genReqId(req, res) {
      const requestId = req.headers['x-request-id'] || createRequestId();
      res.setHeader('x-request-id', requestId);
      return requestId;
    },
    customLogLevel(_req, res, error) {
      if (error || res.statusCode >= 500) {
        return 'error';
      }

      if (res.statusCode >= 400) {
        return 'warn';
      }

      return 'info';
    }
  });


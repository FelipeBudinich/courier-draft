import path from 'node:path';

import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import nunjucks from 'nunjucks';

import { csrfProtection, attachCsrfToken } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import {
  consumeFlash,
  exposeTemplateGlobals,
  loadCurrentUser,
  loadLocale
} from './middleware/request-context.js';
import { enforceOnboarding } from './middleware/auth.js';
import { createHttpLogger } from './config/logger.js';
import { env } from './config/env.js';
import { createSessionMiddleware } from './config/session.js';
import apiRouter from './routes/api/v1/index.js';
import fragmentsRouter from './routes/fragments/index.js';
import opsRouter from './routes/ops.js';
import webRouter from './routes/web/index.js';

export const createApp = ({ sessionStore, disableRateLimit = false } = {}) => {
  const app = express();

  if (env.trustProxy) {
    app.set('trust proxy', 1);
  }

  nunjucks.configure(path.resolve(process.cwd(), 'src/views'), {
    autoescape: true,
    express: app,
    noCache: env.isDevelopment || env.isTest
  });

  const sessionMiddleware = createSessionMiddleware({
    store: sessionStore
  });

  app.use(createHttpLogger());
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );

  if (!disableRateLimit) {
    app.use(
      rateLimit({
        windowMs: env.rateLimitWindowMs,
        max: env.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.path === '/healthz' || req.path === '/readyz'
      })
    );
  }

  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(sessionMiddleware);
  app.use(loadCurrentUser);
  app.use(loadLocale);
  app.use(consumeFlash);
  app.use(exposeTemplateGlobals);
  app.use(attachCsrfToken);
  app.use(csrfProtection);

  app.use(opsRouter);
  app.use(enforceOnboarding);
  app.use('/fragments', fragmentsRouter);
  app.use('/api/v1', apiRouter);
  app.use(webRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    sessionMiddleware
  };
};

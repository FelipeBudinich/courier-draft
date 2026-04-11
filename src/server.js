import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createApp } from './app.js';
import { connectToMongo, getMongoClient } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createMongoSessionStore } from './config/session.js';
import { createRealtimeServer } from './sockets/index.js';
import { logRuntimeReadiness } from './services/ops/runtime-readiness.js';

export const startServer = async ({ port = env.port } = {}) => {
  await connectToMongo();
  logRuntimeReadiness({
    logger
  });

  const sessionStore = createMongoSessionStore({
    client: getMongoClient()
  });

  const { app, sessionMiddleware } = createApp({
    sessionStore
  });

  const httpServer = createServer(app);
  const io = createRealtimeServer({
    httpServer,
    sessionMiddleware
  });

  await new Promise((resolve) => {
    httpServer.listen(port, () => {
      logger.info({ port }, 'Courier Draft server listening');
      resolve();
    });
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down Courier Draft');
    await new Promise((resolve) => io.close(() => resolve()));
    await new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdown(signal)
        .then(() => process.exit(0))
        .catch((error) => {
          logger.error({ err: error, signal }, 'Shutdown failed');
          process.exit(1);
        });
    });
  }

  return {
    app,
    io,
    httpServer,
    shutdown
  };
};

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  startServer().catch((error) => {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  });

  process.on('unhandledRejection', (error) => {
    logger.error({ err: error }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
}

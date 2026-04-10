import { createServer } from 'node:http';

import session from 'express-session';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import supertest from 'supertest';

import { createApp } from '../../src/app.js';
import { connectToMongo, disconnectFromMongo } from '../../src/config/db.js';
import { seedFixtures, seedDevelopmentData } from '../../src/models/seed.js';
import { createRealtimeServer } from '../../src/sockets/index.js';
import { presenceStore } from '../../src/sockets/presence-store.js';

export const extractCsrfToken = (html) => {
  const match =
    html.match(/meta name="csrf-token" content="([^"]+)"/) ||
    html.match(/name="_csrf" value="([^"]+)"/);

  return match?.[1] ?? '';
};

export const startTestStack = async ({ seed = true } = {}) => {
  const mongoPort = Math.floor(35_000 + Math.random() * 20_000);
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger'
    },
    instanceOpts: [
      {
        ip: '127.0.0.1',
        port: mongoPort
      }
    ]
  });
  const mongoUri = mongoServer.getUri();
  await connectToMongo(mongoUri);

  if (seed) {
    await seedDevelopmentData();
  }

  const memoryStore = new session.MemoryStore();
  const { app, sessionMiddleware } = createApp({
    sessionStore: memoryStore,
    disableRateLimit: true
  });

  const httpServer = createServer(app);
  const io = createRealtimeServer({
    httpServer,
    sessionMiddleware
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    app,
    io,
    baseUrl,
    mongoUri,
    request: supertest.agent(app),
    close: async () => {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
      presenceStore.clear();
      await disconnectFromMongo();
      await mongoServer.stop();
    }
  };
};

export const loginAsUser = async (agent, email, returnTo = '/app') => {
  const loginPage = await agent.get('/login');
  const csrfToken = loginPage.headers['x-csrf-token'] || extractCsrfToken(loginPage.text);
  const response = await agent
    .post('/auth/dev-login')
    .type('form')
    .send({
      _csrf: csrfToken,
      email,
      returnTo
    });

  return {
    response,
    cookieHeader:
      response.headers['set-cookie']
        ?.map((value) => value.split(';')[0])
        .join('; ') ?? ''
  };
};

export const getPageCsrfToken = async (agent, path = '/app') => {
  const response = await agent.get(path);
  return response.headers['x-csrf-token'] || extractCsrfToken(response.text);
};

export { seedFixtures };

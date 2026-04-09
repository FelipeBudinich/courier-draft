process.env.NODE_ENV = 'test';
process.env.AUTH_BYPASS_ENABLED = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'playwright-secret';
process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:4173';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const { createServer } = await import('node:http');
const session = await import('express-session');
const { MongoMemoryServer } = await import('mongodb-memory-server');
const { createApp } = await import('../src/app.js');
const { connectToMongo, disconnectFromMongo } = await import('../src/config/db.js');
const { seedDevelopmentData } = await import('../src/models/seed.js');
const { createRealtimeServer } = await import('../src/sockets/index.js');
const { presenceStore } = await import('../src/sockets/presence-store.js');

const mongoServer = await MongoMemoryServer.create({
  instance: {
    ip: '127.0.0.1',
    port: 47017
  }
});
await connectToMongo(mongoServer.getUri());
await seedDevelopmentData();

const memoryStore = new session.default.MemoryStore();
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
  httpServer.listen(4173, '127.0.0.1', resolve);
});

const shutdown = async () => {
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
  presenceStore.clear();
  await disconnectFromMongo();
  await mongoServer.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

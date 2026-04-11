process.env.NODE_ENV = 'test';
process.env.AUTH_BYPASS_ENABLED = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'playwright-secret';
process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:4173';
process.env.LOAD_INBOX_SUMMARY_IN_TEST = 'true';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const { createServer } = await import('node:http');
const mongoose = (await import('mongoose')).default;
const session = await import('express-session');
const { MongoMemoryReplSet } = await import('mongodb-memory-server');
const { createApp } = await import('../src/app.js');
const { connectToMongo, disconnectFromMongo } = await import('../src/config/db.js');
const { seedDevelopmentData } = await import('../src/models/seed.js');
const { Project, ProjectMember, User } = await import('../src/models/index.js');
const { sceneSessionManager } = await import('../src/services/collab/scene-session-manager.js');
const { createRealtimeServer } = await import('../src/sockets/index.js');
const { presenceStore } = await import('../src/sockets/presence-store.js');

const mongoServer = await MongoMemoryReplSet.create({
  replSet: {
    count: 1,
    storageEngine: 'wiredTiger'
  },
  instanceOpts: [
    {
      ip: '127.0.0.1',
      port: 47017
    }
  ]
});
await connectToMongo(mongoServer.getUri());

const seedPlaywrightUsers = async () => {
  const owner = await User.findOne({ email: 'owner@courier.test' });
  const project = await Project.findOne({ publicId: 'prj_foundation_demo' });

  const onboardingUser = await User.findOneAndUpdate(
    { email: 'onboard@courier.test' },
    {
      $set: {
        email: 'onboard@courier.test',
        displayName: 'Onboarding User',
        locale: 'en',
        preferences: {
          locale: 'en'
        }
      },
      $unset: {
        username: 1
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const starterProject = await Project.findOneAndUpdate(
    { name: 'Onboarding Starter' },
    {
      $set: {
        name: 'Onboarding Starter',
        ownerId: onboardingUser._id,
        defaultLocale: 'en',
        status: 'active'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await ProjectMember.findOneAndUpdate(
    { projectId: starterProject._id, userId: onboardingUser._id },
    {
      $set: {
        projectId: starterProject._id,
        userId: onboardingUser._id,
        role: 'owner',
        status: 'active',
        invitedById: onboardingUser._id,
        invitedAt: new Date(),
        acceptedAt: new Date(),
        joinedAt: new Date(),
        removedAt: null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  onboardingUser.starterProjectId = starterProject._id;
  await onboardingUser.save();

  const pendingUser = await User.findOneAndUpdate(
    { email: 'pending@courier.test' },
    {
      $set: {
        email: 'pending@courier.test',
        username: 'pendinguser',
        displayName: 'Pending User',
        locale: 'en',
        preferences: {
          locale: 'en'
        }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await ProjectMember.findOneAndUpdate(
    { projectId: project._id, userId: pendingUser._id },
    {
      $set: {
        projectId: project._id,
        userId: pendingUser._id,
        role: 'reviewer',
        status: 'pending',
        invitedById: owner._id,
        invitedAt: new Date(),
        acceptedAt: null,
        joinedAt: null,
        removedAt: null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const resetPlaywrightState = async () => {
  presenceStore.clear();
  sceneSessionManager.clear();
  await mongoose.connection.dropDatabase();
  await seedDevelopmentData();
  await seedPlaywrightUsers();
};

await resetPlaywrightState();

const memoryStore = new session.default.MemoryStore();
const { app, sessionMiddleware } = createApp({
  sessionStore: memoryStore,
  disableRateLimit: true,
  configureApp(expressApp) {
    expressApp.get('/__e2e/reset', async (_req, res) => {
      try {
        await resetPlaywrightState();
        memoryStore.clear(() => {});
        res.status(204).end();
      } catch (error) {
        console.error(error);
        res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : 'Reset failed.'
        });
      }
    });
  }
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
  sceneSessionManager.clear();
  await disconnectFromMongo();
  await mongoServer.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

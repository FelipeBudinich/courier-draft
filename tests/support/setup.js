process.env.NODE_ENV = 'test';
process.env.AUTH_BYPASS_ENABLED = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:4173';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';


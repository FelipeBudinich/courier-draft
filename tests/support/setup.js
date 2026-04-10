process.env.NODE_ENV = 'test';
process.env.AUTH_BYPASS_ENABLED = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:4173';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';
process.env.GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL || 'http://127.0.0.1:4173/auth/google/callback';

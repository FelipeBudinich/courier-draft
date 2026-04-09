const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const defaultPort = parseNumber(process.env.PORT, 3000);
const nodeEnv = process.env.NODE_ENV ?? 'development';
const appBaseUrl = process.env.APP_BASE_URL ?? `http://localhost:${defaultPort}`;

export const env = {
  nodeEnv,
  isDevelopment: nodeEnv === 'development',
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: defaultPort,
  appBaseUrl,
  mongodbUri: process.env.MONGODB_URI ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? 'development-session-secret',
  sessionName: process.env.SESSION_NAME ?? 'courier.sid',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  defaultLocale: process.env.DEFAULT_LOCALE ?? 'en',
  localeCookieName: process.env.LOCALE_COOKIE_NAME ?? 'courier_locale',
  authBypassEnabled:
    parseBoolean(process.env.AUTH_BYPASS_ENABLED, false) || nodeEnv === 'test',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleCallbackUrl:
    process.env.GOOGLE_CALLBACK_URL ?? `${appBaseUrl}/auth/google/callback`,
  rateLimitWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: parseNumber(process.env.RATE_LIMIT_MAX, 300),
  logLevel: process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
  errorReportingDsn: process.env.ERROR_REPORTING_DSN ?? ''
};

export const supportedLocales = ['en', 'es', 'ja'];


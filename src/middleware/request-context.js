import { detectLocale, getAvailableLocales, translate } from '../config/i18n.js';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { hasCompletedOnboarding } from '../services/auth/service.js';
import { getUserInboxSummary } from '../services/inbox/inbox-read-model.js';

export const setSurface = (surface) => (req, _res, next) => {
  req.surface = surface;
  next();
};

export const loadCurrentUser = (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const sessionUserId = req.session?.user?.id;

      if (!sessionUserId) {
        req.currentUser = null;
        res.locals.currentUser = null;
        return;
      }

      const currentUser = await User.findById(sessionUserId);
      if (!currentUser) {
        req.session.user = undefined;
        req.currentUser = null;
        res.locals.currentUser = null;
        return;
      }

      req.currentUser = currentUser;
      res.locals.currentUser = currentUser;
      res.locals.onboardingRequired = !hasCompletedOnboarding(currentUser);
    })
    .then(() => next())
    .catch(next);
};

export const consumeFlash = (req, res, next) => {
  res.locals.flash = req.session?.flash ?? null;

  if (req.session?.flash) {
    delete req.session.flash;
  }

  next();
};

export const loadInboxSummary = (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      if (
        (env.isTest && !env.loadInboxSummaryInTest) ||
        !req.currentUser ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/fragments/') ||
        req.path === '/healthz' ||
        req.path === '/readyz'
      ) {
        res.locals.inboxSummary = null;
        return;
      }

      res.locals.inboxSummary = await getUserInboxSummary({
        user: req.currentUser
      });
    })
    .then(() => next())
    .catch(next);
};

export const setFlash = (req, flash) => {
  if (req.session) {
    req.session.flash = flash;
  }
};

export const loadLocale = (req, res, next) => {
  const locale = detectLocale({
    currentUser: req.currentUser,
    cookies: req.cookies,
    acceptLanguage: req.headers['accept-language']
  });

  req.locale = locale;
  res.locals.locale = locale;
  res.locals.availableLocales = getAvailableLocales();
  res.locals.t = (key, params) => translate(locale, key, params);
  res.locals.formatDate = (value) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  next();
};

export const exposeTemplateGlobals = (req, res, next) => {
  res.locals.appName = 'Courier Draft';
  res.locals.requestId = req.id;
  res.locals.env = env;
  res.locals.pathname = req.path;
  res.locals.now = new Date();
  res.locals.assetPath = (asset) => asset;
  res.locals.defaultLayout = req.currentUser
    ? 'layouts/app.njk'
    : 'layouts/public.njk';
  res.locals.onboardingRequired =
    req.currentUser ? !hasCompletedOnboarding(req.currentUser) : false;
  res.locals.mainContentId = 'main-content';
  next();
};

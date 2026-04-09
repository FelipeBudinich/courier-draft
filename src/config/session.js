import session from 'express-session';
import MongoStore from 'connect-mongo';

import { env } from './env.js';

export const createMongoSessionStore = ({ client }) =>
  MongoStore.create({
    client,
    collectionName: 'sessions',
    ttl: 7 * 24 * 60 * 60
  });

export const createSessionMiddleware = ({ store }) =>
  session({
    name: env.sessionName,
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  });


import mongoose from 'mongoose';

import { env } from './env.js';
import { logger } from './logger.js';

export const connectToMongo = async (mongodbUri = env.mongodbUri) => {
  if (!mongodbUri) {
    throw new Error('MONGODB_URI is required to start the app.');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(mongodbUri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 5000
  });

  logger.info({ mongodbUri: maskMongoUri(mongodbUri) }, 'MongoDB connected');

  return mongoose.connection;
};

export const disconnectFromMongo = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

export const isMongoReady = () => mongoose.connection.readyState === 1;

export const getMongoClient = () => mongoose.connection.getClient();

const maskMongoUri = (mongodbUri) => mongodbUri.replace(/\/\/.*@/, '//***:***@');


import { logger } from './logger.js';

export const reportError = (error, context = {}) => {
  logger.error({ err: error, context }, 'Error reporting stub invoked');
};


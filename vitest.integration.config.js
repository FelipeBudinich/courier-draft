import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      fileParallelism: false,
      hookTimeout: 30_000,
      testTimeout: 30_000
    }
  })
);

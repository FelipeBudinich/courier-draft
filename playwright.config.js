import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run test:e2e:server',
    url: 'http://127.0.0.1:4173/readyz',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI
  }
});


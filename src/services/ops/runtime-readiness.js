import { existsSync } from 'node:fs';

import { chromium } from 'playwright';

import { EXPORT_FONT_STACK } from '../export/layout-profiles.js';

const CACHE_TTL_MS = 30_000;

let cachedReadiness = null;
let cachedAt = 0;

const computeExportRuntimeReadiness = () => {
  const chromiumExecutablePath =
    typeof chromium.executablePath === 'function' ? chromium.executablePath() : '';
  const browserBinaryReady = Boolean(
    chromiumExecutablePath && existsSync(chromiumExecutablePath)
  );
  const japaneseFontConfigured =
    EXPORT_FONT_STACK.includes('Noto Sans JP') ||
    EXPORT_FONT_STACK.includes('Noto Sans CJK JP');

  return {
    ready: browserBinaryReady && japaneseFontConfigured,
    checks: {
      chromium: browserBinaryReady,
      japaneseFontFallbackConfigured: japaneseFontConfigured
    },
    details: {
      chromiumExecutablePath: chromiumExecutablePath || null,
      fontStack: EXPORT_FONT_STACK
    }
  };
};

export const getRuntimeReadiness = ({ force = false } = {}) => {
  const now = Date.now();

  if (!force && cachedReadiness && now - cachedAt < CACHE_TTL_MS) {
    return cachedReadiness;
  }

  cachedReadiness = {
    exportRuntime: computeExportRuntimeReadiness()
  };
  cachedAt = now;
  return cachedReadiness;
};

export const logRuntimeReadiness = ({ logger }) => {
  const readiness = getRuntimeReadiness({
    force: true
  });

  if (!readiness.exportRuntime.ready) {
    logger.warn(
      {
        exportRuntime: readiness.exportRuntime
      },
      'Export runtime readiness check failed'
    );
    return readiness;
  }

  logger.info(
    {
      exportRuntime: readiness.exportRuntime
    },
    'Export runtime readiness check passed'
  );
  return readiness;
};

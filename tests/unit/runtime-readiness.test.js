import { describe, expect, it, vi } from 'vitest';

import {
  getRuntimeReadiness,
  logRuntimeReadiness
} from '../../src/services/ops/runtime-readiness.js';

describe('runtime readiness', () => {
  it('reports export runtime readiness details with the expected shape', () => {
    const readiness = getRuntimeReadiness({
      force: true
    });

    expect(readiness.exportRuntime).toEqual(
      expect.objectContaining({
        ready: expect.any(Boolean),
        checks: expect.objectContaining({
          chromium: expect.any(Boolean),
          japaneseFontFallbackConfigured: true
        }),
        details: expect.objectContaining({
          fontStack: expect.stringContaining('Noto Sans JP')
        })
      })
    );
  });

  it('logs readiness with the matching severity for the current environment', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn()
    };

    const readiness = logRuntimeReadiness({ logger });

    if (readiness.exportRuntime.ready) {
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    } else {
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.info).not.toHaveBeenCalled();
    }
  });
});

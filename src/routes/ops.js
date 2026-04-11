import { Router } from 'express';

import { isMongoReady } from '../config/db.js';
import { getRuntimeReadiness } from '../services/ops/runtime-readiness.js';

const router = Router();

router.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    status: 'ok'
  });
});

router.get('/readyz', (_req, res) => {
  const runtime = getRuntimeReadiness();
  const ready = isMongoReady() && runtime.exportRuntime.ready;
  const statusCode = ready ? 200 : 503;

  res.status(statusCode).json({
    ok: ready,
    status: ready ? 'ready' : 'degraded',
    checks: {
      mongo: isMongoReady(),
      exportRuntime: runtime.exportRuntime.ready
    },
    details: runtime
  });
});

export default router;

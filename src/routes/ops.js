import { Router } from 'express';

import { isMongoReady } from '../config/db.js';

const router = Router();

router.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    status: 'ok'
  });
});

router.get('/readyz', (_req, res) => {
  const ready = isMongoReady();
  const statusCode = ready ? 200 : 503;

  res.status(statusCode).json({
    ok: ready,
    status: ready ? 'ready' : 'degraded',
    checks: {
      mongo: ready
    }
  });
});

export default router;


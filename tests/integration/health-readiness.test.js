import { connectToMongo, disconnectFromMongo } from '../../src/config/db.js';
import { startTestStack } from '../support/helpers.js';

describe('health and readiness routes', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('reports healthy and ready when Mongo is connected', async () => {
    const healthResponse = await stack.request.get('/healthz');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.ok).toBe(true);

    const readyResponse = await stack.request.get('/readyz');
    expect(readyResponse.status).toBe(200);
    expect(readyResponse.body.checks.mongo).toBe(true);
  });

  it('fails readiness when Mongo disconnects', async () => {
    await disconnectFromMongo();

    const readyResponse = await stack.request.get('/readyz');
    expect(readyResponse.status).toBe(503);
    expect(readyResponse.body.ok).toBe(false);

    await connectToMongo(stack.mongoUri);
  });
});

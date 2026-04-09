import { seedFixtures, getPageCsrfToken, loginAsUser, startTestStack } from '../support/helpers.js';

describe('auth, locale, and csrf behavior', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('redirects unauthenticated SSR requests and returns 401 for API requests', async () => {
    const pageResponse = await stack.request.get('/app');
    expect(pageResponse.status).toBe(302);
    expect(pageResponse.headers.location).toContain('/login');

    const apiResponse = await stack.request.get('/api/v1/me');
    expect(apiResponse.status).toBe(401);
    expect(apiResponse.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('switches locale for anonymous requests with a cookie', async () => {
    const loginPage = await stack.request.get('/login');
    const csrfToken = loginPage.headers['x-csrf-token'];

    const response = await stack.request
      .post('/locale')
      .type('form')
      .send({
        _csrf: csrfToken,
        locale: 'es',
        returnTo: '/login'
      })
      .redirects(1);

    expect(response.text).toContain('Entra a Courier Draft');
  });

  it('persists locale through the preferences API', async () => {
    await loginAsUser(stack.request, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(stack.request, '/settings/preferences');

    const patchResponse = await stack.request
      .patch('/api/v1/me/preferences')
      .set('X-CSRF-Token', csrfToken)
      .send({
        locale: 'ja'
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.data.user.locale).toBe('ja');

    const meResponse = await stack.request.get('/api/v1/me');
    expect(meResponse.body.data.user.locale).toBe('ja');
  });

  it('rejects missing csrf tokens on mutating API requests', async () => {
    await loginAsUser(stack.request, seedFixtures.users.editor.email);

    const response = await stack.request.patch('/api/v1/me').send({
      displayName: 'Blocked Without Token'
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PAYLOAD');
  });
});

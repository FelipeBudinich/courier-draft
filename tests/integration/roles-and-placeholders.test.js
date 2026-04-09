import { getPageCsrfToken, loginAsUser, seedFixtures, startTestStack } from '../support/helpers.js';

describe('role middleware and placeholder APIs', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('blocks reviewer access to owner/editor SSR surfaces', async () => {
    await loginAsUser(stack.request, seedFixtures.users.reviewer.email);

    const auditResponse = await stack.request.get(
      `/projects/${seedFixtures.project.publicId}/audit`
    );
    expect(auditResponse.status).toBe(403);

    const newScriptResponse = await stack.request.get(
      `/projects/${seedFixtures.project.publicId}/scripts/new`
    );
    expect(newScriptResponse.status).toBe(403);
  });

  it('allows editors onto editor-plus SSR surfaces', async () => {
    await loginAsUser(stack.request, seedFixtures.users.editor.email);

    const response = await stack.request.get(
      `/projects/${seedFixtures.project.publicId}/scripts/new`
    );

    expect(response.status).toBe(200);
    expect(response.text).toContain('Scaffold de creación de guion');
  });

  it('enforces reviewer own-note permissions before hitting placeholder handlers', async () => {
    await loginAsUser(stack.request, seedFixtures.users.reviewer.email);
    const csrfToken = await getPageCsrfToken(stack.request, '/app');

    const ownNoteResponse = await stack.request
      .patch(
        `/api/v1/projects/${seedFixtures.project.publicId}/notes/${seedFixtures.notes.reviewer.publicId}`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        body: 'still placeholder'
      });

    expect(ownNoteResponse.status).toBe(501);
    expect(ownNoteResponse.body.error.code).toBe('NOT_IMPLEMENTED');

    const otherNoteResponse = await stack.request
      .patch(
        `/api/v1/projects/${seedFixtures.project.publicId}/notes/${seedFixtures.notes.owner.publicId}`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        body: 'should fail first'
      });

    expect(otherNoteResponse.status).toBe(403);
    expect(otherNoteResponse.body.error.code).toBe('FORBIDDEN');
  });

  it('returns a standard 501 envelope for scaffolded API endpoints', async () => {
    await loginAsUser(stack.request, seedFixtures.users.owner.email);

    const response = await stack.request.get(
      `/api/v1/projects/${seedFixtures.project.publicId}`
    );

    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(response.body.error.details.route).toBe('/projects/:projectId');
  });
});

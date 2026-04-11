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
    expect(response.text).toContain('Crear un guion');
  });

  it('enforces reviewer own-note permissions for real note head saves', async () => {
    await loginAsUser(stack.request, seedFixtures.users.reviewer.email);
    const csrfToken = await getPageCsrfToken(stack.request, '/app');

    const ownNoteResponse = await stack.request
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/notes/${seedFixtures.notes.reviewer.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 1,
        text: 'Reviewer can save their own note head.'
      });

    expect(ownNoteResponse.status).toBe(200);
    expect(ownNoteResponse.body.data.headRevision).toBe(2);
    expect(ownNoteResponse.body.data.headText).toBe('Reviewer can save their own note head.');

    const otherNoteResponse = await stack.request
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/notes/${seedFixtures.notes.owner.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 1,
        text: 'should fail first'
      });

    expect(otherNoteResponse.status).toBe(403);
    expect(otherNoteResponse.body.error.code).toBe('FORBIDDEN');
  });

  it('returns a real scene bootstrap response and a real scene version list', async () => {
    await loginAsUser(stack.request, seedFixtures.users.owner.email);

    const bootstrapResponse = await stack.request.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}`
    );

    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.body.data.scene.publicId).toBe(
      seedFixtures.scenes.intro.publicId
    );

    const versionsResponse = await stack.request.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/versions`
    );

    expect(versionsResponse.status).toBe(200);
    expect(Array.isArray(versionsResponse.body.data.versions)).toBe(true);
    expect(versionsResponse.body.data.versions[0].id).toBe('ver_scene_intro_demo');
  });
});

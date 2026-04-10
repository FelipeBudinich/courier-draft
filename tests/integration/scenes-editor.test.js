import supertest from 'supertest';

import { ActivityEvent, AuditLog, Scene } from '../../src/models/index.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

const createScriptViaApi = async (agent, csrfToken, title) => {
  const response = await agent
    .post(`/api/v1/projects/${seedFixtures.project.publicId}/scripts`)
    .set('X-CSRF-Token', csrfToken)
    .send({
      title,
      description: '',
      genre: '',
      status: 'draft',
      language: 'en',
      authors: []
    });

  return response.body.data.script.id;
};

const createSceneNodeViaApi = async ({ agent, csrfToken, scriptId, title }) =>
  agent
    .post(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline/nodes`)
    .set('X-CSRF-Token', csrfToken)
    .send({
      type: 'scene',
      title
    });

describe('scene editor routes and persistence', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('loads the first scene by default and renders reviewer access as read-only', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);

    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);

    const ownerResponse = await ownerAgent.get(
      `/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/editor`
    );

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.text).toContain('data-editor-page');
    expect(ownerResponse.text).toContain(seedFixtures.scenes.intro.publicId);
    expect(ownerResponse.text).toContain('data-save-state="saved"');

    const reviewerResponse = await reviewerAgent.get(
      `/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/editor`
    );

    expect(reviewerResponse.status).toBe(200);
    expect(reviewerResponse.text).toContain('data-save-state="readOnly"');
    expect(reviewerResponse.text).toContain('data-block-type-select');
    expect(reviewerResponse.text).toContain('disabled');
  });

  it('returns 404 for an invalid editor sceneId and shows an empty state when a script has no scenes', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const scriptId = await createScriptViaApi(ownerAgent, csrfToken, 'No Scenes Yet');

    const invalidSceneResponse = await ownerAgent.get(
      `/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/editor?sceneId=scn_missing`
    );
    expect(invalidSceneResponse.status).toBe(404);

    const emptyEditorResponse = await ownerAgent.get(
      `/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/editor`
    );

    expect(emptyEditorResponse.status).toBe(200);
    expect(emptyEditorResponse.text).toContain('This script does not have any scenes yet.');
    expect(emptyEditorResponse.text).not.toContain('data-editor-page');
  });

  it('returns scene bootstrap data with a canonical document and revision', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);

    const response = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}`
    );

    expect(response.status).toBe(200);
    expect(response.body.data.scene.publicId).toBe(seedFixtures.scenes.intro.publicId);
    expect(response.body.data.scene.headRevision).toBe(0);
    expect(response.body.data.document.schemaVersion).toBe(1);
    expect(response.body.data.document.blocks[0].type).toBe('action');
    expect(response.body.data.document.blocks[0].text).toBe(
      'A team of writers gathers around a whiteboard.'
    );
  });

  it('persists a valid head document, normalizes uppercase blocks, and avoids activity/audit spam', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const activityCountBefore = await ActivityEvent.countDocuments();
    const auditCountBefore = await AuditLog.countDocuments();

    const response = await ownerAgent
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 0,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'blk_slug',
              type: 'slugline',
              text: 'int. kitchen - day'
            },
            {
              id: 'blk_character',
              type: 'character',
              text: 'maria'
            },
            {
              id: 'blk_dialogue',
              type: 'dialogue',
              text: 'Ready.'
            }
          ]
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.data.headRevision).toBe(1);
    expect(response.body.data.document.blocks[0].text).toBe('INT. KITCHEN - DAY');
    expect(response.body.data.document.blocks[1].text).toBe('MARIA');
    expect(response.body.data.derived.cachedSlugline).toBe('INT. KITCHEN - DAY');

    const savedScene = await Scene.findOne({
      publicId: seedFixtures.scenes.intro.publicId
    });

    expect(savedScene.headRevision).toBe(1);
    expect(savedScene.headDocument.blocks[0].text).toBe('INT. KITCHEN - DAY');
    expect(savedScene.updatedByUserId).toBeTruthy();
    expect(await ActivityEvent.countDocuments()).toBe(activityCountBefore);
    expect(await AuditLog.countDocuments()).toBe(auditCountBefore);
  });

  it('rejects malformed documents, duplicate ids, unsupported block types, and stale revisions', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const scriptId = await createScriptViaApi(ownerAgent, csrfToken, 'Validation Script');
    const sceneCreateResponse = await createSceneNodeViaApi({
      agent: ownerAgent,
      csrfToken,
      scriptId,
      title: 'Validation Scene'
    });

    expect(sceneCreateResponse.status).toBe(201);

    const createdScene = await Scene.findOne({
      title: 'Validation Scene'
    }).sort({ createdAt: -1 });

    const malformedResponse = await ownerAgent
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/scenes/${createdScene.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 0,
        document: {
          schemaVersion: 1
        }
      });

    expect(malformedResponse.status).toBe(400);
    expect(malformedResponse.body.error.code).toBe('INVALID_PAYLOAD');

    const duplicateIdResponse = await ownerAgent
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/scenes/${createdScene.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 0,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'blk_dup',
              type: 'action',
              text: 'First'
            },
            {
              id: 'blk_dup',
              type: 'action',
              text: 'Second'
            }
          ]
        }
      });

    expect(duplicateIdResponse.status).toBe(400);
    expect(duplicateIdResponse.body.error.code).toBe('INVALID_PAYLOAD');

    const unsupportedTypeResponse = await ownerAgent
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/scenes/${createdScene.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 0,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'blk_bad',
              type: 'lyric',
              text: 'Nope'
            }
          ]
        }
      });

    expect(unsupportedTypeResponse.status).toBe(400);
    expect(unsupportedTypeResponse.body.error.code).toBe('INVALID_PAYLOAD');

    const firstSaveResponse = await ownerAgent
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/scenes/${createdScene.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 0,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'blk_1',
              type: 'action',
              text: 'First draft'
            }
          ]
        }
      });

    expect(firstSaveResponse.status).toBe(200);

    const staleResponse = await ownerAgent
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/scenes/${createdScene.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 0,
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'blk_2',
              type: 'action',
              text: 'Stale draft'
            }
          ]
        }
      });

    expect(staleResponse.status).toBe(409);
    expect(staleResponse.body.error.code).toBe('STALE_STATE');
    expect(staleResponse.body.error.details.headRevision).toBe(1);
  });

  it('blocks reviewer draft saves', async () => {
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const csrfToken = await getPageCsrfToken(reviewerAgent, '/app');

    const response = await reviewerAgent
      .put(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/head`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 1,
        document: {
          schemaVersion: 1,
          blocks: []
        }
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

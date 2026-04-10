import { io as createClient } from 'socket.io-client';
import supertest from 'supertest';

import { User } from '../../src/models/index.js';
import { getPageCsrfToken, loginAsUser, seedFixtures, startTestStack } from '../support/helpers.js';

const connectSocket = (baseUrl, cookieHeader) =>
  new Promise((resolve, reject) => {
    const socket = createClient(`${baseUrl}/collab`, {
      extraHeaders: cookieHeader
        ? {
            Cookie: cookieHeader
          }
        : undefined,
      transports: ['websocket']
    });

    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });

const createScript = async (agent, csrfToken, title) => {
  const response = await agent
    .post(`/api/v1/projects/${seedFixtures.project.publicId}/scripts`)
    .set('X-CSRF-Token', csrfToken)
    .send({
      title,
      description: '',
      genre: '',
      status: 'draft',
      language: '',
      authors: []
    });

  return response.body.data.script.id;
};

describe('script room collaboration events', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('allows members to join script rooms and rejects non-members', async () => {
    const outsider = await User.create({
      email: 'script-outsider@courier.test',
      username: 'scriptoutsider',
      displayName: 'Script Outsider',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const ownerAgent = supertest.agent(stack.app);
    const outsiderAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const outsiderLogin = await loginAsUser(outsiderAgent, outsider.email);
    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);
    const outsiderSocket = await connectSocket(stack.baseUrl, outsiderLogin.cookieHeader);

    await new Promise((resolve, reject) => {
      ownerSocket.emit(
        'script:join',
        {
          projectId: seedFixtures.project.publicId,
          scriptId: seedFixtures.script.publicId
        },
        (ack) => {
          try {
            expect(ack.ok).toBe(true);
            expect(ack.data.sceneNumberMode).toBe('auto');
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      );
    });

    await new Promise((resolve, reject) => {
      outsiderSocket.emit(
        'script:join',
        {
          projectId: seedFixtures.project.publicId,
          scriptId: seedFixtures.script.publicId
        },
        (ack) => {
          try {
            expect(ack.ok).toBe(false);
            expect(ack.error.code).toBe('FORBIDDEN');
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      );
    });

    ownerSocket.close();
    outsiderSocket.close();
  });

  it('broadcasts outline changes and activity:new to script rooms after outline mutations', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const editorAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const editorLogin = await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const scriptId = await createScript(ownerAgent, ownerCsrf, 'Socket Outline Script');

    const editorSocket = await connectSocket(stack.baseUrl, editorLogin.cookieHeader);
    await new Promise((resolve, reject) => {
      editorSocket.emit(
        'project:join',
        { projectId: seedFixtures.project.publicId },
        (projectAck) => {
          if (!projectAck?.ok) {
            reject(new Error('project join failed'));
            return;
          }

          editorSocket.emit(
            'script:join',
            {
              projectId: seedFixtures.project.publicId,
              scriptId
            },
            (scriptAck) => {
              if (!scriptAck?.ok) {
                reject(new Error('script join failed'));
                return;
              }

              resolve();
            }
          );
        }
      );
    });

    const outlineChanged = new Promise((resolve) => {
      editorSocket.once('outline:changed', resolve);
    });
    const activityEvent = new Promise((resolve) => {
      editorSocket.once('activity:new', resolve);
    });

    const createNodeResponse = await ownerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline/nodes`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        type: 'scene',
        title: 'Socket Scene'
      });
    expect(createNodeResponse.status).toBe(201);

    const outlinePayload = await outlineChanged;
    expect(outlinePayload.scriptId).toBe(scriptId);
    expect(outlinePayload.op).toBe('created');

    const activityPayload = await activityEvent;
    expect(activityPayload.scriptId).toBe(scriptId);
    expect(activityPayload.type).toBe('outline.node_created');

    editorSocket.close();
  });

  it('broadcasts script:updated to script rooms after metadata updates', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const reviewerLogin = await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const scriptId = await createScript(ownerAgent, ownerCsrf, 'Socket Metadata Script');

    const reviewerSocket = await connectSocket(stack.baseUrl, reviewerLogin.cookieHeader);
    await new Promise((resolve, reject) => {
      reviewerSocket.emit(
        'script:join',
        {
          projectId: seedFixtures.project.publicId,
          scriptId
        },
        (ack) => {
          if (!ack?.ok) {
            reject(new Error('script join failed'));
            return;
          }

          resolve();
        }
      );
    });

    const scriptUpdated = new Promise((resolve) => {
      reviewerSocket.once('script:updated', resolve);
    });

    const updateResponse = await ownerAgent
      .patch(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        title: 'Socket Metadata Script Revised',
        description: '',
        genre: '',
        status: 'draft',
        language: '',
        authors: []
      });
    expect(updateResponse.status).toBe(200);

    const payload = await scriptUpdated;
    expect(payload.scriptId).toBe(scriptId);
    expect(payload.changedFields).toContain('title');

    reviewerSocket.close();
  });
});

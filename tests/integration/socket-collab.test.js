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

describe('collab socket namespace', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('rejects unauthenticated socket connections', async () => {
    await new Promise((resolve) => {
      const socket = createClient(`${stack.baseUrl}/collab`, {
        autoConnect: true,
        transports: ['websocket']
      });

      socket.on('connect_error', (error) => {
        expect(error.message).toBe('AUTH_REQUIRED');
        socket.close();
        resolve();
      });
    });
  });

  it('allows active members to join projects and rejects pending or missing memberships', async () => {
    const pendingUser = await User.create({
      email: 'pending-socket@courier.test',
      username: 'pendingsocket',
      displayName: 'Pending Socket',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const ownerAgent = supertest.agent(stack.app);
    const pendingAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const pendingLogin = await loginAsUser(pendingAgent, pendingUser.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');

    await ownerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/invites`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        userId: pendingUser.publicId,
        role: 'reviewer'
      });

    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);
    const pendingSocket = await connectSocket(stack.baseUrl, pendingLogin.cookieHeader);

    await new Promise((resolve, reject) => {
      ownerSocket.emit(
        'project:join',
        { projectId: seedFixtures.project.publicId },
        (ack) => {
          try {
            expect(ack.ok).toBe(true);
            expect(ack.data.role).toBe('owner');
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      );
    });

    await new Promise((resolve, reject) => {
      pendingSocket.emit(
        'project:join',
        { projectId: seedFixtures.project.publicId },
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
    pendingSocket.close();
  });

  it('emits invite:created to the invited user room', async () => {
    const targetUser = await User.create({
      email: 'invite-socket@courier.test',
      username: 'invitesocket',
      displayName: 'Invite Socket',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const ownerAgent = supertest.agent(stack.app);
    const targetAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const targetLogin = await loginAsUser(targetAgent, targetUser.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const targetSocket = await connectSocket(stack.baseUrl, targetLogin.cookieHeader);

    const inviteCreated = new Promise((resolve) => {
      targetSocket.on('invite:created', resolve);
    });

    const response = await ownerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/invites`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        userId: targetUser.publicId,
        role: 'reviewer'
      });

    expect(response.status).toBe(201);

    const payload = await inviteCreated;
    expect(payload.projectId).toBe(seedFixtures.project.publicId);
    expect(payload.role).toBe('reviewer');
    expect(payload.invitedBy.userId).toBe(seedFixtures.users.owner.publicId);

    targetSocket.close();
  });

  it('emits permission:changed to the affected user room', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const editorAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const editorLogin = await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const editorSocket = await connectSocket(stack.baseUrl, editorLogin.cookieHeader);

    const permissionChanged = new Promise((resolve) => {
      editorSocket.on('permission:changed', resolve);
    });

    const response = await ownerAgent
      .patch(
        `/api/v1/projects/${seedFixtures.project.publicId}/members/${seedFixtures.members.editor}`
      )
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        role: 'reviewer'
      });

    expect(response.status).toBe(200);

    const payload = await permissionChanged;
    expect(payload.projectId).toBe(seedFixtures.project.publicId);
    expect(payload.newRole).toBe('reviewer');

    editorSocket.close();
  });

  it('emits access revocation and removes project access after member removal', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const reviewerLogin = await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const reviewerSocket = await connectSocket(stack.baseUrl, reviewerLogin.cookieHeader);

    await new Promise((resolve, reject) => {
      reviewerSocket.emit(
        'project:join',
        { projectId: seedFixtures.project.publicId },
        (ack) => {
          try {
            expect(ack.ok).toBe(true);
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      );
    });

    const revoked = new Promise((resolve) => {
      reviewerSocket.on('project:access-revoked', resolve);
    });

    const removalResponse = await ownerAgent
      .delete(
        `/api/v1/projects/${seedFixtures.project.publicId}/members/${seedFixtures.members.reviewer}`
      )
      .set('X-CSRF-Token', ownerCsrf);

    expect(removalResponse.status).toBe(200);

    const revokedPayload = await revoked;
    expect(revokedPayload.projectId).toBe(seedFixtures.project.publicId);
    expect(revokedPayload.reason).toBe('member_removed');

    await new Promise((resolve, reject) => {
      reviewerSocket.emit(
        'project:join',
        { projectId: seedFixtures.project.publicId },
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

    reviewerSocket.close();
  });
});

import { io as createClient } from 'socket.io-client';
import supertest from 'supertest';

import { loginAsUser, seedFixtures, startTestStack } from '../support/helpers.js';

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

  it('allows project join success and failure paths', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const { cookieHeader } = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);

    await new Promise((resolve, reject) => {
      const socket = createClient(`${stack.baseUrl}/collab`, {
        extraHeaders: {
          Cookie: cookieHeader
        },
        transports: ['websocket']
      });

      socket.on('connect', () => {
        socket.emit(
          'project:join',
          { projectId: seedFixtures.project.publicId },
          (successAck) => {
            try {
              expect(successAck.ok).toBe(true);
              expect(successAck.data.role).toBe('owner');

              socket.emit('project:join', { projectId: 'prj_missing_demo' }, (failureAck) => {
                expect(failureAck.ok).toBe(false);
                expect(failureAck.error.code).toBe('FORBIDDEN');
                socket.close();
                resolve();
              });
            } catch (error) {
              socket.close();
              reject(error);
            }
          }
        );
      });
    });
  });

  it('returns editable scene access for owner and read-only access for reviewer', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    const owner = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const reviewerLogin = await loginAsUser(
      reviewerAgent,
      seedFixtures.users.reviewer.email
    );

    const runJoin = (cookieHeader) =>
      new Promise((resolve, reject) => {
        const socket = createClient(`${stack.baseUrl}/collab`, {
          extraHeaders: {
            Cookie: cookieHeader
          },
          transports: ['websocket']
        });

        socket.on('connect', () => {
          socket.emit(
            'scene:join',
            {
              projectId: seedFixtures.project.publicId,
              scriptId: seedFixtures.script.publicId,
              sceneId: seedFixtures.scenes.intro.publicId
            },
            (ack) => {
              socket.close();
              ack.ok ? resolve(ack.data) : reject(new Error(JSON.stringify(ack)));
            }
          );
        });

        socket.on('connect_error', reject);
      });

    const ownerJoin = await runJoin(owner.cookieHeader);
    const reviewerJoin = await runJoin(reviewerLogin.cookieHeader);

    expect(ownerJoin.canEdit).toBe(true);
    expect(reviewerJoin.canEdit).toBe(false);
  });

  it('lets reviewers edit their own note but not another user note', async () => {
    const reviewerAgent = supertest.agent(stack.app);
    const { cookieHeader } = await loginAsUser(
      reviewerAgent,
      seedFixtures.users.reviewer.email
    );

    await new Promise((resolve, reject) => {
      const socket = createClient(`${stack.baseUrl}/collab`, {
        extraHeaders: {
          Cookie: cookieHeader
        },
        transports: ['websocket']
      });

      socket.on('connect', () => {
        socket.emit(
          'note:join',
          {
            projectId: seedFixtures.project.publicId,
            noteId: seedFixtures.notes.reviewer.publicId
          },
          (ownAck) => {
            try {
              expect(ownAck.ok).toBe(true);
              expect(ownAck.data.canEdit).toBe(true);

              socket.emit(
                'note:join',
                {
                  projectId: seedFixtures.project.publicId,
                  noteId: seedFixtures.notes.owner.publicId
                },
                (otherAck) => {
                  expect(otherAck.ok).toBe(true);
                  expect(otherAck.data.canEdit).toBe(false);
                  socket.close();
                  resolve();
                }
              );
            } catch (error) {
              socket.close();
              reject(error);
            }
          }
        );
      });
    });
  });
});

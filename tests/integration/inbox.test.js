import supertest from 'supertest';

import { User } from '../../src/models/index.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

describe('inbox and unread state', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('shows pending invites with unread metadata and supports explicit mark-read', async () => {
    const invitee = await User.create({
      email: 'inbox-invitee@courier.test',
      username: 'inboxinvitee',
      displayName: 'Inbox Invitee',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');

    const inviteResponse = await ownerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/invites`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        userId: invitee.publicId,
        role: 'reviewer'
      });

    expect(inviteResponse.status).toBe(201);

    const inviteeAgent = supertest.agent(stack.app);
    await loginAsUser(inviteeAgent, invitee.email);
    const inviteeCsrf = await getPageCsrfToken(inviteeAgent, '/inbox');

    const dashboardBeforeRead = await inviteeAgent.get('/api/v1/projects');
    expect(dashboardBeforeRead.status).toBe(200);
    expect(dashboardBeforeRead.body.data.unreadSummary.total).toBe(1);
    expect(dashboardBeforeRead.body.data.unreadSummary.invites).toBe(1);

    const invitesResponse = await inviteeAgent.get('/api/v1/invites');
    expect(invitesResponse.status).toBe(200);
    expect(invitesResponse.body.data.invites).toHaveLength(1);
    expect(invitesResponse.body.data.invites[0]).toEqual(
      expect.objectContaining({
        read: false,
        occurredAt: expect.any(String)
      })
    );

    const inviteId = invitesResponse.body.data.invites[0].id;
    const markReadResponse = await inviteeAgent
      .post(`/api/v1/inbox/items/${inviteId}/read`)
      .set('X-CSRF-Token', inviteeCsrf)
      .send({});

    expect(markReadResponse.status).toBe(200);
    expect(markReadResponse.body.data.read).toBe(true);

    const invitesAfterRead = await inviteeAgent.get('/api/v1/invites');
    expect(invitesAfterRead.body.data.invites[0].read).toBe(true);

    const dashboardAfterRead = await inviteeAgent.get('/api/v1/projects');
    expect(dashboardAfterRead.body.data.unreadSummary.total).toBe(0);
    expect(dashboardAfterRead.body.data.unreadSummary.invites).toBe(0);
  });

  it('surfaces membership activity in the dashboard and clears unread counts through read-all', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);

    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);

    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const reviewerCsrf = await getPageCsrfToken(reviewerAgent, '/inbox');

    const baselineReadResponse = await reviewerAgent
      .post('/api/v1/inbox/read-all')
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(baselineReadResponse.status).toBe(200);

    const beforeChange = await reviewerAgent.get('/api/v1/projects');
    expect(beforeChange.status).toBe(200);
    expect(beforeChange.body.data.unreadSummary.total).toBe(0);

    const roleChangeResponse = await ownerAgent
      .patch(
        `/api/v1/projects/${seedFixtures.project.publicId}/members/${seedFixtures.members.reviewer}`
      )
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        role: 'editor'
      });

    expect(roleChangeResponse.status).toBe(200);

    const dashboardAfterChange = await reviewerAgent.get('/api/v1/projects');
    expect(dashboardAfterChange.status).toBe(200);
    expect(dashboardAfterChange.body.data.unreadSummary.total).toBeGreaterThanOrEqual(1);
    expect(dashboardAfterChange.body.data.unreadSummary.membership).toBeGreaterThanOrEqual(1);
    expect(
      dashboardAfterChange.body.data.activity.some(
        (item) =>
          item.kind === 'activity' &&
          item.category === 'membership' &&
          item.activity?.type === 'member.role_changed'
      )
    ).toBe(true);

    const activityResponse = await reviewerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/activity?type=membership&page=1`
    );
    expect(activityResponse.status).toBe(200);
    expect(activityResponse.body.data.filter).toBe('membership');
    expect(activityResponse.body.data.pagination.page).toBe(1);
    expect(activityResponse.body.data.pagination.pageSize).toBe(25);
    expect(
      activityResponse.body.data.activity.some(
        (item) => item.type === 'member.role_changed' && item.category === 'membership'
      )
    ).toBe(true);

    const readAllResponse = await reviewerAgent
      .post('/api/v1/inbox/read-all')
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});

    expect(readAllResponse.status).toBe(200);
    expect(readAllResponse.body.data.readAll).toBe(true);
    expect(readAllResponse.body.data.lastReadAllAt).toBeTruthy();

    const dashboardAfterRead = await reviewerAgent.get('/api/v1/projects');
    expect(dashboardAfterRead.status).toBe(200);
    expect(dashboardAfterRead.body.data.unreadSummary.total).toBe(0);
    expect(dashboardAfterRead.body.data.unreadSummary.membership).toBe(0);
  });
});

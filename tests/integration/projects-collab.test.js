import supertest from 'supertest';

import { Project, ProjectMember, User } from '../../src/models/index.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

describe('projects, invites, and collaborator management', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('auto-assigns epic titles for blank project creation and preserves generated ids', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');

    const firstResponse = await ownerAgent
      .post('/api/v1/projects')
      .set('X-CSRF-Token', csrfToken)
      .send({});

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.data.project).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^prj_/),
        title: 'Iliad'
      })
    );

    const secondResponse = await ownerAgent
      .post('/api/v1/projects')
      .set('X-CSRF-Token', csrfToken)
      .send({
        title: ''
      });

    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body.data.project.title).toBe('Odyssey');

    const storedProjects = await Project.find({
      publicId: {
        $in: [firstResponse.body.data.project.id, secondResponse.body.data.project.id]
      }
    }).sort({ createdAt: 1 });

    expect(storedProjects.map((project) => project.name)).toEqual(['Iliad', 'Odyssey']);
  });

  it('preserves explicit project titles when provided', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');

    const response = await ownerAgent
      .post('/api/v1/projects')
      .set('X-CSRF-Token', csrfToken)
      .send({
        title: 'Writer Collaboration Test'
      });

    expect(response.status).toBe(201);
    expect(response.body.data.project.title).toBe('Writer Collaboration Test');
  });

  it('creates projects, searches existing users, sends invites, and blocks duplicates and self-invites', async () => {
    const invitee = await User.create({
      email: 'invite-target@courier.test',
      username: 'invitetarget',
      displayName: 'Invite Target',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');

    const projectResponse = await ownerAgent
      .post('/api/v1/projects')
      .set('X-CSRF-Token', csrfToken)
      .send({
        title: 'Collaboration Invite Project'
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.project.id;

    const searchResponse = await ownerAgent.get(
      `/api/v1/users/search?q=${encodeURIComponent(invitee.email)}`
    );
    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.data.users).toEqual([
      expect.objectContaining({
        id: invitee.publicId,
        email: invitee.email
      })
    ]);

    const inviteResponse = await ownerAgent
      .post(`/api/v1/projects/${projectId}/invites`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        userId: invitee.publicId,
        role: 'reviewer'
      });

    expect(inviteResponse.status).toBe(201);
    expect(inviteResponse.body.data.member.status).toBe('pending');
    expect(inviteResponse.body.data.member.role).toBe('reviewer');

    const duplicateInvite = await ownerAgent
      .post(`/api/v1/projects/${projectId}/invites`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        userId: invitee.publicId,
        role: 'reviewer'
      });

    expect(duplicateInvite.status).toBe(409);
    expect(duplicateInvite.body.error.code).toBe('CONFLICT');

    const selfInvite = await ownerAgent
      .post(`/api/v1/projects/${projectId}/invites`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        userId: seedFixtures.users.owner.publicId,
        role: 'editor'
      });

    expect(selfInvite.status).toBe(403);
    expect(selfInvite.body.error.code).toBe('FORBIDDEN');

    const activityResponse = await ownerAgent.get(`/api/v1/projects/${projectId}/activity`);
    expect(activityResponse.status).toBe(200);
    expect(activityResponse.body.data.activity.map((item) => item.type)).toEqual(
      expect.arrayContaining(['project.created', 'member.invited'])
    );

    const auditResponse = await ownerAgent.get(`/api/v1/projects/${projectId}/audit`);
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.data.audit.map((item) => item.action)).toEqual(
      expect.arrayContaining(['project.created', 'invite.created'])
    );
  });

  it('supports invite accept and decline flows and updates dashboard and inbox reads', async () => {
    const accepter = await User.create({
      email: 'accept-user@courier.test',
      username: 'acceptuser',
      displayName: 'Accept User',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });
    const decliner = await User.create({
      email: 'decline-user@courier.test',
      username: 'declineuser',
      displayName: 'Decline User',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');

    const projectResponse = await ownerAgent
      .post('/api/v1/projects')
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        title: 'Inbox Acceptance Project'
      });
    const projectId = projectResponse.body.data.project.id;

    await ownerAgent
      .post(`/api/v1/projects/${projectId}/invites`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        userId: accepter.publicId,
        role: 'editor'
      });
    await ownerAgent
      .post(`/api/v1/projects/${projectId}/invites`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        userId: decliner.publicId,
        role: 'reviewer'
      });

    const accepterAgent = supertest.agent(stack.app);
    await loginAsUser(accepterAgent, accepter.email);
    const accepterCsrf = await getPageCsrfToken(accepterAgent, '/inbox');

    const accepterInvites = await accepterAgent.get('/api/v1/invites');
    expect(accepterInvites.status).toBe(200);
    expect(accepterInvites.body.data.invites).toHaveLength(1);

    const acceptResponse = await accepterAgent
      .post(`/api/v1/invites/${accepterInvites.body.data.invites[0].id}/accept`)
      .set('X-CSRF-Token', accepterCsrf)
      .send({});

    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body.data.invite.status).toBe('active');

    const accepterProjects = await accepterAgent.get('/api/v1/projects');
    expect(accepterProjects.body.data.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: projectId })])
    );

    const accepterDashboard = await accepterAgent.get('/app');
    expect(accepterDashboard.text).toContain('Inbox Acceptance Project');

    const declinerAgent = supertest.agent(stack.app);
    await loginAsUser(declinerAgent, decliner.email);
    const declinerCsrf = await getPageCsrfToken(declinerAgent, '/inbox');

    const declinerInbox = await declinerAgent.get('/inbox');
    expect(declinerInbox.text).toContain('Inbox Acceptance Project');

    const declinerInvites = await declinerAgent.get('/api/v1/invites');
    const declineResponse = await declinerAgent
      .post(`/api/v1/invites/${declinerInvites.body.data.invites[0].id}/decline`)
      .set('X-CSRF-Token', declinerCsrf)
      .send({});

    expect(declineResponse.status).toBe(200);
    expect(declineResponse.body.data.invite.status).toBe('declined');

    const pendingAfterDecline = await declinerAgent.get('/api/v1/invites');
    expect(pendingAfterDecline.body.data.invites).toHaveLength(0);

    const activityResponse = await ownerAgent.get(`/api/v1/projects/${projectId}/activity`);
    expect(activityResponse.body.data.activity.map((item) => item.type)).toEqual(
      expect.arrayContaining(['invite.accepted', 'invite.declined'])
    );
  });

  it('restricts membership admin to owners, supports role changes, member removal, and ownership transfer', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const editorAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);

    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);

    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const reviewerCsrf = await getPageCsrfToken(
      reviewerAgent,
      `/projects/${seedFixtures.project.publicId}/members`
    );

    const reviewerPatch = await reviewerAgent
      .patch(
        `/api/v1/projects/${seedFixtures.project.publicId}/members/${seedFixtures.members.editor}`
      )
      .set('X-CSRF-Token', reviewerCsrf)
      .send({
        role: 'reviewer'
      });
    expect(reviewerPatch.status).toBe(403);

    const reviewerRemove = await reviewerAgent
      .delete(
        `/api/v1/projects/${seedFixtures.project.publicId}/members/${seedFixtures.members.editor}`
      )
      .set('X-CSRF-Token', reviewerCsrf);
    expect(reviewerRemove.status).toBe(403);

    const reviewerTransfer = await reviewerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/ownership-transfer`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({
        memberId: seedFixtures.members.editor
      });
    expect(reviewerTransfer.status).toBe(403);

    const roleChange = await ownerAgent
      .patch(
        `/api/v1/projects/${seedFixtures.project.publicId}/members/${seedFixtures.members.reviewer}`
      )
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        role: 'editor'
      });

    expect(roleChange.status).toBe(200);
    expect(roleChange.body.data.member.role).toBe('editor');

    const removalResponse = await ownerAgent
      .delete(
        `/api/v1/projects/${seedFixtures.project.publicId}/members/${seedFixtures.members.reviewer}`
      )
      .set('X-CSRF-Token', ownerCsrf);

    expect(removalResponse.status).toBe(200);
    expect(removalResponse.body.data.member.status).toBe('removed');

    const removedProjectAccess = await reviewerAgent.get(
      `/projects/${seedFixtures.project.publicId}`
    );
    expect(removedProjectAccess.status).toBe(404);

    const transferResponse = await ownerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/ownership-transfer`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        memberId: seedFixtures.members.editor
      });

    expect(transferResponse.status).toBe(200);

    const project = await Project.findOne({ publicId: seedFixtures.project.publicId });
    const editorUser = await User.findOne({ publicId: seedFixtures.users.editor.publicId });
    const ownerUser = await User.findOne({ publicId: seedFixtures.users.owner.publicId });
    const oldOwnerMembership = await ProjectMember.findOne({
      projectId: project._id,
      userId: ownerUser._id
    });
    const newOwnerMembership = await ProjectMember.findOne({
      projectId: project._id,
      userId: editorUser._id
    });

    expect(String(project.ownerId)).toBe(String(editorUser._id));
    expect(oldOwnerMembership.role).toBe('editor');
    expect(newOwnerMembership.role).toBe('owner');

    const editorAudit = await editorAgent.get(`/api/v1/projects/${seedFixtures.project.publicId}/audit`);
    expect(editorAudit.status).toBe(200);
    expect(editorAudit.body.data.audit.map((item) => item.action)).toEqual(
      expect.arrayContaining(['member.role_changed', 'member.removed', 'ownership.transferred'])
    );
  });
});

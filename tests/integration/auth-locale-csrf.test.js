import supertest from 'supertest';

import { Project, ProjectMember, User } from '../../src/models/index.js';
import {
  extractCsrfToken,
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

const mockGoogleFlow = ({
  sub = 'google-sub-demo',
  email = 'new-user@courier.test',
  emailVerified = true,
  name = 'New User',
  picture = 'https://example.test/avatar.png',
  locale = 'en'
} = {}) => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-access-token'
      })
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub,
        email,
        email_verified: emailVerified,
        name,
        picture,
        locale
      })
    });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const readGoogleStateFromRedirect = (location) =>
  new URL(location).searchParams.get('state');

describe('auth, onboarding, locale, and csrf behavior', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    const csrfToken = loginPage.headers['x-csrf-token'] || extractCsrfToken(loginPage.text);

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

  it('creates a new user and exactly one starter project through the google callback flow', async () => {
    const firstAgent = supertest.agent(stack.app);
    const authStart = await firstAgent.get('/auth/google?returnTo=/app');
    const firstState = readGoogleStateFromRedirect(authStart.headers.location);
    mockGoogleFlow({
      sub: 'google-new-user',
      email: 'starter-user@courier.test',
      emailVerified: true,
      name: 'Starter User'
    });

    const callbackResponse = await firstAgent.get(
      `/auth/google/callback?code=test-code&state=${firstState}`
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe('/settings/profile?onboarding=1');

    const createdUser = await User.findOne({ email: 'starter-user@courier.test' });
    expect(createdUser).toBeTruthy();
    expect(createdUser.googleSub).toBe('google-new-user');
    expect(createdUser.lastSeenAt).toBeTruthy();
    expect(createdUser.starterProjectId).toBeTruthy();

    const starterProjects = await Project.find({ ownerId: createdUser._id });
    expect(starterProjects).toHaveLength(1);

    const memberships = await ProjectMember.find({
      userId: createdUser._id,
      status: 'active'
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');

    const secondAgent = supertest.agent(stack.app);
    const secondAuthStart = await secondAgent.get('/auth/google?returnTo=/app');
    const secondState = readGoogleStateFromRedirect(secondAuthStart.headers.location);
    mockGoogleFlow({
      sub: 'google-new-user',
      email: 'starter-user@courier.test',
      emailVerified: true,
      name: 'Starter User'
    });

    const secondCallback = await secondAgent.get(
      `/auth/google/callback?code=test-code-2&state=${secondState}`
    );
    expect(secondCallback.status).toBe(302);

    const projectsAfterSecondLogin = await Project.find({ ownerId: createdUser._id });
    expect(projectsAfterSecondLogin).toHaveLength(1);
  });

  it('attaches googleSub to an existing verified-email user without creating a duplicate', async () => {
    const existingUser = await User.create({
      email: 'attached@courier.test',
      username: 'attacheduser',
      displayName: 'Attached User',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const agent = supertest.agent(stack.app);
    const authStart = await agent.get('/auth/google?returnTo=/app');
    const state = readGoogleStateFromRedirect(authStart.headers.location);
    mockGoogleFlow({
      sub: 'google-attached-user',
      email: 'attached@courier.test',
      emailVerified: true,
      name: 'Attached User'
    });

    const callbackResponse = await agent.get(
      `/auth/google/callback?code=attach-code&state=${state}`
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe('/app');

    const updatedUser = await User.findById(existingUser._id);
    expect(updatedUser.googleSub).toBe('google-attached-user');

    const sameEmailUsers = await User.find({ email: 'attached@courier.test' });
    expect(sameEmailUsers).toHaveLength(1);
  });

  it('rejects google callback profiles whose email is not verified', async () => {
    const agent = supertest.agent(stack.app);
    const authStart = await agent.get('/auth/google?returnTo=/app');
    const state = readGoogleStateFromRedirect(authStart.headers.location);
    mockGoogleFlow({
      sub: 'google-unverified-user',
      email: 'unverified@courier.test',
      emailVerified: false,
      name: 'Unverified User'
    });

    const callbackResponse = await agent.get(
      `/auth/google/callback?code=bad-code&state=${state}`
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe('/login');

    const user = await User.findOne({ email: 'unverified@courier.test' });
    expect(user).toBeNull();
  });

  it('enforces onboarding until a username is claimed and returns a redirect to the starter project', async () => {
    const onboardingUser = await User.create({
      email: 'onboarding@courier.test',
      displayName: 'Onboarding User',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const starterProject = await Project.create({
      name: 'Starter Workspace',
      ownerId: onboardingUser._id,
      defaultLocale: 'en',
      status: 'active'
    });

    await ProjectMember.create({
      projectId: starterProject._id,
      userId: onboardingUser._id,
      role: 'owner',
      status: 'active',
      invitedById: onboardingUser._id,
      invitedAt: new Date(),
      acceptedAt: new Date(),
      joinedAt: new Date()
    });

    onboardingUser.starterProjectId = starterProject._id;
    await onboardingUser.save();

    const agent = supertest.agent(stack.app);
    await loginAsUser(agent, onboardingUser.email);

    const appResponse = await agent.get('/app');
    expect(appResponse.status).toBe(302);
    expect(appResponse.headers.location).toBe('/settings/profile?onboarding=1');

    const meResponse = await agent.get('/api/v1/me');
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.user.onboardingRequired).toBe(true);

    const blockedSearch = await agent.get('/api/v1/users/search?q=owner');
    expect(blockedSearch.status).toBe(403);
    expect(blockedSearch.body.error.code).toBe('ONBOARDING_REQUIRED');

    const csrfToken = await getPageCsrfToken(agent, '/settings/profile?onboarding=1');
    const profileResponse = await agent
      .patch('/api/v1/me')
      .set('X-CSRF-Token', csrfToken)
      .send({
        displayName: 'Onboarding User',
        username: 'Onboarding_User'
      });

    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.data.claimedUsername).toBe(true);
    expect(profileResponse.body.data.user.username).toBe('onboarding_user');
    expect(profileResponse.body.data.redirectTo).toBe(
      `/projects/${starterProject.publicId}`
    );

    const unlockedSearch = await agent.get('/api/v1/users/search?q=owner');
    expect(unlockedSearch.status).toBe(200);
  });

  it('persists locale through the preferences API and rejects missing csrf tokens', async () => {
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

    const blockedResponse = await stack.request.patch('/api/v1/me').send({
      displayName: 'Blocked Without Token'
    });

    expect(blockedResponse.status).toBe(400);
    expect(blockedResponse.body.error.code).toBe('INVALID_PAYLOAD');
  });
});

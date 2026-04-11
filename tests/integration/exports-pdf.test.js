import supertest from 'supertest';

import {
  ActivityEvent,
  AuditLog,
  Scene,
  Script,
  ScriptVersion,
  User
} from '../../src/models/index.js';
import { sceneSessionManager } from '../../src/services/collab/scene-session-manager.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

const parseBinaryBody = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

const postPdfExport = async ({
  agent,
  csrfToken,
  projectId = seedFixtures.project.publicId,
  scriptId = seedFixtures.script.publicId,
  payload
}) =>
  agent
    .post(`/api/v1/projects/${projectId}/scripts/${scriptId}/exports/pdf`)
    .set('X-CSRF-Token', csrfToken)
    .buffer(true)
    .parse(parseBinaryBody)
    .send(payload);

describe('PDF export route', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterEach(() => {
    sceneSessionManager.clear();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('allows a member to export a standard PDF and records one activity and one audit entry', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const script = await Script.findOne({
      publicId: seedFixtures.script.publicId
    });
    script.currentVersionLabel = '1.0.0.1';
    await script.save();

    const activityBefore = await ActivityEvent.countDocuments();
    const auditBefore = await AuditLog.countDocuments();
    const versionBefore = await ScriptVersion.countDocuments({
      scriptId: script._id
    });
    const response = await postPdfExport({
      agent: ownerAgent,
      csrfToken,
      payload: {
        format: 'standard',
        selection: {
          kind: 'full'
        }
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('standard.pdf');
    expect(response.headers['content-disposition']).toContain('1.0.0.1');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(await ActivityEvent.countDocuments()).toBe(activityBefore + 1);
    expect(await AuditLog.countDocuments()).toBe(auditBefore + 1);
    expect(
      await ScriptVersion.countDocuments({
        scriptId: script._id
      })
    ).toBe(versionBefore);

    const latestActivity = await ActivityEvent.findOne().sort({ createdAt: -1 });
    const latestAudit = await AuditLog.findOne().sort({ createdAt: -1 });

    expect(latestActivity.type).toBe('script.exported');
    expect(latestAudit.action).toBe('script.exported');
  });

  it('allows a reviewer to export a mobile PDF', async () => {
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const csrfToken = await getPageCsrfToken(reviewerAgent, '/app');
    const response = await postPdfExport({
      agent: reviewerAgent,
      csrfToken,
      payload: {
        format: 'mobile_9_16',
        selection: {
          kind: 'full'
        }
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('mobile.pdf');
    expect(response.body.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(response.body.toString('latin1')).toMatch(
      /MediaBox\s*\[\s*0\s+0\s+445(?:\.\d+)?\s+792(?:\.\d+)?\s*\]/
    );
  });

  it('forbids export for a non-member', async () => {
    await User.findOneAndUpdate(
      {
        email: 'outsider@courier.test'
      },
      {
        $set: {
          email: 'outsider@courier.test',
          username: 'outsider',
          displayName: 'Outside User',
          locale: 'en',
          preferences: {
            locale: 'en'
          }
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    const outsiderAgent = supertest.agent(stack.app);
    await loginAsUser(outsiderAgent, 'outsider@courier.test');
    const csrfToken = await getPageCsrfToken(outsiderAgent, '/app');
    const response = await outsiderAgent
      .post(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/exports/pdf`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        format: 'standard',
        selection: {
          kind: 'full'
        }
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects empty and invalid partial selections', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');

    const emptyResponse = await ownerAgent
      .post(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/exports/pdf`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        format: 'standard',
        selection: {
          kind: 'partial',
          actNodeIds: [],
          sceneIds: []
        }
      });
    const invalidResponse = await ownerAgent
      .post(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/exports/pdf`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({
        format: 'standard',
        selection: {
          kind: 'partial',
          sceneIds: ['scn_missing']
        }
      });

    expect(emptyResponse.status).toBe(400);
    expect(emptyResponse.body.error.message).toMatch(/at least one act or scene/);
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.error.message).toMatch(/do not belong to this script/);
  });

  it('flushes active scene collaboration state before export and exports multilingual text', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const owner = await User.findOne({
      email: seedFixtures.users.owner.email
    });
    const scene = await Scene.findOne({
      publicId: seedFixtures.scenes.intro.publicId
    });
    const liveDocument = {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_live_slug',
          type: 'slugline',
          text: 'int. tokyo apartment - night'
        },
        {
          id: 'blk_live_action',
          type: 'action',
          text: 'Hola.\nこんにちは。\nWriters reunite.'
        }
      ]
    };
    const session = await sceneSessionManager.ensureSession({
      scene
    });

    session.replaceDocument({
      document: liveDocument,
      headRevision: scene.headRevision ?? 0,
      headUpdatedAt: scene.headUpdatedAt
    });
    session.dirty = true;
    session.lastEditor = {
      actorId: owner._id,
      userId: owner.publicId
    };

    const response = await postPdfExport({
      agent: ownerAgent,
      csrfToken,
      payload: {
        format: 'standard',
        selection: {
          kind: 'full'
        }
      }
    });
    const reloadedScene = await Scene.findById(scene._id);

    expect(response.status).toBe(200);
    expect(response.body.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(reloadedScene.headDocument.blocks[0].text).toBe('INT. TOKYO APARTMENT - NIGHT');
    expect(reloadedScene.headDocument.blocks[1].text).toContain('こんにちは');
  });
});


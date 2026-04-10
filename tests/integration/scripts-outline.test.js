import supertest from 'supertest';

import { OutlineNode, Scene, Script } from '../../src/models/index.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

const createScriptPayload = (overrides = {}) => ({
  title: 'Outline Test Script',
  description: 'Testing script outline flows.',
  genre: 'Drama',
  status: 'draft',
  language: 'en',
  authors: ['Olivia Owner'],
  ...overrides
});

const createScriptViaApi = async (agent, csrfToken, payload = {}) => {
  const response = await agent
    .post(`/api/v1/projects/${seedFixtures.project.publicId}/scripts`)
    .set('X-CSRF-Token', csrfToken)
    .send(createScriptPayload(payload));

  return response;
};

const createOutlineNodeViaApi = async ({
  agent,
  csrfToken,
  scriptId,
  payload
}) =>
  agent
    .post(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline/nodes`)
    .set('X-CSRF-Token', csrfToken)
    .send(payload);

const patchOutlineNodeViaApi = async ({
  agent,
  csrfToken,
  scriptId,
  nodeId,
  payload
}) =>
  agent
    .patch(
      `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline/nodes/${nodeId}`
    )
    .set('X-CSRF-Token', csrfToken)
    .send(payload);

const moveOutlineNodeViaApi = async ({
  agent,
  csrfToken,
  scriptId,
  nodeId,
  payload
}) =>
  agent
    .post(
      `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline/nodes/${nodeId}/move`
    )
    .set('X-CSRF-Token', csrfToken)
    .send(payload);

const deleteOutlineNodeViaApi = async ({
  agent,
  csrfToken,
  scriptId,
  nodeId
}) =>
  agent
    .delete(
      `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline/nodes/${nodeId}`
    )
    .set('X-CSRF-Token', csrfToken);

const getScriptDetail = async (agent, scriptId) =>
  agent.get(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}`);

describe('scripts and outline', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('creates scripts for editors, blocks reviewers, updates metadata, and deletes scripts owner-only', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const editorAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);

    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);

    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const editorCsrf = await getPageCsrfToken(editorAgent, '/app');
    const reviewerCsrf = await getPageCsrfToken(reviewerAgent, '/app');

    const reviewerCreate = await createScriptViaApi(reviewerAgent, reviewerCsrf, {
      title: 'Forbidden Script'
    });
    expect(reviewerCreate.status).toBe(403);

    const createResponse = await createScriptViaApi(editorAgent, editorCsrf, {
      title: 'Editor Script',
      authors: ['Eddie Editor', 'Olivia Owner']
    });
    expect(createResponse.status).toBe(201);
    const scriptId = createResponse.body.data.script.id;
    const scriptDocument = await Script.findOne({ publicId: scriptId });

    const updateResponse = await editorAgent
      .patch(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}`)
      .set('X-CSRF-Token', editorCsrf)
      .send(
        createScriptPayload({
          title: 'Editor Script Revised',
          genre: 'Thriller',
          authors: ['Eddie Editor']
        })
      );
    expect(updateResponse.status).toBe(200);

    const detailResponse = await getScriptDetail(editorAgent, scriptId);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.script.title).toBe('Editor Script Revised');
    expect(detailResponse.body.data.script.genre).toBe('Thriller');
    expect(detailResponse.body.data.script.authors).toEqual(['Eddie Editor']);

    const firstNode = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken: editorCsrf,
      scriptId,
      payload: {
        type: 'scene',
        title: 'INT. TEST LAB - DAY'
      }
    });
    expect(firstNode.status).toBe(201);

    const editorDelete = await editorAgent
      .delete(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}`)
      .set('X-CSRF-Token', editorCsrf);
    expect(editorDelete.status).toBe(403);

    const ownerDelete = await ownerAgent
      .delete(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}`)
      .set('X-CSRF-Token', ownerCsrf);
    expect(ownerDelete.status).toBe(200);

    expect(await Script.findOne({ publicId: scriptId })).toBeNull();
    expect(await OutlineNode.countDocuments({ scriptId: scriptDocument._id })).toBe(0);
    expect(await Scene.countDocuments({ scriptId: scriptDocument._id })).toBe(0);
  });

  it('supports mixed root outline structure and blocks invalid nesting', async () => {
    const editorAgent = supertest.agent(stack.app);
    await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    const csrfToken = await getPageCsrfToken(editorAgent, '/app');

    const createResponse = await createScriptViaApi(editorAgent, csrfToken, {
      title: 'Mixed Outline'
    });
    const scriptId = createResponse.body.data.script.id;

    const rootAct = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: { type: 'act', title: 'Act I' }
    });
    expect(rootAct.status, JSON.stringify(rootAct.body)).toBe(201);
    const rootBeat = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: { type: 'beat', title: 'Cold Open Beat' }
    });
    expect(rootBeat.status, JSON.stringify(rootBeat.body)).toBe(201);
    const rootScene = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: { type: 'scene', title: 'Root Scene' }
    });
    expect(rootScene.status, JSON.stringify(rootScene.body)).toBe(201);
    const beatInsideAct = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'beat',
        title: 'Act Beat',
        placementParentId: rootAct.body.data.nodeId
      }
    });
    expect(beatInsideAct.status, JSON.stringify(beatInsideAct.body)).toBe(201);
    const sceneInsideAct = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'scene',
        title: 'Scene In Act',
        placementParentId: rootAct.body.data.nodeId
      }
    });
    const sceneInsideRootBeat = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'scene',
        title: 'Scene In Root Beat',
        placementParentId: rootBeat.body.data.nodeId
      }
    });
    const sceneInsideNestedBeat = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'scene',
        title: 'Scene In Nested Beat',
        placementParentId: beatInsideAct.body.data.nodeId
      }
    });

    expect(rootAct.status).toBe(201);
    expect(sceneInsideAct.status).toBe(201);
    expect(sceneInsideRootBeat.status).toBe(201);
    expect(sceneInsideNestedBeat.status).toBe(201);

    const detailResponse = await getScriptDetail(editorAgent, scriptId);
    const rootTypes = detailResponse.body.data.outline.map((node) => node.type);
    expect(rootTypes).toEqual(['act', 'beat', 'scene']);
    expect(detailResponse.body.data.outline[0].children.map((node) => node.type)).toEqual([
      'beat',
      'scene'
    ]);
    expect(detailResponse.body.data.outline[1].children.map((node) => node.type)).toEqual([
      'scene'
    ]);

    const actUnderAct = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'act',
        title: 'Invalid Act',
        placementParentId: rootAct.body.data.nodeId
      }
    });
    const beatUnderBeat = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'beat',
        title: 'Invalid Beat',
        placementParentId: rootBeat.body.data.nodeId
      }
    });
    const actUnderBeat = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'act',
        title: 'Invalid Act In Beat',
        placementParentId: rootBeat.body.data.nodeId
      }
    });

    expect(actUnderAct.status).toBe(400);
    expect(beatUnderBeat.status).toBe(400);
    expect(actUnderBeat.status).toBe(400);
  });

  it('validates scene act and beat links and updates inherited act links when a beat moves', async () => {
    const editorAgent = supertest.agent(stack.app);
    await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    const csrfToken = await getPageCsrfToken(editorAgent, '/app');

    const createResponse = await createScriptViaApi(editorAgent, csrfToken, {
      title: 'Semantic Links'
    });
    const scriptId = createResponse.body.data.script.id;

    const actA = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: { type: 'act', title: 'Act A' }
    });
    expect(actA.status, JSON.stringify(actA.body)).toBe(201);
    const actB = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: { type: 'act', title: 'Act B' }
    });
    expect(actB.status, JSON.stringify(actB.body)).toBe(201);
    const beatInActA = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'beat',
        title: 'Beat A1',
        placementParentId: actA.body.data.nodeId
      }
    });
    expect(beatInActA.status, JSON.stringify(beatInActA.body)).toBe(201);
    const linkedScene = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'scene',
        title: 'Linked Root Scene',
        beatId: beatInActA.body.data.nodeId
      }
    });

    expect(linkedScene.status).toBe(201);

    const linkedSceneNode = await OutlineNode.findOne({
      publicId: linkedScene.body.data.nodeId
    }).populate('actId beatId');
    expect(linkedSceneNode.actId.publicId).toBe(actA.body.data.nodeId);
    expect(linkedSceneNode.beatId.publicId).toBe(beatInActA.body.data.nodeId);

    const invalidScene = await createOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      payload: {
        type: 'scene',
        title: 'Invalid Scene',
        actId: actB.body.data.nodeId,
        beatId: beatInActA.body.data.nodeId
      }
    });
    expect(invalidScene.status).toBe(400);

    const moveResponse = await moveOutlineNodeViaApi({
      agent: editorAgent,
      csrfToken,
      scriptId,
      nodeId: beatInActA.body.data.nodeId,
      payload: {
        placementParentId: actB.body.data.nodeId
      }
    });
    expect(moveResponse.status).toBe(200);

    const movedLinkedScene = await OutlineNode.findOne({
      publicId: linkedScene.body.data.nodeId
    }).populate('actId');
    expect(movedLinkedScene.actId.publicId).toBe(actB.body.data.nodeId);
  });

  it('moves outline nodes, rerenders the fragment, enforces numbering rules, protects reviewer mutations, and records activity plus audit', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);

    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);

    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const reviewerCsrf = await getPageCsrfToken(reviewerAgent, '/app');

    const createResponse = await createScriptViaApi(ownerAgent, ownerCsrf, {
      title: 'Numbering Script'
    });
    const scriptId = createResponse.body.data.script.id;

    const firstScene = await createOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      payload: { type: 'scene', title: 'Scene One' }
    });
    const secondScene = await createOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      payload: { type: 'scene', title: 'Scene Two' }
    });
    const thirdScene = await createOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      payload: { type: 'scene', title: 'Scene Three' }
    });

    let detailResponse = await getScriptDetail(ownerAgent, scriptId);
    expect(detailResponse.body.data.outline.map((node) => node.displaySceneNumber)).toEqual([
      '1',
      '2',
      '3'
    ]);

    const moveResponse = await moveOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      nodeId: thirdScene.body.data.nodeId,
      payload: {
        placementParentId: null,
        insert: {
          beforeNodeId: firstScene.body.data.nodeId
        }
      }
    });
    expect(moveResponse.status).toBe(200);

    detailResponse = await getScriptDetail(ownerAgent, scriptId);
    expect(detailResponse.body.data.outline.map((node) => node.title)).toEqual([
      'Scene Three',
      'Scene One',
      'Scene Two'
    ]);
    expect(detailResponse.body.data.outline.map((node) => node.displaySceneNumber)).toEqual([
      '1',
      '2',
      '3'
    ]);

    const fragmentResponse = await ownerAgent.get(
      `/fragments/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline-tree`
    );
    expect(fragmentResponse.status).toBe(200);
    expect(fragmentResponse.text.indexOf('Scene Three')).toBeLessThan(
      fragmentResponse.text.indexOf('Scene One')
    );

    const numberingResponse = await ownerAgent
      .patch(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/scene-numbering`
      )
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        sceneNumberMode: 'frozen'
      });
    expect(numberingResponse.status).toBe(200);

    const insertedFrozenScene = await createOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      payload: {
        type: 'scene',
        title: 'Inserted Frozen Scene',
        insert: {
          beforeNodeId: secondScene.body.data.nodeId
        }
      }
    });
    expect(insertedFrozenScene.status).toBe(201);

    detailResponse = await getScriptDetail(ownerAgent, scriptId);
    const frozenScene = detailResponse.body.data.outline.find(
      (node) => node.title === 'Inserted Frozen Scene'
    );
    expect(frozenScene.displaySceneNumber).toMatch(/^2[A-Z]$/);

    const manualNumberSet = await patchOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      nodeId: firstScene.body.data.nodeId,
      payload: {
        manualSceneNumber: '88'
      }
    });
    expect(manualNumberSet.status).toBe(200);

    const duplicateManualNumber = await patchOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      nodeId: secondScene.body.data.nodeId,
      payload: {
        manualSceneNumber: '88'
      }
    });
    expect(duplicateManualNumber.status).toBe(409);

    const reviewerMutation = await createOutlineNodeViaApi({
      agent: reviewerAgent,
      csrfToken: reviewerCsrf,
      scriptId,
      payload: { type: 'scene', title: 'Reviewer Scene' }
    });
    expect(reviewerMutation.status).toBe(403);

    const deleteResponse = await deleteOutlineNodeViaApi({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      scriptId,
      nodeId: secondScene.body.data.nodeId
    });
    expect(deleteResponse.status).toBe(200);

    const activityResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/activity`
    );
    expect(activityResponse.status).toBe(200);
    expect(activityResponse.body.data.activity.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        'script.created',
        'outline.node_created',
        'outline.node_moved',
        'script.scene_numbering_changed',
        'outline.node_deleted'
      ])
    );

    const auditResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/audit`
    );
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.data.audit.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        'script.created',
        'outline.node_created',
        'outline.node_moved',
        'script.scene_numbering_changed',
        'outline.node_deleted'
      ])
    );
  });
});

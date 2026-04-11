import supertest from 'supertest';

import { ActivityEvent, AuditLog, Scene, User } from '../../src/models/index.js';
import { persistSceneSessionHead } from '../../src/services/collab/scene-session-persistence.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

const buildSceneHeadUrl = (scriptId, sceneId) =>
  `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/scenes/${sceneId}/head`;

const saveSceneHead = async ({
  agent,
  csrfToken,
  scriptId = seedFixtures.script.publicId,
  sceneId = seedFixtures.scenes.intro.publicId,
  document
}) => {
  const scene = await Scene.findOne({ publicId: sceneId });
  const response = await agent
    .put(buildSceneHeadUrl(scriptId, sceneId))
    .set('X-CSRF-Token', csrfToken)
    .send({
      baseHeadRevision: scene?.headRevision ?? 0,
      document
    });

  expect(response.status).toBe(200);
  return response.body.data;
};

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

  expect(response.status).toBe(201);
  return response.body.data.script.id;
};

describe('entity registry and metrics', () => {
  let stack;

  beforeEach(async () => {
    stack = await startTestStack();
  });

  afterEach(async () => {
    if (stack) {
      await stack.close();
      stack = null;
    }
  });

  it('derives latest-draft entities and metrics from HTTP scene saves without activity or audit spam', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const activityCountBefore = await ActivityEvent.countDocuments();
    const auditCountBefore = await AuditLog.countDocuments();

    await saveSceneHead({
      agent: ownerAgent,
      csrfToken,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug',
            type: 'slugline',
            text: 'INT. KITCHEN - DAY'
          },
          {
            id: 'blk_character',
            type: 'character',
            text: 'mike'
          },
          {
            id: 'blk_dialogue',
            type: 'dialogue',
            text: 'First line.\nSecond line.'
          }
        ]
      }
    });

    const entitiesResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/entities?type=character`
    );
    expect(entitiesResponse.status).toBe(200);
    expect(entitiesResponse.body.data.entities).toEqual([
      expect.objectContaining({
        canonicalName: 'MIKE',
        latestStats: expect.objectContaining({
          sceneCount: 1,
          scriptCount: 1,
          dialogueBlockCount: 1,
          dialogueLineCount: 2
        })
      })
    ]);

    const locationMetricsResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/locations`
    );
    expect(locationMetricsResponse.status).toBe(200);
    expect(locationMetricsResponse.body.data.metrics).toEqual([
      expect.objectContaining({
        canonicalName: 'KITCHEN',
        latestStats: expect.objectContaining({
          sceneCount: 1,
          scriptCount: 1
        })
      })
    ]);

    const charactersPage = await ownerAgent.get(
      `/projects/${seedFixtures.project.publicId}/characters`
    );
    expect(charactersPage.status).toBe(200);
    expect(charactersPage.text).toContain('MIKE');
    const locationsPage = await ownerAgent.get(
      `/projects/${seedFixtures.project.publicId}/locations`
    );
    expect(locationsPage.status).toBe(200);
    expect(locationsPage.text).toContain('KITCHEN');
    expect(await ActivityEvent.countDocuments()).toBe(activityCountBefore);
    expect(await AuditLog.countDocuments()).toBe(auditCountBefore);
  });

  it('updates latest-draft metrics after collaborative persistence flushes and scene restores', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const owner = await User.findOne({ email: seedFixtures.users.owner.email });
    const scene = await Scene.findOne({ publicId: seedFixtures.scenes.intro.publicId });

    await persistSceneSessionHead({
      sceneObjectId: scene._id,
      actorId: owner._id,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug',
            type: 'slugline',
            text: 'EXT. ALLEY - NIGHT'
          },
          {
            id: 'blk_character',
            type: 'character',
            text: 'ana'
          },
          {
            id: 'blk_dialogue',
            type: 'dialogue',
            text: 'Collab flush line.'
          }
        ]
      }
    });

    let metricsResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/characters`
    );
    expect(metricsResponse.body.data.metrics).toEqual([
      expect.objectContaining({
        canonicalName: 'ANA'
      })
    ]);

    const majorSaveResponse = await ownerAgent
      .post(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/versions/major-save`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(majorSaveResponse.status).toBe(201);
    const savedVersionId = majorSaveResponse.body.data.version.id;

    await saveSceneHead({
      agent: ownerAgent,
      csrfToken,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug_next',
            type: 'slugline',
            text: 'EXT. ALLEY - NIGHT'
          },
          {
            id: 'blk_character_next',
            type: 'character',
            text: 'bruno'
          },
          {
            id: 'blk_dialogue_next',
            type: 'dialogue',
            text: 'Restored away.'
          }
        ]
      }
    });

    metricsResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/characters`
    );
    expect(metricsResponse.body.data.metrics[0].canonicalName).toBe('BRUNO');

    const restoreResponse = await ownerAgent
      .post(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/versions/${savedVersionId}/restore`
      )
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(restoreResponse.status).toBe(200);

    metricsResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/characters`
    );
    expect(metricsResponse.body.data.metrics).toEqual([
      expect.objectContaining({
        canonicalName: 'ANA'
      })
    ]);
  });

  it('supports manual create, update, and merge operations with permissions and alias resolution', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const reviewerCsrf = await getPageCsrfToken(
      reviewerAgent,
      `/projects/${seedFixtures.project.publicId}/characters`
    );

    const reviewerPage = await reviewerAgent.get(
      `/projects/${seedFixtures.project.publicId}/characters`
    );
    expect(reviewerPage.status).toBe(200);
    expect(reviewerPage.text).not.toContain('data-entity-create-form');

    const reviewerMutation = await reviewerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/entities`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({
        type: 'character',
        canonicalName: 'RESTRICTED',
        aliases: []
      });
    expect(reviewerMutation.status).toBe(403);

    const createEntityResponse = await ownerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/entities`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        type: 'location',
        canonicalName: 'Backlot',
        aliases: ['Exterior Lot']
      });
    expect(createEntityResponse.status).toBe(201);
    expect(await ActivityEvent.countDocuments({ type: 'entity.created' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'entity.created' })).toBe(1);

    const locationsResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/entities?type=location&q=Exterior`
    );
    const backlotEntity = locationsResponse.body.data.entities.find(
      (entity) => entity.canonicalName === 'Backlot'
    );
    expect(backlotEntity).toBeTruthy();

    const updateEntityResponse = await ownerAgent
      .patch(`/api/v1/projects/${seedFixtures.project.publicId}/entities/${backlotEntity.id}`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        canonicalName: 'Back Lot',
        aliases: ['Exterior Lot', 'Exterior Backlot']
      });
    expect(updateEntityResponse.status).toBe(200);
    expect(await ActivityEvent.countDocuments({ type: 'entity.updated' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'entity.updated' })).toBe(1);

    await saveSceneHead({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug_mike',
            type: 'slugline',
            text: 'INT. KITCHEN - DAY'
          },
          {
            id: 'blk_char_mike',
            type: 'character',
            text: 'MIKE'
          },
          {
            id: 'blk_dialogue_mike',
            type: 'dialogue',
            text: 'Old name.'
          }
        ]
      }
    });

    const secondSceneTitle = 'INT. GARAGE - NIGHT';
    const secondSceneResponse = await ownerAgent
      .post(
        `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/outline/nodes`
      )
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        type: 'scene',
        title: secondSceneTitle
      });
    expect(secondSceneResponse.status).toBe(201);
    const secondScene = await Scene.findOne({ title: secondSceneTitle }).sort({
      createdAt: -1
    });

    await saveSceneHead({
      agent: ownerAgent,
      csrfToken: ownerCsrf,
      sceneId: secondScene.publicId,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug_michael',
            type: 'slugline',
            text: 'INT. GARAGE - NIGHT'
          },
          {
            id: 'blk_char_michael',
            type: 'character',
            text: 'MICHAEL'
          },
          {
            id: 'blk_dialogue_michael',
            type: 'dialogue',
            text: 'Canonical name.'
          }
        ]
      }
    });

    const characterEntities = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/entities?type=character`
    );
    const mikeEntity = characterEntities.body.data.entities.find(
      (entity) => entity.canonicalName === 'MIKE'
    );
    const michaelEntity = characterEntities.body.data.entities.find(
      (entity) => entity.canonicalName === 'MICHAEL'
    );
    expect(mikeEntity).toBeTruthy();
    expect(michaelEntity).toBeTruthy();

    const mergeResponse = await ownerAgent
      .post(
        `/api/v1/projects/${seedFixtures.project.publicId}/entities/${mikeEntity.id}/merge`
      )
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        targetEntityId: michaelEntity.id
      });
    expect(mergeResponse.status).toBe(200);
    expect(await ActivityEvent.countDocuments({ type: 'entity.merged' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'entity.merged' })).toBe(1);

    const mergedMetricsResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/characters?q=MIKE`
    );
    expect(mergedMetricsResponse.body.data.metrics).toEqual([
      expect.objectContaining({
        canonicalName: 'MICHAEL',
        latestStats: expect.objectContaining({
          sceneCount: 2,
          dialogueLineCount: 2
        })
      })
    ]);

    const mergedEntitiesResponse = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/entities?type=character&includeMerged=true`
    );
    expect(
      mergedEntitiesResponse.body.data.entities.find((entity) => entity.canonicalName === 'MIKE')
    ).toEqual(
      expect.objectContaining({
        isMerged: true
      })
    );
  });

  it('removes stale metrics when a script is deleted', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const scriptId = await createScriptViaApi(ownerAgent, csrfToken, 'Delete Metrics Script');
    const sceneCreateResponse = await ownerAgent
      .post(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}/outline/nodes`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        type: 'scene',
        title: 'INT. DELETE ROOM - DAY'
      });
    expect(sceneCreateResponse.status).toBe(201);
    const createdScene = await Scene.findOne({ title: 'INT. DELETE ROOM - DAY' }).sort({
      createdAt: -1
    });

    await saveSceneHead({
      agent: ownerAgent,
      csrfToken,
      scriptId,
      sceneId: createdScene.publicId,
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'blk_slug_delete',
            type: 'slugline',
            text: 'INT. DELETE ROOM - DAY'
          },
          {
            id: 'blk_char_delete',
            type: 'character',
            text: 'TEMP'
          },
          {
            id: 'blk_dialogue_delete',
            type: 'dialogue',
            text: 'Temporary line.'
          }
        ]
      }
    });

    let filteredMetrics = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/characters?scriptId=${scriptId}`
    );
    expect(filteredMetrics.body.data.metrics).toEqual([
      expect.objectContaining({
        canonicalName: 'TEMP'
      })
    ]);

    const deleteResponse = await ownerAgent
      .delete(`/api/v1/projects/${seedFixtures.project.publicId}/scripts/${scriptId}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deleteResponse.status).toBe(200);

    filteredMetrics = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/characters?scriptId=${scriptId}`
    );
    expect(filteredMetrics.status).toBe(404);

    const projectMetrics = await ownerAgent.get(
      `/api/v1/projects/${seedFixtures.project.publicId}/metrics/characters?q=TEMP`
    );
    expect(projectMetrics.body.data.metrics).toEqual([]);
  });
});

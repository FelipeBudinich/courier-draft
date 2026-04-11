import supertest from 'supertest';

import {
  ActivityEvent,
  AuditLog,
  DocumentVersion,
  Note,
  Scene,
  Script,
  ScriptVersion
} from '../../src/models/index.js';
import { noteSessionManager } from '../../src/services/collab/note-session-manager.js';
import { sceneSessionManager } from '../../src/services/collab/scene-session-manager.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

const PROJECT_ID = seedFixtures.project.publicId;
const SCRIPT_ID = seedFixtures.script.publicId;
const SCENE_ID = seedFixtures.scenes.intro.publicId;
const OWNER_NOTE_ID = seedFixtures.notes.owner.publicId;

const buildSceneHeadUrl = () =>
  `/api/v1/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/scenes/${SCENE_ID}/head`;

const buildSceneVersionsUrl = () =>
  `/api/v1/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/scenes/${SCENE_ID}/versions`;

const buildSceneDiffUrl = () =>
  `/api/v1/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/scenes/${SCENE_ID}/diff`;

const buildScriptVersionsUrl = () =>
  `/api/v1/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/versions`;

const buildScriptMajorSaveUrl = () =>
  `/api/v1/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/versions/major-save`;

const buildNoteHeadUrl = (noteId) =>
  `/api/v1/projects/${PROJECT_ID}/notes/${noteId}/head`;

const buildNoteVersionsUrl = (noteId) =>
  `/api/v1/projects/${PROJECT_ID}/notes/${noteId}/versions`;

const buildNoteDiffUrl = (noteId) =>
  `/api/v1/projects/${PROJECT_ID}/notes/${noteId}/diff`;

const saveSceneHead = async (agent, csrfToken, document) => {
  const scene = await Scene.findOne({ publicId: SCENE_ID });
  const response = await agent
    .put(buildSceneHeadUrl())
    .set('X-CSRF-Token', csrfToken)
    .send({
      baseHeadRevision: scene?.headRevision ?? 0,
      document
    });

  expect(response.status).toBe(200);
  return response.body.data;
};

const saveNoteHead = async (agent, csrfToken, noteId, text) => {
  const note = await Note.findOne({ publicId: noteId });
  const response = await agent
    .put(buildNoteHeadUrl(noteId))
    .set('X-CSRF-Token', csrfToken)
    .send({
      baseHeadRevision: note?.headRevision ?? 0,
      text
    });

  expect(response.status).toBe(200);
  return response.body.data;
};

describe('versioning workflows', () => {
  let stack;

  beforeEach(async () => {
    stack = await startTestStack();
  });

  afterEach(async () => {
    noteSessionManager.clear();
    sceneSessionManager.clear();

    if (stack) {
      await stack.close();
      stack = null;
    }
  });

  it('creates script checkpoints only for changed script documents and rejects empty checkpoint saves', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');

    await saveSceneHead(ownerAgent, ownerCsrf, {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_intro_seed',
          type: 'action',
          text: 'Script checkpoint draft change.'
        }
      ]
    });
    await saveNoteHead(
      ownerAgent,
      ownerCsrf,
      OWNER_NOTE_ID,
      'Owner note promoted into a script checkpoint.'
    );

    const checkpointResponse = await ownerAgent
      .post(buildScriptMajorSaveUrl())
      .set('X-CSRF-Token', ownerCsrf)
      .send({});

    expect(checkpointResponse.status).toBe(201);
    expect(checkpointResponse.body.data.scriptVersion.versionLabel).toBe('0.0.0.1');
    expect(checkpointResponse.body.data.scriptVersion.majorSaveSequence).toBe(1);
    expect(checkpointResponse.body.data.snapshots).toHaveLength(2);

    const script = await Script.findOne({ publicId: SCRIPT_ID });
    const scriptVersion = await ScriptVersion.findOne({ scriptId: script._id });
    const scene = await Scene.findOne({ publicId: SCENE_ID });
    const ownerNote = await Note.findOne({ publicId: OWNER_NOTE_ID });

    expect(script.majorSaveSequence).toBe(1);
    expect(script.currentVersionLabel).toBe('0.0.0.1');
    expect(scriptVersion.scopeType).toBe('script');
    expect(scriptVersion.summary).toMatchObject({
      snapshotCount: 2,
      changedScenes: 1,
      changedNotes: 1
    });

    const snapshottedVersions = await DocumentVersion.find({
      scriptVersionId: scriptVersion._id
    }).sort({ docType: 1 });
    expect(snapshottedVersions).toHaveLength(2);
    expect(snapshottedVersions.map((entry) => entry.docType).sort()).toEqual([
      'note',
      'scene'
    ]);
    expect(scene.currentMajorVersionId?.toString()).toBe(
      snapshottedVersions.find((entry) => entry.docType === 'scene')._id.toString()
    );
    expect(ownerNote.currentMajorVersionId?.toString()).toBe(
      snapshottedVersions.find((entry) => entry.docType === 'note')._id.toString()
    );

    const checkpointListResponse = await ownerAgent.get(buildScriptVersionsUrl());
    expect(checkpointListResponse.status).toBe(200);
    expect(checkpointListResponse.body.data.versions[0].scopeType).toBe('script');

    const checkpointDetailResponse = await ownerAgent.get(
      `${buildScriptVersionsUrl()}/${scriptVersion.publicId}`
    );
    expect(checkpointDetailResponse.status).toBe(200);
    expect(checkpointDetailResponse.body.data.version.snapshotRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docType: 'scene',
          docId: SCENE_ID
        }),
        expect.objectContaining({
          docType: 'note',
          docId: OWNER_NOTE_ID
        })
      ])
    );

    const ownerSidebarResponse = await ownerAgent.get(
      `/fragments/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/version-sidebar?sceneId=${SCENE_ID}`
    );
    expect(ownerSidebarResponse.status).toBe(200);
    expect(ownerSidebarResponse.text).toContain('data-scene-major-save');
    expect(ownerSidebarResponse.text).toContain('data-scene-version-restore');

    const reviewerSidebarResponse = await reviewerAgent.get(
      `/fragments/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/version-sidebar?sceneId=${SCENE_ID}`
    );
    expect(reviewerSidebarResponse.status).toBe(200);
    expect(reviewerSidebarResponse.text).not.toContain('data-scene-major-save');
    expect(reviewerSidebarResponse.text).not.toContain('data-scene-version-restore');

    expect(await ActivityEvent.countDocuments({ type: 'script.major_saved' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'script.major_saved' })).toBe(1);

    const noChangesResponse = await ownerAgent
      .post(buildScriptMajorSaveUrl())
      .set('X-CSRF-Token', ownerCsrf)
      .send({});

    expect(noChangesResponse.status).toBe(409);
    expect(noChangesResponse.body.error.code).toBe('NO_CHANGES_TO_SAVE');
  });

  it('creates scene major saves, allows reviewer compare access, and restores without rewriting script checkpoint state', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const reviewerCsrf = await getPageCsrfToken(reviewerAgent, '/app');

    await saveSceneHead(ownerAgent, ownerCsrf, {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_intro_seed',
          type: 'action',
          text: 'Scene major save baseline.'
        }
      ]
    });

    const majorSaveResponse = await ownerAgent
      .post(`${buildSceneVersionsUrl()}/major-save`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({});

    expect(majorSaveResponse.status).toBe(201);
    expect(majorSaveResponse.body.data.version.versionLabel).toBe('0.0.1.1');
    expect(majorSaveResponse.body.data.scriptVersion.versionLabel).toBe('0.0.1.1');
    const savedVersionId = majorSaveResponse.body.data.version.id;

    await saveSceneHead(ownerAgent, ownerCsrf, {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_intro_seed',
          type: 'action',
          text: 'Scene current head after major save.'
        }
      ]
    });

    const reviewerVersionsResponse = await reviewerAgent.get(buildSceneVersionsUrl());
    expect(reviewerVersionsResponse.status).toBe(200);
    expect(reviewerVersionsResponse.body.data.versions[0].id).toBe(savedVersionId);

    const reviewerDiffResponse = await reviewerAgent
      .post(buildSceneDiffUrl())
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(reviewerDiffResponse.status).toBe(200);
    expect(reviewerDiffResponse.body.data.hasMajorVersion).toBe(true);
    expect(reviewerDiffResponse.body.data.compare.left.versionId).toBe(savedVersionId);
    expect(
      reviewerDiffResponse.body.data.blocks.some((block) =>
        ['modified', 'added', 'deleted'].includes(block.status)
      )
    ).toBe(true);

    const reviewerMajorSaveResponse = await reviewerAgent
      .post(`${buildSceneVersionsUrl()}/major-save`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(reviewerMajorSaveResponse.status).toBe(403);

    const reviewerRestoreResponse = await reviewerAgent
      .post(`${buildSceneVersionsUrl()}/${savedVersionId}/restore`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(reviewerRestoreResponse.status).toBe(403);

    const restoreResponse = await ownerAgent
      .post(`${buildSceneVersionsUrl()}/ver_scene_intro_demo/restore`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({});

    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body.data.version.snapshotType).toBe('restore');
    expect(restoreResponse.body.data.version.restoredFromVersionId).toBe('ver_scene_intro_demo');

    const script = await Script.findOne({ publicId: SCRIPT_ID });
    const scene = await Scene.findOne({ publicId: SCENE_ID });
    expect(script.majorSaveSequence).toBe(1);
    expect(script.currentVersionLabel).toBe('0.0.1.1');
    expect(scene.headDocument.blocks[0].text).toBe('A team of writers gathers around a whiteboard.');

    const sceneVersionsResponse = await ownerAgent.get(buildSceneVersionsUrl());
    expect(sceneVersionsResponse.status).toBe(200);
    expect(sceneVersionsResponse.body.data.versions).toHaveLength(3);
    expect(sceneVersionsResponse.body.data.versions[0].snapshotType).toBe('restore');

    const postRestoreDiffResponse = await ownerAgent
      .post(buildSceneDiffUrl())
      .set('X-CSRF-Token', ownerCsrf)
      .send({});
    expect(postRestoreDiffResponse.status).toBe(200);
    expect(postRestoreDiffResponse.body.data.compare.left.versionId).toBe(savedVersionId);
    expect(postRestoreDiffResponse.body.data.compare.right.kind).toBe('currentHead');

    expect(await ActivityEvent.countDocuments({ type: 'scene.major_saved' })).toBe(1);
    expect(await ActivityEvent.countDocuments({ type: 'scene.restored' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'scene.major_saved' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'scene.restored' })).toBe(1);
  });

  it('keeps project-level note versioning independent from script checkpoints and preserves restore lineage', async () => {
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const reviewerCsrf = await getPageCsrfToken(reviewerAgent, '/app');

    const createNoteResponse = await reviewerAgent
      .post(`/api/v1/projects/${PROJECT_ID}/notes`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({
        containerType: 'project',
        containerId: PROJECT_ID,
        text: 'Reviewer project-level version baseline.'
      });

    expect(createNoteResponse.status).toBe(201);
    const noteId = createNoteResponse.body.data.note.id;

    const firstMajorSaveResponse = await reviewerAgent
      .post(`${buildNoteVersionsUrl(noteId)}/major-save`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(firstMajorSaveResponse.status).toBe(201);
    expect(firstMajorSaveResponse.body.data.scriptVersion).toBeNull();
    expect(firstMajorSaveResponse.body.data.version.versionLabel).toBeNull();
    const firstVersionId = firstMajorSaveResponse.body.data.version.id;

    await saveNoteHead(
      reviewerAgent,
      reviewerCsrf,
      noteId,
      'Reviewer project-level version current head.'
    );

    const diffResponse = await reviewerAgent
      .post(buildNoteDiffUrl(noteId))
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(diffResponse.status).toBe(200);
    expect(diffResponse.body.data.hasMajorVersion).toBe(true);
    expect(diffResponse.body.data.compare.left.versionId).toBe(firstVersionId);
    expect(
      diffResponse.body.data.segments.some((segment) =>
        ['added', 'deleted'].includes(segment.kind)
      )
    ).toBe(true);

    const secondMajorSaveResponse = await reviewerAgent
      .post(`${buildNoteVersionsUrl(noteId)}/major-save`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(secondMajorSaveResponse.status).toBe(201);
    const secondVersionId = secondMajorSaveResponse.body.data.version.id;

    const restoreResponse = await reviewerAgent
      .post(`${buildNoteVersionsUrl(noteId)}/${firstVersionId}/restore`)
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body.data.version.snapshotType).toBe('restore');
    expect(restoreResponse.body.data.version.restoredFromVersionId).toBe(firstVersionId);

    const script = await Script.findOne({ publicId: SCRIPT_ID });
    const note = await Note.findOne({ publicId: noteId });
    expect(script.majorSaveSequence).toBe(0);
    expect(script.currentVersionLabel).toBeNull();
    expect(await ScriptVersion.countDocuments()).toBe(0);
    expect(note.headText).toBe('Reviewer project-level version baseline.');

    const noteVersionsResponse = await reviewerAgent.get(buildNoteVersionsUrl(noteId));
    expect(noteVersionsResponse.status).toBe(200);
    expect(noteVersionsResponse.body.data.versions).toHaveLength(3);
    expect(noteVersionsResponse.body.data.versions[0].snapshotType).toBe('restore');

    const postRestoreDiffResponse = await reviewerAgent
      .post(buildNoteDiffUrl(noteId))
      .set('X-CSRF-Token', reviewerCsrf)
      .send({});
    expect(postRestoreDiffResponse.status).toBe(200);
    expect(postRestoreDiffResponse.body.data.compare.left.versionId).toBe(secondVersionId);

    expect(await ActivityEvent.countDocuments({ type: 'note.major_saved' })).toBe(2);
    expect(await ActivityEvent.countDocuments({ type: 'note.restored' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'note.major_saved' })).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'note.restored' })).toBe(1);
  });
});

import { io as createClient } from 'socket.io-client';
import supertest from 'supertest';

import { ActivityEvent, AuditLog, Note, Scene } from '../../src/models/index.js';
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

const canonicalSceneDocument = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'blk_anchor_demo',
      type: 'action',
      text: 'hands over THE PACKAGE without looking'
    },
    {
      id: 'blk_anchor_other',
      type: 'action',
      text: 'The courier waits by the door.'
    }
  ]
};

const baseAnchorInput = {
  sceneId: SCENE_ID,
  blockId: 'blk_anchor_demo',
  startOffset: 11,
  endOffset: 22,
  selectedText: 'THE PACKAGE',
  contextBefore: 'hands over ',
  contextAfter: ' without looking'
};

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

const waitForEvent = (socket, eventName, predicate = () => true, timeoutMs = 5_000) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      socket.off(eventName, handleEvent);
      reject(new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);

    const handleEvent = (payload) => {
      if (!predicate(payload)) {
        return;
      }

      clearTimeout(timeoutId);
      socket.off(eventName, handleEvent);
      resolve(payload);
    };

    socket.on(eventName, handleEvent);
  });

const emitWithAck = (socket, eventName, payload) =>
  new Promise((resolve) => {
    socket.emit(eventName, payload, (ack) => {
      resolve(ack);
    });
  });

const buildNotesUrl = (suffix = '') =>
  `/api/v1/projects/${PROJECT_ID}/notes${suffix}`;

const buildSceneHeadUrl = () =>
  `/api/v1/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/scenes/${SCENE_ID}/head`;

const saveSceneDocument = async (agent, csrfToken, document) => {
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

const createNote = (agent, csrfToken, payload) =>
  agent
    .post(buildNotesUrl())
    .set('X-CSRF-Token', csrfToken)
    .send(payload);

describe('notes api', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterEach(() => {
    noteSessionManager.clear();
    sceneSessionManager.clear();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('creates standalone project notes as owner, editor, and reviewer', async () => {
    const cases = [
      {
        email: seedFixtures.users.owner.email,
        userId: seedFixtures.users.owner.publicId,
        localeHeading: 'owner'
      },
      {
        email: seedFixtures.users.editor.email,
        userId: seedFixtures.users.editor.publicId,
        localeHeading: 'editor'
      },
      {
        email: seedFixtures.users.reviewer.email,
        userId: seedFixtures.users.reviewer.publicId,
        localeHeading: 'reviewer'
      }
    ];

    for (const testCase of cases) {
      const agent = supertest.agent(stack.app);
      await loginAsUser(agent, testCase.email);
      const csrfToken = await getPageCsrfToken(agent, '/app');
      const response = await createNote(agent, csrfToken, {
        containerType: 'project',
        containerId: PROJECT_ID,
        text: `Standalone ${testCase.localeHeading} note`
      });

      expect(response.status).toBe(201);
      expect(response.body.data.note.container.type).toBe('project');
      expect(response.body.data.note.author.userId).toBe(testCase.userId);
      expect(response.body.data.note.headText).toBe(
        `Standalone ${testCase.localeHeading} note`
      );
      expect(response.body.data.note.capabilities.canEdit).toBe(true);
    }
  });

  it('creates anchored notes against the current scene head and rejects cross-block-like ranges', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');

    await saveSceneDocument(ownerAgent, csrfToken, canonicalSceneDocument);

    const anchoredResponse = await createNote(ownerAgent, csrfToken, {
      containerType: 'scene',
      containerId: SCENE_ID,
      sceneId: SCENE_ID,
      scriptId: SCRIPT_ID,
      text: 'Anchored to the package handoff.',
      anchor: baseAnchorInput
    });

    expect(anchoredResponse.status).toBe(201);
    expect(anchoredResponse.body.data.note.sceneId).toBe(SCENE_ID);
    expect(anchoredResponse.body.data.note.anchor.blockId).toBe('blk_anchor_demo');
    expect(anchoredResponse.body.data.note.anchor.selectedText).toBe('THE PACKAGE');

    const invalidRangeResponse = await createNote(ownerAgent, csrfToken, {
      containerType: 'scene',
      containerId: SCENE_ID,
      sceneId: SCENE_ID,
      scriptId: SCRIPT_ID,
      text: 'This selection should fail.',
      anchor: {
        ...baseAnchorInput,
        endOffset:
          canonicalSceneDocument.blocks[0].text.length +
          canonicalSceneDocument.blocks[1].text.length,
        selectedText:
          canonicalSceneDocument.blocks[0].text +
          canonicalSceneDocument.blocks[1].text
      }
    });

    expect(invalidRangeResponse.status).toBe(400);
    expect(invalidRangeResponse.body.error.code).toBe('INVALID_PAYLOAD');
  });

  it('filters notes by author, anchored state, detached state, and renders the notes panel fragment', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const reviewerCsrf = await getPageCsrfToken(reviewerAgent, '/app');

    await saveSceneDocument(ownerAgent, ownerCsrf, canonicalSceneDocument);

    const reviewerProjectNote = await createNote(reviewerAgent, reviewerCsrf, {
      containerType: 'project',
      containerId: PROJECT_ID,
      text: 'Reviewer filter target'
    });
    expect(reviewerProjectNote.status).toBe(201);

    const anchoredNote = await createNote(ownerAgent, ownerCsrf, {
      containerType: 'scene',
      containerId: SCENE_ID,
      sceneId: SCENE_ID,
      scriptId: SCRIPT_ID,
      text: 'Detach me later',
      anchor: baseAnchorInput
    });
    expect(anchoredNote.status).toBe(201);

    const detachResponse = await ownerAgent
      .patch(buildNotesUrl(`/${anchoredNote.body.data.note.id}`))
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        detach: true
      });
    expect(detachResponse.status).toBe(200);

    const reviewerFilterResponse = await reviewerAgent.get(
      `${buildNotesUrl()}?authorUserId=${seedFixtures.users.reviewer.publicId}`
    );
    expect(reviewerFilterResponse.status).toBe(200);
    expect(
      reviewerFilterResponse.body.data.notes.some(
        (note) => note.author?.userId === seedFixtures.users.reviewer.publicId
      )
    ).toBe(true);

    const detachedAnchoredResponse = await ownerAgent.get(
      `${buildNotesUrl()}?sceneId=${SCENE_ID}&anchored=true&detached=true`
    );
    expect(detachedAnchoredResponse.status).toBe(200);
    expect(detachedAnchoredResponse.body.data.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: anchoredNote.body.data.note.id,
          isDetached: true,
          isAnchored: true
        })
      ])
    );

    const fragmentResponse = await ownerAgent.get(
      `/fragments/projects/${PROJECT_ID}/scripts/${SCRIPT_ID}/notes-panel?surface=editor&sceneId=${SCENE_ID}&scope=scene&noteType=all&ownership=all&detached=all`
    );
    expect(fragmentResponse.status).toBe(200);
    expect(fragmentResponse.text).toContain('data-notes-panel');
    expect(fragmentResponse.text).toContain('Detach me later');
  });

  it('lets reviewers edit their own notes only, while owners and editors can mutate any note', async () => {
    const reviewerAgent = supertest.agent(stack.app);
    const ownerAgent = supertest.agent(stack.app);
    const editorAgent = supertest.agent(stack.app);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    const reviewerCsrf = await getPageCsrfToken(reviewerAgent, '/app');
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const editorCsrf = await getPageCsrfToken(editorAgent, '/app');

    const reviewerOwnSave = await reviewerAgent
      .put(buildNotesUrl(`/${seedFixtures.notes.reviewer.publicId}/head`))
      .set('X-CSRF-Token', reviewerCsrf)
      .send({
        baseHeadRevision: 1,
        text: 'Reviewer can keep editing their own seed note.'
      });
    expect(reviewerOwnSave.status).toBe(200);

    const reviewerOtherSave = await reviewerAgent
      .put(buildNotesUrl(`/${seedFixtures.notes.owner.publicId}/head`))
      .set('X-CSRF-Token', reviewerCsrf)
      .send({
        baseHeadRevision: 1,
        text: 'This should be forbidden.'
      });
    expect(reviewerOtherSave.status).toBe(403);

    const tempReviewerNote = await createNote(reviewerAgent, reviewerCsrf, {
      containerType: 'project',
      containerId: PROJECT_ID,
      text: 'Temporary reviewer-owned note'
    });
    expect(tempReviewerNote.status).toBe(201);

    const ownerMoveResponse = await ownerAgent
      .patch(buildNotesUrl(`/${tempReviewerNote.body.data.note.id}`))
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        containerType: 'script',
        containerId: SCRIPT_ID,
        scriptId: SCRIPT_ID
      });
    expect(ownerMoveResponse.status).toBe(200);
    expect(ownerMoveResponse.body.data.note.container.type).toBe('script');

    const editorDeleteResponse = await editorAgent
      .delete(buildNotesUrl(`/${tempReviewerNote.body.data.note.id}`))
      .set('X-CSRF-Token', editorCsrf);
    expect(editorDeleteResponse.status).toBe(200);
    expect(editorDeleteResponse.body.data.deleted).toBe(true);

    const deletedNote = await Note.findOne({
      publicId: tempReviewerNote.body.data.note.id
    });
    expect(deletedNote).toBeNull();
  });

  it('persists note heads with optimistic concurrency and avoids activity or audit spam', async () => {
    const reviewerAgent = supertest.agent(stack.app);
    await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const csrfToken = await getPageCsrfToken(reviewerAgent, '/app');

    const createdNote = await createNote(reviewerAgent, csrfToken, {
      containerType: 'project',
      containerId: PROJECT_ID,
      text: 'Fresh head save target'
    });
    expect(createdNote.status).toBe(201);

    const activityBefore = await ActivityEvent.countDocuments();
    const auditBefore = await AuditLog.countDocuments();

    const saveResponse = await reviewerAgent
      .put(buildNotesUrl(`/${createdNote.body.data.note.id}/head`))
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 1,
        text: 'Fresh head save target v2'
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.data.headRevision).toBe(2);
    expect(await ActivityEvent.countDocuments()).toBe(activityBefore);
    expect(await AuditLog.countDocuments()).toBe(auditBefore);

    const staleResponse = await reviewerAgent
      .put(buildNotesUrl(`/${createdNote.body.data.note.id}/head`))
      .set('X-CSRF-Token', csrfToken)
      .send({
        baseHeadRevision: 1,
        text: 'stale write'
      });

    expect(staleResponse.status).toBe(409);
    expect(staleResponse.body.error.code).toBe('STALE_STATE');
    expect(staleResponse.body.error.details.headText).toBe('Fresh head save target v2');
  });

  it('emits note lifecycle and activity fanout on create and delete', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');
    const socket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);

    try {
      await emitWithAck(socket, 'project:join', {
        projectId: PROJECT_ID
      });

      const createdPromise = waitForEvent(
        socket,
        'note:created',
        ({ containerType }) => containerType === 'project'
      );
      const createdActivityPromise = waitForEvent(
        socket,
        'activity:new',
        ({ type }) => type === 'note.created'
      );

      const createdNote = await createNote(ownerAgent, csrfToken, {
        containerType: 'project',
        containerId: PROJECT_ID,
        text: 'Lifecycle socket note'
      });
      expect(createdNote.status).toBe(201);

      const createdEvent = await createdPromise;
      const createdActivity = await createdActivityPromise;
      expect(createdEvent.noteId).toBe(createdNote.body.data.note.id);
      expect(createdActivity.targetId).toBe(createdNote.body.data.note.id);

      const deletedPromise = waitForEvent(
        socket,
        'note:deleted',
        ({ noteId }) => noteId === createdNote.body.data.note.id
      );
      const deletedActivityPromise = waitForEvent(
        socket,
        'activity:new',
        ({ type, targetId }) =>
          type === 'note.deleted' && targetId === createdNote.body.data.note.id
      );

      const deleteResponse = await ownerAgent
        .delete(buildNotesUrl(`/${createdNote.body.data.note.id}`))
        .set('X-CSRF-Token', csrfToken);
      expect(deleteResponse.status).toBe(200);

      const deletedEvent = await deletedPromise;
      const deletedActivity = await deletedActivityPromise;
      expect(deletedEvent.noteId).toBe(createdNote.body.data.note.id);
      expect(deletedActivity.type).toBe('note.deleted');
    } finally {
      socket.close();
    }
  });

  it('follows anchors across scene saves, detaches when the text disappears, and supports manual reattach', async () => {
    const ownerAgent = supertest.agent(stack.app);
    await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const csrfToken = await getPageCsrfToken(ownerAgent, '/app');

    await saveSceneDocument(ownerAgent, csrfToken, canonicalSceneDocument);

    const createdNote = await createNote(ownerAgent, csrfToken, {
      containerType: 'scene',
      containerId: SCENE_ID,
      sceneId: SCENE_ID,
      scriptId: SCRIPT_ID,
      text: 'Anchor remap target',
      anchor: baseAnchorInput
    });
    expect(createdNote.status).toBe(201);

    await saveSceneDocument(ownerAgent, csrfToken, {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_anchor_demo',
          type: 'action',
          text: 'hands over without looking THE PACKAGE'
        },
        canonicalSceneDocument.blocks[1]
      ]
    });

    const movedNoteResponse = await ownerAgent.get(
      buildNotesUrl(`/${createdNote.body.data.note.id}`)
    );
    expect(movedNoteResponse.status).toBe(200);
    expect(movedNoteResponse.body.data.note.isDetached).toBe(false);
    expect(movedNoteResponse.body.data.note.anchor.startOffset).toBe(27);

    await saveSceneDocument(ownerAgent, csrfToken, {
      schemaVersion: 1,
      blocks: [
        {
          id: 'blk_anchor_demo',
          type: 'action',
          text: 'hands over without looking'
        },
        canonicalSceneDocument.blocks[1]
      ]
    });

    const detachedNoteResponse = await ownerAgent.get(
      buildNotesUrl(`/${createdNote.body.data.note.id}`)
    );
    expect(detachedNoteResponse.status).toBe(200);
    expect(detachedNoteResponse.body.data.note.isDetached).toBe(true);

    await saveSceneDocument(ownerAgent, csrfToken, canonicalSceneDocument);

    const reattachResponse = await ownerAgent
      .patch(buildNotesUrl(`/${createdNote.body.data.note.id}`))
      .set('X-CSRF-Token', csrfToken)
      .send({
        sceneId: SCENE_ID,
        anchor: {
          ...baseAnchorInput
        }
      });

    expect(reattachResponse.status).toBe(200);
    expect(reattachResponse.body.data.note.isDetached).toBe(false);
    expect(reattachResponse.body.data.note.anchor.blockId).toBe('blk_anchor_demo');
  });
});

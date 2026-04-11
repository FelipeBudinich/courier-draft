import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { io as createClient } from 'socket.io-client';
import supertest from 'supertest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { ActivityEvent, AuditLog, Scene, User } from '../../src/models/index.js';
import { sceneSessionManager } from '../../src/services/collab/scene-session-manager.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

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

const emitWithAck = (socket, eventName, payload) =>
  new Promise((resolve) => {
    socket.emit(eventName, payload, (ack) => {
      resolve(ack);
    });
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

const waitForCondition = async (callback, timeoutMs = 5_000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await callback();
    if (value) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for condition.');
};

const joinBaseRooms = async (socket) => {
  await emitWithAck(socket, 'project:join', {
    projectId: seedFixtures.project.publicId
  });
  await emitWithAck(socket, 'script:join', {
    projectId: seedFixtures.project.publicId,
    scriptId: seedFixtures.script.publicId
  });
};

const joinScene = (socket) =>
  emitWithAck(socket, 'scene:join', {
    projectId: seedFixtures.project.publicId,
    scriptId: seedFixtures.script.publicId,
    sceneId: seedFixtures.scenes.intro.publicId
  });

const createSyncStep1 = (ydoc) => {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return Buffer.from(encoding.toUint8Array(encoder));
};

const applySyncMessage = (ydoc, payload) => {
  const decoder = decoding.createDecoder(
    payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  );
  const encoder = encoding.createEncoder();

  while (decoding.hasContent(decoder)) {
    syncProtocol.readSyncMessage(decoder, encoder, ydoc, null, (error) => {
      throw error;
    });
  }

  return encoding.hasContent(encoder)
    ? Buffer.from(encoding.toUint8Array(encoder))
    : null;
};

const syncSceneState = async (socket) => {
  const ydoc = new Y.Doc();
  const syncReplyPromise = waitForEvent(
    socket,
    'scene:yjs-sync',
    ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
  );

  socket.emit('scene:yjs-sync', {
    sceneId: seedFixtures.scenes.intro.publicId,
    payload: createSyncStep1(ydoc)
  });

  const syncReply = await syncReplyPromise;
  const followUp = applySyncMessage(ydoc, syncReply.payload);

  if (followUp) {
    await emitWithAck(socket, 'scene:yjs-sync', {
      sceneId: seedFixtures.scenes.intro.publicId,
      payload: followUp
    });
  }

  return ydoc;
};

const createValidUpdate = (mapName, key, value) => {
  const ydoc = new Y.Doc();
  ydoc.getMap(mapName).set(key, value);
  return Buffer.from(Y.encodeStateAsUpdate(ydoc));
};

describe('scene collaboration realtime', () => {
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

  it('joins scenes with the right edit capability and rejects non-members', async () => {
    const outsider = await User.create({
      email: 'scene-outsider@courier.test',
      username: 'sceneoutsider',
      displayName: 'Scene Outsider',
      locale: 'en',
      preferences: {
        locale: 'en'
      }
    });

    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    const outsiderAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const reviewerLogin = await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);
    const outsiderLogin = await loginAsUser(outsiderAgent, outsider.email);

    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);
    const reviewerSocket = await connectSocket(stack.baseUrl, reviewerLogin.cookieHeader);
    const outsiderSocket = await connectSocket(stack.baseUrl, outsiderLogin.cookieHeader);

    try {
      await joinBaseRooms(ownerSocket);
      await joinBaseRooms(reviewerSocket);

      const ownerJoinedPromise = waitForEvent(
        ownerSocket,
        'scene:joined',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
      );
      const ownerAck = await joinScene(ownerSocket);
      const ownerJoined = await ownerJoinedPromise;

      expect(ownerAck.ok).toBe(true);
      expect(ownerAck.data.canEdit).toBe(true);
      expect(ownerJoined.canEdit).toBe(true);

      const reviewerJoinedPromise = waitForEvent(
        reviewerSocket,
        'scene:joined',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
      );
      const reviewerAck = await joinScene(reviewerSocket);
      const reviewerJoined = await reviewerJoinedPromise;

      expect(reviewerAck.ok).toBe(true);
      expect(reviewerAck.data.canEdit).toBe(false);
      expect(reviewerJoined.canEdit).toBe(false);

      const outsiderAck = await emitWithAck(outsiderSocket, 'scene:join', {
        projectId: seedFixtures.project.publicId,
        scriptId: seedFixtures.script.publicId,
        sceneId: seedFixtures.scenes.intro.publicId
      });

      expect(outsiderAck.ok).toBe(false);
      expect(outsiderAck.error.code).toBe('FORBIDDEN');
    } finally {
      ownerSocket.close();
      reviewerSocket.close();
      outsiderSocket.close();
    }
  });

  it('syncs Yjs scene state, broadcasts document updates, and resyncs reconnecting clients', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const editorAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const editorLogin = await loginAsUser(editorAgent, seedFixtures.users.editor.email);

    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);
    const editorSocket = await connectSocket(stack.baseUrl, editorLogin.cookieHeader);

    try {
      await joinBaseRooms(ownerSocket);
      await joinBaseRooms(editorSocket);
      await joinScene(ownerSocket);
      await joinScene(editorSocket);

      const syncedDoc = await syncSceneState(editorSocket);
      expect(syncedDoc.share.has('prosemirror')).toBe(true);

      const updatePayload = createValidUpdate('reconnect-meta', 'token', 'scene-sync-token');
      const editorUpdatePromise = waitForEvent(
        editorSocket,
        'scene:yjs-update',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
      );

      const ownerUpdateAck = await emitWithAck(ownerSocket, 'scene:yjs-update', {
        sceneId: seedFixtures.scenes.intro.publicId,
        payload: updatePayload
      });

      expect(ownerUpdateAck.ok).toBe(true);
      const broadcast = await editorUpdatePromise;
      expect(broadcast.sceneId).toBe(seedFixtures.scenes.intro.publicId);

      editorSocket.close();

      const reconnectedEditorSocket = await connectSocket(stack.baseUrl, editorLogin.cookieHeader);
      try {
        await joinBaseRooms(reconnectedEditorSocket);
        await joinScene(reconnectedEditorSocket);

        const reconnectedDoc = await syncSceneState(reconnectedEditorSocket);
        expect(reconnectedDoc.getMap('reconnect-meta').get('token')).toBe('scene-sync-token');
      } finally {
        reconnectedEditorSocket.close();
      }
    } finally {
      ownerSocket.close();
    }
  });

  it('rejects reviewer document updates, broadcasts awareness, and publishes scene presence modes', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const reviewerLogin = await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);

    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);
    const reviewerSocket = await connectSocket(stack.baseUrl, reviewerLogin.cookieHeader);

    try {
      await joinBaseRooms(ownerSocket);
      await joinBaseRooms(reviewerSocket);
      await joinScene(ownerSocket);

      const presencePromise = waitForEvent(
        ownerSocket,
        'presence:view-changed',
        (payload) =>
          payload.userId === seedFixtures.users.reviewer.publicId &&
          payload.sceneId === seedFixtures.scenes.intro.publicId
      );
      const reviewerJoinAck = await joinScene(reviewerSocket);
      const reviewerPresence = await presencePromise;

      expect(reviewerJoinAck.ok).toBe(true);
      expect(reviewerJoinAck.data.canEdit).toBe(false);
      expect(reviewerPresence.mode).toBe('viewing');

      const awarenessDoc = new Y.Doc();
      const awareness = {
        clientID: awarenessDoc.clientID,
        states: new Map([
          [
            awarenessDoc.clientID,
            {
              user: {
                id: seedFixtures.users.reviewer.publicId,
                name: seedFixtures.users.reviewer.displayName
              },
              cursor: {
                anchor: 1,
                head: 1
              }
            }
          ]
        ])
      };
      const awarenessPayload = encoding.createEncoder();
      encoding.writeVarUint(awarenessPayload, 1);
      encoding.writeVarUint(awarenessPayload, awarenessDoc.clientID);
      encoding.writeVarUint(awarenessPayload, 1);
      encoding.writeVarString(
        awarenessPayload,
        JSON.stringify(awareness.states.get(awarenessDoc.clientID))
      );

      const awarenessBroadcastPromise = waitForEvent(
        ownerSocket,
        'scene:yjs-awareness',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
      );
      const awarenessAck = await emitWithAck(reviewerSocket, 'scene:yjs-awareness', {
        sceneId: seedFixtures.scenes.intro.publicId,
        payload: Buffer.from(encoding.toUint8Array(awarenessPayload))
      });

      expect(awarenessAck.ok).toBe(true);
      const awarenessBroadcast = await awarenessBroadcastPromise;
      expect(awarenessBroadcast.sceneId).toBe(seedFixtures.scenes.intro.publicId);

      const reviewerServerErrorPromise = waitForEvent(
        reviewerSocket,
        'server:error',
        ({ code, sceneId }) =>
          code === 'FORBIDDEN' && sceneId === seedFixtures.scenes.intro.publicId
      );
      const reviewerUpdateAck = await emitWithAck(reviewerSocket, 'scene:yjs-update', {
        sceneId: seedFixtures.scenes.intro.publicId,
        payload: createValidUpdate('forbidden-map', 'value', 'reviewer')
      });

      expect(reviewerUpdateAck.ok).toBe(false);
      expect(reviewerUpdateAck.error.code).toBe('FORBIDDEN');

      const reviewerServerError = await reviewerServerErrorPromise;
      expect(reviewerServerError.code).toBe('FORBIDDEN');
    } finally {
      ownerSocket.close();
      reviewerSocket.close();
    }
  });

  it('persists live scene state server-side, emits head-persisted, rejects HTTP head overwrites, and avoids activity or audit spam', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);

    try {
      await joinBaseRooms(ownerSocket);
      await joinScene(ownerSocket);

      const conflictResponse = await ownerAgent
        .put(
          `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/head`
        )
        .set('X-CSRF-Token', ownerCsrf)
        .send({
          baseHeadRevision: 0,
          document: {
            schemaVersion: 1,
            blocks: []
          }
        });

      expect(conflictResponse.status).toBe(409);
      expect(conflictResponse.body.error.code).toBe('CONFLICT');

      const activityCountBefore = await ActivityEvent.countDocuments();
      const auditCountBefore = await AuditLog.countDocuments();
      const revisionBefore =
        (await Scene.findOne({ publicId: seedFixtures.scenes.intro.publicId }))?.headRevision ?? 0;

      const persistedPromise = waitForEvent(
        ownerSocket,
        'scene:head-persisted',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId,
        10_000
      );

      const updateAck = await emitWithAck(ownerSocket, 'scene:yjs-update', {
        sceneId: seedFixtures.scenes.intro.publicId,
        payload: createValidUpdate('persist-map', 'value', 'dirty')
      });

      expect(updateAck.ok).toBe(true);

      const persistedPayload = await persistedPromise;
      expect(persistedPayload.sceneId).toBe(seedFixtures.scenes.intro.publicId);
      expect(persistedPayload.latestHeadRevision).toBeGreaterThan(revisionBefore);

      const savedScene = await waitForCondition(async () => {
        const scene = await Scene.findOne({
          publicId: seedFixtures.scenes.intro.publicId
        });

        return scene?.headRevision > revisionBefore ? scene : null;
      }, 10_000);

      expect(savedScene.updatedByUserId).toBeTruthy();
      expect(await ActivityEvent.countDocuments()).toBe(activityCountBefore);
      expect(await AuditLog.countDocuments()).toBe(auditCountBefore);
    } finally {
      ownerSocket.close();
    }
  });

  it('emits scene version events and replaces live scene session state during restore', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const editorAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const editorLogin = await loginAsUser(editorAgent, seedFixtures.users.editor.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);
    const editorSocket = await connectSocket(stack.baseUrl, editorLogin.cookieHeader);

    try {
      const scene = await Scene.findOne({
        publicId: seedFixtures.scenes.intro.publicId
      });
      const saveResponse = await ownerAgent
        .put(
          `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/head`
        )
        .set('X-CSRF-Token', ownerCsrf)
        .send({
          baseHeadRevision: scene?.headRevision ?? 0,
          document: {
            schemaVersion: 1,
            blocks: [
              {
                id: 'blk_intro_seed',
                type: 'action',
                text: 'Realtime version baseline.'
              }
            ]
          }
        });
      expect(saveResponse.status).toBe(200);

      await joinBaseRooms(ownerSocket);
      await joinBaseRooms(editorSocket);
      await joinScene(ownerSocket);
      await joinScene(editorSocket);

      const versionCreatedPromise = waitForEvent(
        editorSocket,
        'scene:version-created',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
      );
      const majorSaveResponse = await ownerAgent
        .post(
          `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/versions/major-save`
        )
        .set('X-CSRF-Token', ownerCsrf)
        .send({});
      expect(majorSaveResponse.status).toBe(201);

      const versionCreatedPayload = await versionCreatedPromise;
      expect(versionCreatedPayload.versionId).toBe(majorSaveResponse.body.data.version.id);

      await syncSceneState(ownerSocket);
      await syncSceneState(editorSocket);

      const liveUpdatePromise = waitForEvent(
        editorSocket,
        'scene:yjs-update',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
      );
      const liveUpdateAck = await emitWithAck(ownerSocket, 'scene:yjs-update', {
        sceneId: seedFixtures.scenes.intro.publicId,
        payload: createValidUpdate('restore-map', 'token', 'restore-me')
      });
      expect(liveUpdateAck.ok).toBe(true);
      await liveUpdatePromise;

      const versionRestoredPromise = waitForEvent(
        editorSocket,
        'scene:version-restored',
        ({ sceneId }) => sceneId === seedFixtures.scenes.intro.publicId
      );
      const restoreResponse = await ownerAgent
        .post(
          `/api/v1/projects/${seedFixtures.project.publicId}/scripts/${seedFixtures.script.publicId}/scenes/${seedFixtures.scenes.intro.publicId}/versions/ver_scene_intro_demo/restore`
        )
        .set('X-CSRF-Token', ownerCsrf)
        .send({});
      expect(restoreResponse.status).toBe(200);

      await versionRestoredPromise;

      const restoredDoc = await syncSceneState(editorSocket);
      expect(restoredDoc.getMap('restore-map').get('token')).toBeUndefined();
    } finally {
      ownerSocket.close();
      editorSocket.close();
    }
  });

  it('flushes on last disconnect and safely rejects invalid realtime payloads without crashing the session', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);

    try {
      await joinBaseRooms(ownerSocket);
      await joinScene(ownerSocket);

      const invalidErrorPromise = waitForEvent(
        ownerSocket,
        'server:error',
        ({ code, sceneId }) =>
          code === 'INVALID_PAYLOAD' && sceneId === seedFixtures.scenes.intro.publicId
      );
      const invalidAck = await emitWithAck(ownerSocket, 'scene:yjs-update', {
        sceneId: seedFixtures.scenes.intro.publicId,
        payload: Buffer.from([255])
      });

      expect(invalidAck.ok).toBe(false);
      expect(invalidAck.error.code).toBe('INVALID_PAYLOAD');
      await invalidErrorPromise;

      const revisionBefore =
        (await Scene.findOne({ publicId: seedFixtures.scenes.intro.publicId }))?.headRevision ?? 0;
      const validAck = await emitWithAck(ownerSocket, 'scene:yjs-update', {
        sceneId: seedFixtures.scenes.intro.publicId,
        payload: createValidUpdate('disconnect-map', 'value', 'flush')
      });

      expect(validAck.ok).toBe(true);

      ownerSocket.close();

      const savedScene = await waitForCondition(async () => {
        const scene = await Scene.findOne({
          publicId: seedFixtures.scenes.intro.publicId
        });

        return scene?.headRevision > revisionBefore ? scene : null;
      }, 10_000);

      expect(savedScene.headRevision).toBeGreaterThan(revisionBefore);
    } finally {
      if (ownerSocket.connected) {
        ownerSocket.close();
      }
    }
  });
});

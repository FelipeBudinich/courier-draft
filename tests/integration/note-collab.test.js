import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { io as createClient } from 'socket.io-client';
import supertest from 'supertest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { ActivityEvent, AuditLog, Note, User } from '../../src/models/index.js';
import { noteSessionManager } from '../../src/services/collab/note-session-manager.js';
import {
  getPageCsrfToken,
  loginAsUser,
  seedFixtures,
  startTestStack
} from '../support/helpers.js';

const PROJECT_ID = seedFixtures.project.publicId;
const OWNER_NOTE_ID = seedFixtures.notes.owner.publicId;
const REVIEWER_NOTE_ID = seedFixtures.notes.reviewer.publicId;

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

const waitForEvent = (socket, eventName, predicate = () => true, timeoutMs = 8_000) =>
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

const waitForCondition = async (callback, timeoutMs = 8_000) => {
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

const syncNoteState = async (socket, noteId) => {
  const ydoc = new Y.Doc();
  const syncReplyPromise = waitForEvent(
    socket,
    'note:yjs-sync',
    ({ noteId: eventNoteId }) => eventNoteId === noteId
  );

  socket.emit('note:yjs-sync', {
    noteId,
    payload: createSyncStep1(ydoc)
  });

  const syncReply = await syncReplyPromise;
  const followUp = applySyncMessage(ydoc, syncReply.payload);

  if (followUp) {
    await emitWithAck(socket, 'note:yjs-sync', {
      noteId,
      payload: followUp
    });
  }

  return ydoc;
};

const createIncrementalTextUpdate = (ydoc, nextText) => {
  const updates = [];
  const handler = (update) => {
    updates.push(update);
  };

  ydoc.on('update', handler);
  const ytext = ydoc.getText('content');
  ydoc.transact(() => {
    if (ytext.length) {
      ytext.delete(0, ytext.length);
    }

    if (nextText.length) {
      ytext.insert(0, nextText);
    }
  });
  ydoc.off('update', handler);

  return Buffer.from(updates.at(-1));
};

describe('note collaboration realtime', () => {
  let stack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterEach(() => {
    noteSessionManager.clear();
  });

  afterAll(async () => {
    if (stack) {
      await stack.close();
    }
  });

  it('joins readable note rooms with the right canEdit capability and rejects non-members', async () => {
    const outsider = await User.create({
      email: 'note-outsider@courier.test',
      username: 'noteoutsider',
      displayName: 'Note Outsider',
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
      const ownerJoinAck = await emitWithAck(ownerSocket, 'note:join', {
        projectId: PROJECT_ID,
        noteId: OWNER_NOTE_ID
      });
      expect(ownerJoinAck.ok).toBe(true);
      expect(ownerJoinAck.data.canEdit).toBe(true);

      const reviewerOwnJoinAck = await emitWithAck(reviewerSocket, 'note:join', {
        projectId: PROJECT_ID,
        noteId: REVIEWER_NOTE_ID
      });
      expect(reviewerOwnJoinAck.ok).toBe(true);
      expect(reviewerOwnJoinAck.data.canEdit).toBe(true);

      const reviewerReadOnlyJoinAck = await emitWithAck(reviewerSocket, 'note:join', {
        projectId: PROJECT_ID,
        noteId: OWNER_NOTE_ID
      });
      expect(reviewerReadOnlyJoinAck.ok).toBe(true);
      expect(reviewerReadOnlyJoinAck.data.canEdit).toBe(false);

      const outsiderJoinAck = await emitWithAck(outsiderSocket, 'note:join', {
        projectId: PROJECT_ID,
        noteId: OWNER_NOTE_ID
      });
      expect(outsiderJoinAck.ok).toBe(false);
      expect(outsiderJoinAck.error.code).toBe('FORBIDDEN');
    } finally {
      ownerSocket.close();
      reviewerSocket.close();
      outsiderSocket.close();
    }
  });

  it('broadcasts note updates to other viewers and blocks read-only mutations', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const reviewerAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const reviewerLogin = await loginAsUser(reviewerAgent, seedFixtures.users.reviewer.email);

    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);
    const reviewerSocket = await connectSocket(stack.baseUrl, reviewerLogin.cookieHeader);

    try {
      await emitWithAck(ownerSocket, 'note:join', {
        projectId: PROJECT_ID,
        noteId: OWNER_NOTE_ID
      });
      await emitWithAck(reviewerSocket, 'note:join', {
        projectId: PROJECT_ID,
        noteId: OWNER_NOTE_ID
      });

      const ownerDoc = await syncNoteState(ownerSocket, OWNER_NOTE_ID);
      await syncNoteState(reviewerSocket, OWNER_NOTE_ID);

      const reviewerUpdatePromise = waitForEvent(
        reviewerSocket,
        'note:yjs-update',
        ({ noteId }) => noteId === OWNER_NOTE_ID
      );
      const ownerUpdateAck = await emitWithAck(ownerSocket, 'note:yjs-update', {
        noteId: OWNER_NOTE_ID,
        payload: createIncrementalTextUpdate(ownerDoc, 'Owner collaborative note body')
      });

      expect(ownerUpdateAck.ok).toBe(true);
      const reviewerBroadcast = await reviewerUpdatePromise;
      expect(reviewerBroadcast.noteId).toBe(OWNER_NOTE_ID);

      const reviewerServerErrorPromise = waitForEvent(
        reviewerSocket,
        'server:error',
        ({ code, noteId }) => code === 'FORBIDDEN' && noteId === OWNER_NOTE_ID
      );
      const reviewerDoc = await syncNoteState(reviewerSocket, OWNER_NOTE_ID);
      const reviewerUpdateAck = await emitWithAck(reviewerSocket, 'note:yjs-update', {
        noteId: OWNER_NOTE_ID,
        payload: createIncrementalTextUpdate(reviewerDoc, 'Reviewer should not write this')
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

  it('persists note heads from Yjs sessions, emits head-persisted, rejects live HTTP overwrites, and avoids activity or audit spam', async () => {
    const ownerAgent = supertest.agent(stack.app);
    const ownerLogin = await loginAsUser(ownerAgent, seedFixtures.users.owner.email);
    const ownerCsrf = await getPageCsrfToken(ownerAgent, '/app');
    const ownerSocket = await connectSocket(stack.baseUrl, ownerLogin.cookieHeader);

    try {
      const joinAck = await emitWithAck(ownerSocket, 'note:join', {
        projectId: PROJECT_ID,
        noteId: OWNER_NOTE_ID
      });
      expect(joinAck.ok).toBe(true);

      const conflictResponse = await ownerAgent
        .put(`/api/v1/projects/${PROJECT_ID}/notes/${OWNER_NOTE_ID}/head`)
        .set('X-CSRF-Token', ownerCsrf)
        .send({
          baseHeadRevision: 1,
          text: 'HTTP overwrite should conflict while live collaboration is active.'
        });

      expect(conflictResponse.status).toBe(409);
      expect(conflictResponse.body.error.code).toBe('CONFLICT');

      const activityBefore = await ActivityEvent.countDocuments();
      const auditBefore = await AuditLog.countDocuments();
      const revisionBefore =
        (await Note.findOne({ publicId: OWNER_NOTE_ID }))?.headRevision ?? 0;

      const ownerDoc = await syncNoteState(ownerSocket, OWNER_NOTE_ID);
      const persistedPromise = waitForEvent(
        ownerSocket,
        'note:head-persisted',
        ({ noteId }) => noteId === OWNER_NOTE_ID,
        10_000
      );

      const ownerUpdateAck = await emitWithAck(ownerSocket, 'note:yjs-update', {
        noteId: OWNER_NOTE_ID,
        payload: createIncrementalTextUpdate(ownerDoc, 'Live note body persisted from Yjs')
      });
      expect(ownerUpdateAck.ok).toBe(true);

      const persistedPayload = await persistedPromise;
      expect(persistedPayload.noteId).toBe(OWNER_NOTE_ID);
      expect(persistedPayload.latestHeadRevision).toBeGreaterThan(revisionBefore);

      const savedNote = await waitForCondition(async () => {
        const note = await Note.findOne({ publicId: OWNER_NOTE_ID });
        return note?.headRevision > revisionBefore ? note : null;
      }, 10_000);

      expect(savedNote.headText).toBe('Live note body persisted from Yjs');
      expect(await ActivityEvent.countDocuments()).toBe(activityBefore);
      expect(await AuditLog.countDocuments()).toBe(auditBefore);
    } finally {
      ownerSocket.close();
    }
  });
});

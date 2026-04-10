import { Server } from 'socket.io';
import { z } from 'zod';

import { logger } from '../config/logger.js';
import { User } from '../models/index.js';
import {
  findNoteByPublicId,
  findProjectMembershipByPublicId,
  findSceneByPublicId,
  findScriptByPublicId
} from '../models/lookups.js';
import { roleHelpers } from '../middleware/auth.js';
import { hasCompletedOnboarding } from '../services/auth/service.js';
import { noteSessionManager } from '../services/collab/note-session-manager.js';
import { sceneSessionManager } from '../services/collab/scene-session-manager.js';
import { registerRealtimeServer } from '../services/realtime/broadcaster.js';
import { roomHelpers } from './rooms.js';
import { presenceStore } from './presence-store.js';

const ackOk = (data) => ({ ok: true, data });
const ackError = (code, message, details) => ({
  ok: false,
  error: {
    code,
    message,
    ...(details ? { details } : {})
  }
});

const projectSchema = z.object({
  projectId: z.string().startsWith('prj_')
});

const scriptSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_')
});

const sceneSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_'),
  sceneId: z.string().startsWith('scn_')
});

const noteSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  noteId: z.string().startsWith('nte_')
});

const leaveSceneSchema = z.object({
  sceneId: z.string().startsWith('scn_')
});

const leaveNoteSchema = z.object({
  noteId: z.string().startsWith('nte_')
});

const binaryPayload = z.any().refine(
  (value) =>
    Buffer.isBuffer(value) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value),
  'Expected binary payload.'
);

const yjsSceneSchema = z.object({
  sceneId: z.string().startsWith('scn_'),
  payload: binaryPayload
});

const yjsNoteSchema = z.object({
  noteId: z.string().startsWith('nte_'),
  payload: binaryPayload
});

const presenceSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  scriptId: z.string().startsWith('scr_').nullable().optional(),
  sceneId: z.string().startsWith('scn_').nullable().optional(),
  noteId: z.string().startsWith('nte_').nullable().optional(),
  mode: z.enum(['viewing', 'editing', 'idle'])
});

const withValidation = async (schema, payload, ack, handler) => {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    ack?.(
      ackError('INVALID_PAYLOAD', 'Payload validation failed.', {
        issues: parsed.error.issues
      })
    );
    return;
  }

  await handler(parsed.data);
};

const toUint8Array = (payload) => {
  if (payload instanceof Uint8Array) {
    return payload;
  }

  if (Buffer.isBuffer(payload)) {
    return new Uint8Array(payload);
  }

  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  throw new Error('Expected binary payload.');
};

const emitAsyncServerError = (socket, code, message, details = {}) => {
  socket.emit('server:error', {
    code,
    message,
    ...details
  });
};

const emitPresenceViewChanged = (collab, projectId, entry) => {
  if (!entry) {
    return;
  }

  collab.to(roomHelpers.project(projectId)).emit('presence:view-changed', {
    userId: entry.userId,
    ...entry.view
  });
};

const emitPresenceLeave = (collab, projectId, userId) => {
  collab.to(roomHelpers.project(projectId)).emit('presence:user-left', {
    userId
  });
};

const handlePresenceExit = (collab, projectId, result, userId) => {
  if (!result) {
    return;
  }

  if (result.removed) {
    emitPresenceLeave(collab, projectId, userId);
    return;
  }

  emitPresenceViewChanged(collab, projectId, result.entry);
};

export const createRealtimeServer = ({ httpServer, sessionMiddleware }) => {
  const io = new Server(httpServer, {
    serveClient: true,
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.engine.use((req, res, next) => {
    sessionMiddleware(req, res, next);
  });

  const collab = io.of('/collab');

  collab.use(async (socket, next) => {
    const session = socket.request.session;
    const sessionUserId = session?.user?.id;

    if (!sessionUserId) {
      logger.warn({ socketId: socket.id }, 'Socket auth failed: no session user');
      return next(new Error('AUTH_REQUIRED'));
    }

    const user = await User.findById(sessionUserId);
    if (!user) {
      logger.warn({ socketId: socket.id, sessionUserId }, 'Socket auth failed: user missing');
      return next(new Error('AUTH_REQUIRED'));
    }

    if (!hasCompletedOnboarding(user)) {
      logger.warn(
        { socketId: socket.id, sessionUserId },
        'Socket auth failed: onboarding incomplete'
      );
      return next(new Error('ONBOARDING_REQUIRED'));
    }

    socket.data.user = user;
    socket.data.joinedProjectIds = new Set();
    socket.data.projectScopedRooms = new Map();
    socket.data.sceneContexts = new Map();
    socket.data.noteContexts = new Map();
    socket.data.activeSceneContext = null;
    socket.join(roomHelpers.user(user.publicId));
    next();
  });

  collab.on('connection', (socket) => {
    const user = socket.data.user;
    logger.info(
      { socketId: socket.id, userId: user.publicId },
      'Socket connected to /collab'
    );

    const leaveSceneRoom = async (sceneId) => {
      const context = socket.data.sceneContexts.get(sceneId);
      const awarenessRemoval = await sceneSessionManager.leave({
        sceneId,
        socketId: socket.id
      });

      if (awarenessRemoval) {
        collab.to(roomHelpers.scene(sceneId)).emit('scene:yjs-awareness', {
          sceneId,
          payload: Buffer.from(awarenessRemoval)
        });
      }

      socket.leave(roomHelpers.scene(sceneId));
      socket.data.projectScopedRooms.delete(roomHelpers.scene(sceneId));
      socket.data.sceneContexts.delete(sceneId);

      if (socket.data.activeSceneContext?.sceneId === sceneId && context) {
        const updatedPresence = presenceStore.clearSceneContext(
          context.projectId,
          user.publicId,
          socket.id,
          sceneId
        );

        emitPresenceViewChanged(collab, context.projectId, updatedPresence);
        socket.data.activeSceneContext = null;
      }
    };

    const leaveNoteRoom = async (noteId) => {
      const awarenessRemoval = await noteSessionManager.leave({
        noteId,
        socketId: socket.id
      });

      if (awarenessRemoval) {
        collab.to(roomHelpers.note(noteId)).emit('note:yjs-awareness', {
          noteId,
          payload: Buffer.from(awarenessRemoval)
        });
      }

      socket.leave(roomHelpers.note(noteId));
      socket.data.projectScopedRooms.delete(roomHelpers.note(noteId));
      socket.data.noteContexts.delete(noteId);
    };

    socket.on('project:join', async (payload, ack) => {
      await withValidation(projectSchema, payload, ack, async ({ projectId }) => {
        const { project, membership } = await findProjectMembershipByPublicId({
          projectPublicId: projectId,
          userId: user._id
        });

        if (!project || !membership) {
          return ack?.(
            ackError('FORBIDDEN', 'You do not have access to this project.')
          );
        }

        socket.join(roomHelpers.project(projectId));
        socket.data.joinedProjectIds.add(projectId);
        const { entry, isFirstConnection, snapshot } = presenceStore.joinProject(
          projectId,
          user,
          socket.id
        );

        if (isFirstConnection) {
          socket
            .to(roomHelpers.project(projectId))
            .emit('presence:user-joined', entry);
        }

        const data = {
          projectId,
          role: membership.role,
          presence: snapshot,
          serverTime: new Date().toISOString()
        };

        socket.emit('project:joined', data);
        socket.emit('presence:snapshot', {
          projectId,
          users: snapshot
        });
        ack?.(ackOk(data));
      });
    });

    socket.on('project:leave', async (payload, ack) => {
      await withValidation(projectSchema, payload, ack, async ({ projectId }) => {
        for (const [sceneId, context] of socket.data.sceneContexts.entries()) {
          if (context.projectId !== projectId) {
            continue;
          }

          await leaveSceneRoom(sceneId);
        }

        for (const [noteId, context] of socket.data.noteContexts.entries()) {
          if (context.projectId !== projectId) {
            continue;
          }

          await leaveNoteRoom(noteId);
        }

        socket.leave(roomHelpers.project(projectId));
        socket.data.joinedProjectIds.delete(projectId);

        for (const [roomName, scopedProjectId] of socket.data.projectScopedRooms.entries()) {
          if (scopedProjectId !== projectId) {
            continue;
          }

          socket.leave(roomName);
          socket.data.projectScopedRooms.delete(roomName);
        }

        const result = presenceStore.leaveProject(projectId, user.publicId, socket.id);
        handlePresenceExit(collab, projectId, result, user.publicId);

        ack?.(ackOk({ projectId }));
      });
    });

    socket.on('script:join', async (payload, ack) => {
      await withValidation(scriptSchema, payload, ack, async ({ projectId, scriptId }) => {
        const { project, membership } = await findProjectMembershipByPublicId({
          projectPublicId: projectId,
          userId: user._id
        });

        if (!project || !membership) {
          return ack?.(
            ackError('FORBIDDEN', 'You do not have access to this project.')
          );
        }

        const script = await findScriptByPublicId({
          projectId: project._id,
          scriptPublicId: scriptId
        });

        if (!script) {
          return ack?.(ackError('NOT_FOUND', 'Script not found.'));
        }

        socket.join(roomHelpers.script(scriptId));
        socket.data.projectScopedRooms.set(roomHelpers.script(scriptId), projectId);
        const updatedPresence = presenceStore.setScriptContext(
          projectId,
          user.publicId,
          socket.id,
          scriptId,
          'viewing'
        );

        emitPresenceViewChanged(collab, projectId, updatedPresence);

        const data = {
          projectId,
          scriptId,
          sceneNumberMode: script.sceneNumberMode,
          activeUsers: presenceStore.snapshotScript(projectId, scriptId)
        };

        socket.emit('script:joined', data);
        ack?.(ackOk(data));
      });
    });

    socket.on('script:leave', async (payload, ack) => {
      await withValidation(scriptSchema, payload, ack, async ({ projectId, scriptId }) => {
        for (const [sceneId, context] of socket.data.sceneContexts.entries()) {
          if (context.projectId === projectId && context.scriptId === scriptId) {
            await leaveSceneRoom(sceneId);
          }
        }

        socket.leave(roomHelpers.script(scriptId));
        socket.data.projectScopedRooms.delete(roomHelpers.script(scriptId));
        const updatedPresence = presenceStore.clearScriptContext(
          projectId,
          user.publicId,
          socket.id,
          scriptId
        );

        emitPresenceViewChanged(collab, projectId, updatedPresence);

        ack?.(ackOk({ scriptId }));
      });
    });

    socket.on('scene:join', async (payload, ack) => {
      await withValidation(sceneSchema, payload, ack, async ({ projectId, scriptId, sceneId }) => {
        const { project, membership } = await findProjectMembershipByPublicId({
          projectPublicId: projectId,
          userId: user._id
        });

        if (!project || !membership) {
          return ack?.(
            ackError('FORBIDDEN', 'You do not have access to this project.')
          );
        }

        const script = await findScriptByPublicId({
          projectId: project._id,
          scriptPublicId: scriptId
        });
        if (!script) {
          return ack?.(ackError('NOT_FOUND', 'Script not found.'));
        }

        const scene = await findSceneByPublicId({
          projectId: project._id,
          scriptId: script._id,
          scenePublicId: sceneId
        });

        if (!scene) {
          return ack?.(ackError('NOT_FOUND', 'Scene not found.'));
        }

        const canEdit = roleHelpers.canEditProjectContent(membership.role);
        const session = await sceneSessionManager.join({
          scene: {
            ...scene.toObject(),
            _id: scene._id,
            publicId: scene.publicId,
            projectPublicId: project.publicId,
            scriptPublicId: script.publicId
          },
          socketId: socket.id,
          user,
          canEdit
        });

        socket.join(roomHelpers.scene(sceneId));
        socket.data.projectScopedRooms.set(roomHelpers.scene(sceneId), projectId);
        socket.data.sceneContexts.set(sceneId, {
          projectId,
          scriptId,
          sceneId
        });
        socket.data.activeSceneContext = {
          projectId,
          scriptId,
          sceneId
        };

        const updatedPresence = presenceStore.setSceneContext(
          projectId,
          user.publicId,
          socket.id,
          scriptId,
          sceneId,
          canEdit ? 'editing' : 'viewing'
        );

        emitPresenceViewChanged(collab, projectId, updatedPresence);

        const data = {
          sceneId,
          canEdit,
          latestMajorVersionId: session.latestMajorVersionId,
          headUpdatedAt:
            session.lastPersistedAt?.toISOString?.() ?? new Date().toISOString()
        };

        socket.emit('scene:joined', data);
        ack?.(ackOk(data));
      });
    });

    socket.on('scene:leave', async (payload, ack) => {
      await withValidation(leaveSceneSchema, payload, ack, async ({ sceneId }) => {
        await leaveSceneRoom(sceneId);
        ack?.(ackOk({ sceneId }));
      });
    });

    socket.on('note:join', async (payload, ack) => {
      await withValidation(noteSchema, payload, ack, async ({ projectId, noteId }) => {
        const { project, membership } = await findProjectMembershipByPublicId({
          projectPublicId: projectId,
          userId: user._id
        });

        if (!project || !membership) {
          return ack?.(
            ackError('FORBIDDEN', 'You do not have access to this project.')
          );
        }

        const note = await findNoteByPublicId({
          projectId: project._id,
          notePublicId: noteId
        });

        if (!note) {
          return ack?.(ackError('NOT_FOUND', 'Note not found.'));
        }

        const canEdit = roleHelpers.canEditNote(
          membership.role,
          user._id,
          note.authorUserId
        );
        const session = await noteSessionManager.join({
          note,
          socketId: socket.id,
          user,
          canEdit
        });

        socket.join(roomHelpers.note(noteId));
        socket.data.projectScopedRooms.set(roomHelpers.note(noteId), projectId);
        socket.data.noteContexts.set(noteId, {
          projectId
        });
        const data = {
          noteId,
          canEdit,
          latestMajorVersionId: session.latestMajorVersionId,
          headUpdatedAt:
            session.lastPersistedAt?.toISOString?.() ?? new Date().toISOString(),
          isDetached: note.isDetached
        };

        socket.emit('note:joined', data);
        ack?.(ackOk(data));
      });
    });

    socket.on('note:leave', async (payload, ack) => {
      await withValidation(leaveNoteSchema, payload, ack, async ({ noteId }) => {
        await leaveNoteRoom(noteId);
        ack?.(ackOk({ noteId }));
      });
    });

    socket.on('presence:set-view', async (payload, ack) => {
      await withValidation(presenceSchema, payload, ack, async (view) => {
        if (!socket.rooms.has(roomHelpers.project(view.projectId))) {
          return ack?.(
            ackError(
              'FORBIDDEN',
              'Join the project room before setting presence.'
            )
          );
        }

        const updated = presenceStore.updateView(
          view.projectId,
          user.publicId,
          socket.id,
          view
        );
        if (!updated) {
          return ack?.(ackError('CONFLICT', 'Presence state was not initialized.'));
        }

        emitPresenceViewChanged(collab, view.projectId, updated);

        ack?.(ackOk(updated));
      });
    });

    socket.on('scene:yjs-sync', async (payload, ack) => {
      await withValidation(yjsSceneSchema, payload, ack, async ({ sceneId, payload: rawPayload }) => {
        const session = sceneSessionManager.get(sceneId);

        if (!session || !socket.data.sceneContexts.has(sceneId)) {
          return ack?.(
            ackError('FORBIDDEN', 'Join the scene room before syncing.')
          );
        }

        try {
          const reply = session.buildSyncReply(toUint8Array(rawPayload), {
            type: 'scene:yjs-sync',
            socketId: socket.id
          });

          if (reply) {
            socket.emit('scene:yjs-sync', {
              sceneId,
              payload: Buffer.from(reply)
            });
          }

          ack?.(ackOk({ sceneId }));
        } catch (error) {
          logger.warn(
            {
              socketId: socket.id,
              sceneId,
              error
            },
            'Invalid scene Yjs sync payload.'
          );
          emitAsyncServerError(
            socket,
            'INVALID_PAYLOAD',
            'Scene sync payload was invalid.',
            { sceneId }
          );
          ack?.(ackError('INVALID_PAYLOAD', 'Scene sync payload was invalid.'));
        }
      });
    });

    socket.on('scene:yjs-update', async (payload, ack) => {
      await withValidation(yjsSceneSchema, payload, ack, async ({ sceneId, payload: rawPayload }) => {
        const session = sceneSessionManager.get(sceneId);
        const member = session?.getMember(socket.id);

        if (!session || !member) {
          return ack?.(
            ackError('FORBIDDEN', 'Join the scene room before sending updates.')
          );
        }

        if (!member.canEdit) {
          emitAsyncServerError(
            socket,
            'FORBIDDEN',
            'You do not have permission to edit this scene.',
            { sceneId }
          );
          return ack?.(
            ackError('FORBIDDEN', 'You do not have permission to edit this scene.')
          );
        }

        try {
          const binaryPayload = toUint8Array(rawPayload);
          session.applyDocumentUpdate(binaryPayload, {
            socketId: socket.id,
            actor: user
          });

          socket.to(roomHelpers.scene(sceneId)).emit('scene:yjs-update', {
            sceneId,
            payload: Buffer.from(binaryPayload)
          });

          ack?.(ackOk({ sceneId }));
        } catch (error) {
          logger.warn(
            {
              socketId: socket.id,
              sceneId,
              error
            },
            'Invalid scene Yjs update payload.'
          );
          emitAsyncServerError(
            socket,
            'INVALID_PAYLOAD',
            'Scene update payload was invalid.',
            { sceneId }
          );
          ack?.(ackError('INVALID_PAYLOAD', 'Scene update payload was invalid.'));
        }
      });
    });

    socket.on('scene:yjs-awareness', async (payload, ack) => {
      await withValidation(yjsSceneSchema, payload, ack, async ({ sceneId, payload: rawPayload }) => {
        const session = sceneSessionManager.get(sceneId);

        if (!session || !socket.data.sceneContexts.has(sceneId)) {
          return ack?.(
            ackError('FORBIDDEN', 'Join the scene room before sending awareness.')
          );
        }

        try {
          const binaryPayload = toUint8Array(rawPayload);
          session.applyAwarenessUpdate(binaryPayload, {
            socketId: socket.id
          });

          socket.to(roomHelpers.scene(sceneId)).emit('scene:yjs-awareness', {
            sceneId,
            payload: Buffer.from(binaryPayload)
          });

          ack?.(ackOk({ sceneId }));
        } catch (error) {
          logger.warn(
            {
              socketId: socket.id,
              sceneId,
              error
            },
            'Invalid scene Yjs awareness payload.'
          );
          emitAsyncServerError(
            socket,
            'INVALID_PAYLOAD',
            'Scene awareness payload was invalid.',
            { sceneId }
          );
          ack?.(ackError('INVALID_PAYLOAD', 'Scene awareness payload was invalid.'));
        }
      });
    });

    socket.on('note:yjs-sync', async (payload, ack) => {
      await withValidation(yjsNoteSchema, payload, ack, async ({ noteId, payload: rawPayload }) => {
        const session = noteSessionManager.get(noteId);

        if (!session || !socket.data.noteContexts.has(noteId)) {
          return ack?.(
            ackError('FORBIDDEN', 'Join the note room before syncing.')
          );
        }

        try {
          const reply = session.buildSyncReply(toUint8Array(rawPayload), {
            type: 'note:yjs-sync',
            socketId: socket.id
          });

          if (reply) {
            socket.emit('note:yjs-sync', {
              noteId,
              payload: Buffer.from(reply)
            });
          }

          ack?.(ackOk({ noteId }));
        } catch (error) {
          logger.warn(
            {
              socketId: socket.id,
              noteId,
              error
            },
            'Invalid note Yjs sync payload.'
          );
          emitAsyncServerError(
            socket,
            'INVALID_PAYLOAD',
            'Note sync payload was invalid.',
            { noteId }
          );
          ack?.(ackError('INVALID_PAYLOAD', 'Note sync payload was invalid.'));
        }
      });
    });

    socket.on('note:yjs-update', async (payload, ack) => {
      await withValidation(yjsNoteSchema, payload, ack, async ({ noteId, payload: rawPayload }) => {
        const session = noteSessionManager.get(noteId);
        const member = session?.getMember(socket.id);

        if (!session || !member) {
          return ack?.(
            ackError('FORBIDDEN', 'Join the note room before sending updates.')
          );
        }

        if (!member.canEdit) {
          emitAsyncServerError(
            socket,
            'FORBIDDEN',
            'You do not have permission to edit this note.',
            { noteId }
          );
          return ack?.(
            ackError('FORBIDDEN', 'You do not have permission to edit this note.')
          );
        }

        try {
          const binaryPayload = toUint8Array(rawPayload);
          session.applyTextUpdate(binaryPayload, {
            socketId: socket.id,
            actor: user
          });

          socket.to(roomHelpers.note(noteId)).emit('note:yjs-update', {
            noteId,
            payload: Buffer.from(binaryPayload)
          });

          ack?.(ackOk({ noteId }));
        } catch (error) {
          logger.warn(
            {
              socketId: socket.id,
              noteId,
              error
            },
            'Invalid note Yjs update payload.'
          );
          emitAsyncServerError(
            socket,
            'INVALID_PAYLOAD',
            'Note update payload was invalid.',
            { noteId }
          );
          ack?.(ackError('INVALID_PAYLOAD', 'Note update payload was invalid.'));
        }
      });
    });

    socket.on('note:yjs-awareness', async (payload, ack) => {
      await withValidation(yjsNoteSchema, payload, ack, async ({ noteId, payload: rawPayload }) => {
        const session = noteSessionManager.get(noteId);

        if (!session || !socket.data.noteContexts.has(noteId)) {
          return ack?.(
            ackError('FORBIDDEN', 'Join the note room before sending awareness.')
          );
        }

        try {
          const binaryPayload = toUint8Array(rawPayload);
          session.applyAwarenessUpdate(binaryPayload, {
            socketId: socket.id
          });

          socket.to(roomHelpers.note(noteId)).emit('note:yjs-awareness', {
            noteId,
            payload: Buffer.from(binaryPayload)
          });

          ack?.(ackOk({ noteId }));
        } catch (error) {
          logger.warn(
            {
              socketId: socket.id,
              noteId,
              error
            },
            'Invalid note Yjs awareness payload.'
          );
          emitAsyncServerError(
            socket,
            'INVALID_PAYLOAD',
            'Note awareness payload was invalid.',
            { noteId }
          );
          ack?.(ackError('INVALID_PAYLOAD', 'Note awareness payload was invalid.'));
        }
      });
    });

    socket.on('disconnect', () => {
      void (async () => {
        for (const sceneId of [...socket.data.sceneContexts.keys()]) {
          await leaveSceneRoom(sceneId);
        }

        for (const noteId of [...socket.data.noteContexts.keys()]) {
          await leaveNoteRoom(noteId);
        }

        const results = presenceStore.leaveAll(socket.id, user.publicId);
        for (const result of results) {
          handlePresenceExit(collab, result.projectId, result, user.publicId);
        }

        logger.info(
          { socketId: socket.id, userId: user.publicId },
          'Socket disconnected from /collab'
        );
      })();
    });
  });

  registerRealtimeServer(io);
  return io;
};

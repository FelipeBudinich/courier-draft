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
      logger.warn({ socketId: socket.id, sessionUserId }, 'Socket auth failed: onboarding incomplete');
      return next(new Error('ONBOARDING_REQUIRED'));
    }

    socket.data.user = user;
    socket.data.joinedProjectIds = new Set();
    socket.data.projectScopedRooms = new Map();
    socket.join(roomHelpers.user(user.publicId));
    next();
  });

  collab.on('connection', (socket) => {
    const user = socket.data.user;
    logger.info(
      { socketId: socket.id, userId: user.publicId },
      'Socket connected to /collab'
    );

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
          socket.to(roomHelpers.project(projectId)).emit('presence:user-joined', entry);
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
        socket.leave(roomHelpers.project(projectId));
        socket.data.joinedProjectIds.delete(projectId);

        for (const [roomName, scopedProjectId] of socket.data.projectScopedRooms.entries()) {
          if (scopedProjectId !== projectId) {
            continue;
          }

          socket.leave(roomName);
          socket.data.projectScopedRooms.delete(roomName);
        }

        const { removed } = presenceStore.leaveProject(projectId, user.publicId, socket.id);
        if (removed) {
          collab.to(roomHelpers.project(projectId)).emit('presence:user-left', {
            userId: user.publicId
          });
        }

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
          scriptId
        );
        if (updatedPresence) {
          collab.to(roomHelpers.project(projectId)).emit('presence:view-changed', {
            userId: user.publicId,
            ...updatedPresence.view
          });
        }

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
        socket.leave(roomHelpers.script(scriptId));
        socket.data.projectScopedRooms.delete(roomHelpers.script(scriptId));
        const updatedPresence = presenceStore.clearScriptContext(
          projectId,
          user.publicId,
          scriptId
        );
        if (updatedPresence) {
          collab.to(roomHelpers.project(projectId)).emit('presence:view-changed', {
            userId: user.publicId,
            ...updatedPresence.view
          });
        }

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

        socket.join(roomHelpers.scene(sceneId));
        socket.data.projectScopedRooms.set(roomHelpers.scene(sceneId), projectId);
        const data = {
          sceneId,
          canEdit: roleHelpers.canEditProjectContent(membership.role),
          latestMajorVersionId: scene.latestMajorVersionId
            ? String(scene.latestMajorVersionId)
            : null,
          headUpdatedAt: scene.headUpdatedAt.toISOString()
        };

        socket.emit('scene:joined', data);
        ack?.(ackOk(data));
      });
    });

    socket.on('scene:leave', async (payload, ack) => {
      await withValidation(leaveSceneSchema, payload, ack, async ({ sceneId }) => {
        socket.leave(roomHelpers.scene(sceneId));
        socket.data.projectScopedRooms.delete(roomHelpers.scene(sceneId));
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

        socket.join(roomHelpers.note(noteId));
        socket.data.projectScopedRooms.set(roomHelpers.note(noteId), projectId);
        const data = {
          noteId,
          canEdit: roleHelpers.canEditNote(membership.role, user._id, note.authorId),
          latestMajorVersionId: note.latestMajorVersionId
            ? String(note.latestMajorVersionId)
            : null,
          headUpdatedAt: note.headUpdatedAt.toISOString(),
          isDetached: note.isDetached
        };

        socket.emit('note:joined', data);
        ack?.(ackOk(data));
      });
    });

    socket.on('note:leave', async (payload, ack) => {
      await withValidation(leaveNoteSchema, payload, ack, async ({ noteId }) => {
        socket.leave(roomHelpers.note(noteId));
        socket.data.projectScopedRooms.delete(roomHelpers.note(noteId));
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

        const updated = presenceStore.updateView(view.projectId, user.publicId, view);
        if (!updated) {
          return ack?.(ackError('CONFLICT', 'Presence state was not initialized.'));
        }

        collab.to(roomHelpers.project(view.projectId)).emit('presence:view-changed', {
          userId: user.publicId,
          ...view
        });

        ack?.(ackOk(updated));
      });
    });

    const registerPlaceholderEvent = (eventName, schema) => {
      socket.on(eventName, async (payload, ack) => {
        await withValidation(schema, payload, ack, async () => {
          ack?.(
            ackError('SERVER_ERROR', 'Not implemented in foundation PR', {
              event: eventName
            })
          );
        });
      });
    };

    registerPlaceholderEvent('scene:yjs-sync', yjsSceneSchema);
    registerPlaceholderEvent('scene:yjs-update', yjsSceneSchema);
    registerPlaceholderEvent('scene:yjs-awareness', yjsSceneSchema);
    registerPlaceholderEvent('note:yjs-sync', yjsNoteSchema);
    registerPlaceholderEvent('note:yjs-update', yjsNoteSchema);
    registerPlaceholderEvent('note:yjs-awareness', yjsNoteSchema);

    socket.on('disconnect', () => {
      const removedProjects = presenceStore.leaveAll(socket.id, user.publicId);
      for (const projectId of removedProjects) {
        collab.to(roomHelpers.project(projectId)).emit('presence:user-left', {
          userId: user.publicId
        });
      }

      logger.info(
        { socketId: socket.id, userId: user.publicId },
        'Socket disconnected from /collab'
      );
    });
  });

  registerRealtimeServer(io);
  return io;
};

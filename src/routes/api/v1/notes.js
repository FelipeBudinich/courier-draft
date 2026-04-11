import { Router } from 'express';
import { z } from 'zod';

import { asyncRoute, conflict } from '../../../config/errors.js';
import {
  loadProjectMembership,
  requireAuth,
  requireNoteMutationAccess
} from '../../../middleware/auth.js';
import { loadNote } from '../../../middleware/resources.js';
import { validate } from '../../../middleware/validation.js';
import { noteSessionManager } from '../../../services/collab/note-session-manager.js';
import { emitToNoteRoom } from '../../../services/realtime/broadcaster.js';
import {
  listNoteVersions,
  majorSaveNote
} from '../../../services/versioning/checkpoint-service.js';
import { diffNoteVersions } from '../../../services/versioning/note-diff-service.js';
import { restoreNoteVersion } from '../../../services/versioning/restore-service.js';
import {
  createNote,
  deleteNote,
  getNoteDetail,
  listNotes,
  saveNoteHead,
  updateNoteMetadata
} from '../../../services/notes/service.js';
import { sendApiOk } from './helpers.js';

const router = Router();

const anchorInputSchema = z
  .object({
    sceneId: z.string().startsWith('scn_'),
    blockId: z.string().trim().min(1),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(0),
    selectedText: z.string(),
    contextBefore: z.string().optional(),
    contextAfter: z.string().optional(),
    createdFromSceneHeadRevision: z.number().int().min(0).optional()
  })
  .strict();

const noteParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  noteId: z.string().startsWith('nte_')
});

const noteVersionParamsSchema = z.object({
  projectId: z.string().startsWith('prj_'),
  noteId: z.string().startsWith('nte_'),
  versionId: z.string().startsWith('ver_')
});

const noteListParamsSchema = z.object({
  projectId: z.string().startsWith('prj_')
});

const noteCreateSchema = z
  .object({
    containerType: z.enum(['project', 'script', 'act', 'beat', 'scene']),
    containerId: z.string().trim().min(1),
    scriptId: z.string().startsWith('scr_').optional(),
    sceneId: z.string().startsWith('scn_').optional(),
    text: z.string(),
    anchor: anchorInputSchema.optional()
  })
  .strict();

const noteUpdateSchema = z
  .object({
    containerType: z.enum(['project', 'script', 'act', 'beat', 'scene']).optional(),
    containerId: z.string().trim().min(1).optional(),
    scriptId: z.string().startsWith('scr_').optional(),
    sceneId: z.string().startsWith('scn_').optional(),
    anchor: anchorInputSchema.optional(),
    detach: z.boolean().optional()
  })
  .strict();

const noteHeadSchema = z
  .object({
    baseHeadRevision: z.number().int().min(0),
    text: z.string()
  })
  .strict();

const noteListQuerySchema = z
  .object({
    containerType: z.enum(['project', 'script', 'act', 'beat', 'scene']).optional(),
    containerId: z.string().trim().min(1).optional(),
    sceneId: z.string().startsWith('scn_').optional(),
    scriptId: z.string().startsWith('scr_').optional(),
    authorUserId: z.string().startsWith('usr_').optional(),
    anchored: z.enum(['true', 'false']).optional(),
    detached: z.enum(['true', 'false']).optional()
  })
  .strict();

const compareSourceSchema = z
  .object({
    kind: z.enum(['currentHead', 'version']),
    versionId: z.string().startsWith('ver_').optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'version' && !value.versionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'versionId is required when kind=version.'
      });
    }
  });

const diffRequestSchema = z.union([
  z.object({}).strict(),
  z
    .object({
      left: compareSourceSchema,
      right: compareSourceSchema
    })
    .strict()
]);

router.get(
  '/projects/:projectId/notes',
  requireAuth,
  validate({ params: noteListParamsSchema, query: noteListQuerySchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const notes = await listNotes({
      project: req.project,
      projectRole: req.projectRole,
      currentUserId: req.currentUser._id,
      filters: req.query
    });

    sendApiOk(res, {
      notes
    });
  })
);

router.post(
  '/projects/:projectId/notes',
  requireAuth,
  validate({ params: noteListParamsSchema, body: noteCreateSchema }),
  loadProjectMembership,
  asyncRoute(async (req, res) => {
    const note = await createNote({
      project: req.project,
      actor: req.currentUser,
      projectRole: req.projectRole,
      input: req.body
    });

    sendApiOk(res, {
      note
    }, 201);
  })
);

router.get(
  '/projects/:projectId/notes/:noteId',
  requireAuth,
  validate({ params: noteParamsSchema }),
  loadProjectMembership,
  loadNote,
  asyncRoute(async (req, res) => {
    const note = await getNoteDetail({
      project: req.project,
      note: req.note,
      projectRole: req.projectRole,
      currentUserId: req.currentUser._id
    });

    sendApiOk(res, {
      note
    });
  })
);

router.patch(
  '/projects/:projectId/notes/:noteId',
  requireAuth,
  validate({ params: noteParamsSchema, body: noteUpdateSchema }),
  loadProjectMembership,
  loadNote,
  requireNoteMutationAccess,
  asyncRoute(async (req, res) => {
    const note = await updateNoteMetadata({
      project: req.project,
      note: req.note,
      actor: req.currentUser,
      projectRole: req.projectRole,
      input: req.body
    });

    sendApiOk(res, {
      note
    });
  })
);

router.delete(
  '/projects/:projectId/notes/:noteId',
  requireAuth,
  validate({ params: noteParamsSchema }),
  loadProjectMembership,
  loadNote,
  requireNoteMutationAccess,
  asyncRoute(async (req, res) => {
    const result = await deleteNote({
      project: req.project,
      note: req.note,
      actor: req.currentUser
    });

    sendApiOk(res, result);
  })
);

router.put(
  '/projects/:projectId/notes/:noteId/head',
  requireAuth,
  validate({ params: noteParamsSchema, body: noteHeadSchema }),
  loadProjectMembership,
  loadNote,
  requireNoteMutationAccess,
  asyncRoute(async (req, res) => {
    if (noteSessionManager.hasActiveSession(req.note.publicId)) {
      throw conflict('This note is currently managed by an active live collaboration session.');
    }

    const result = await saveNoteHead({
      note: req.note,
      actor: req.currentUser,
      baseHeadRevision: req.body.baseHeadRevision,
      text: req.body.text
    });

    emitToNoteRoom(req.note.publicId, 'note:head-persisted', {
      noteId: req.note.publicId,
      persistedAt: result.headUpdatedAt,
      latestHeadRevision: result.headRevision
    });

    sendApiOk(res, result);
  })
);

router.get(
  '/projects/:projectId/notes/:noteId/versions',
  requireAuth,
  validate({ params: noteParamsSchema }),
  loadProjectMembership,
  loadNote,
  asyncRoute(async (req, res) => {
    const versions = await listNoteVersions({
      note: req.note
    });

    sendApiOk(res, {
      versions
    });
  })
);

router.post(
  '/projects/:projectId/notes/:noteId/versions/major-save',
  requireAuth,
  validate({ params: noteParamsSchema }),
  loadProjectMembership,
  loadNote,
  requireNoteMutationAccess,
  asyncRoute(async (req, res) => {
    const result = await majorSaveNote({
      project: req.project,
      note: req.note,
      actor: req.currentUser
    });

    sendApiOk(
      res,
      {
        scriptVersion: result.scriptVersion
          ? {
              id: result.scriptVersion.publicId,
              versionLabel: result.scriptVersion.versionLabel,
              majorSaveSequence: result.scriptVersion.majorSaveSequence
            }
          : null,
        version: {
          id: result.createdVersions[0].version.publicId,
          versionLabel: result.createdVersions[0].version.versionLabel
        }
      },
      201
    );
  })
);

router.post(
  '/projects/:projectId/notes/:noteId/versions/:versionId/restore',
  requireAuth,
  validate({ params: noteVersionParamsSchema }),
  loadProjectMembership,
  loadNote,
  requireNoteMutationAccess,
  asyncRoute(async (req, res) => {
    const result = await restoreNoteVersion({
      project: req.project,
      note: req.note,
      actor: req.currentUser,
      versionId: req.params.versionId
    });

    sendApiOk(res, result);
  })
);

router.post(
  '/projects/:projectId/notes/:noteId/diff',
  requireAuth,
  validate({ params: noteParamsSchema, body: diffRequestSchema }),
  loadProjectMembership,
  loadNote,
  asyncRoute(async (req, res) => {
    const diff = await diffNoteVersions({
      project: req.project,
      note: req.note,
      compare:
        Object.keys(req.body ?? {}).length > 0
          ? req.body
          : null
    });

    sendApiOk(res, diff);
  })
);

export default router;

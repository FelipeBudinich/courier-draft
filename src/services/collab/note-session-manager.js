import { Note } from '../../models/index.js';
import { NoteSession } from './note-session.js';
import { createNoteYDocFromText } from './yjs-note-adapter.js';

const sessions = new Map();

const toSessionMetadata = (note) => ({
  _id: note._id,
  publicId: note.publicId,
  currentMajorVersionId: note.currentMajorVersionId ?? null,
  headUpdatedAt: note.headUpdatedAt,
  headRevision: note.headRevision ?? 0
});

export const noteSessionManager = {
  async ensureSession({ note }) {
    const existing = sessions.get(note.publicId);
    if (existing) {
      if (!existing.isLive()) {
        existing.destroy();
      } else {
        return existing;
      }
    }

    const hydratedNote =
      note.headText === undefined
        ? await Note.findById(note._id)
        : note;

    const session = NoteSession.create({
      note: toSessionMetadata(hydratedNote),
      text: hydratedNote.headText ?? '',
      createYDoc: createNoteYDocFromText,
      onDispose: (noteId) => {
        sessions.delete(noteId);
      }
    });

    sessions.set(hydratedNote.publicId, session);
    return session;
  },

  async join({ note, socketId, user, canEdit }) {
    const session = await this.ensureSession({ note });
    session.addMember({ socketId, user, canEdit });
    return session;
  },

  get(noteId) {
    return sessions.get(noteId) ?? null;
  },

  hasActiveSession(noteId) {
    return this.get(noteId)?.isLive() ?? false;
  },

  async leave({ noteId, socketId }) {
    const session = this.get(noteId);
    if (!session) {
      return null;
    }

    return session.leave(socketId);
  },

  clear() {
    for (const session of sessions.values()) {
      session.destroy();
    }

    sessions.clear();
  }
};

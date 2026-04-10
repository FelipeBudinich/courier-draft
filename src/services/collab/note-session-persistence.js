import { Note } from '../../models/index.js';

export const persistNoteSessionHead = async ({
  noteObjectId,
  actorId,
  text
}) => {
  const headUpdatedAt = new Date();
  const savedNote = await Note.findByIdAndUpdate(
    noteObjectId,
    {
      $set: {
        headText: text,
        headUpdatedAt,
        updatedByUserId: actorId
      },
      $inc: {
        headRevision: 1
      }
    },
    {
      new: true
    }
  ).exec();

  return {
    noteId: savedNote.publicId,
    headText: savedNote.headText,
    headRevision: savedNote.headRevision,
    headUpdatedAt: savedNote.headUpdatedAt
  };
};

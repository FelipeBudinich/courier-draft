import { notFound } from '../config/errors.js';
import { findNoteByPublicId, findSceneByPublicId, findScriptByPublicId } from '../models/lookups.js';

export const loadScript = (req, _res, next) => {
  Promise.resolve()
    .then(() =>
      findScriptByPublicId({
        projectId: req.project._id,
        scriptPublicId: req.params.scriptId
      })
    )
    .then((script) => {
      if (!script) {
        return next(notFound('Script not found.'));
      }

      req.script = script;
      next();
    })
    .catch(next);
};

export const loadScene = (req, _res, next) => {
  Promise.resolve()
    .then(() =>
      findSceneByPublicId({
        projectId: req.project._id,
        scriptId: req.script?._id,
        scenePublicId: req.params.sceneId
      })
    )
    .then((scene) => {
      if (!scene) {
        return next(notFound('Scene not found.'));
      }

      req.scene = scene;
      next();
    })
    .catch(next);
};

export const loadNote = (req, _res, next) => {
  Promise.resolve()
    .then(() =>
      findNoteByPublicId({
        projectId: req.project._id,
        notePublicId: req.params.noteId
      })
    )
    .then((note) => {
      if (!note) {
        return next(notFound('Note not found.'));
      }

      req.note = note;
      next();
    })
    .catch(next);
};

import { Note, Project, ProjectMember, Scene, Script } from './index.js';

export const findProjectMembershipByPublicId = async ({
  projectPublicId,
  userId
}) => {
  const project = await Project.findOne({ publicId: projectPublicId });
  if (!project) {
    return { project: null, membership: null };
  }

  const membership = await ProjectMember.findOne({
    projectId: project._id,
    userId
  });

  return { project, membership };
};

export const findScriptByPublicId = ({ projectId, scriptPublicId }) =>
  Script.findOne({
    projectId,
    publicId: scriptPublicId
  });

export const findSceneByPublicId = ({ projectId, scriptId, scenePublicId }) =>
  Scene.findOne({
    projectId,
    scriptId,
    publicId: scenePublicId
  });

export const findNoteByPublicId = ({ projectId, notePublicId }) =>
  Note.findOne({
    projectId,
    publicId: notePublicId
  });


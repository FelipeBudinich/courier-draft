import { Note, Project, ProjectEntity, ProjectMember, Scene, Script } from './index.js';

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
    userId,
    status: 'active'
  });

  return { project, membership };
};

export const findProjectByPublicId = ({ projectPublicId }) =>
  Project.findOne({
    publicId: projectPublicId
  });

export const findProjectMemberByPublicId = ({ projectId, memberPublicId }) =>
  ProjectMember.findOne({
    projectId,
    publicId: memberPublicId
  });

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

export const findProjectEntityByPublicId = ({ projectId, entityPublicId }) =>
  ProjectEntity.findOne({
    projectId,
    publicId: entityPublicId
  });

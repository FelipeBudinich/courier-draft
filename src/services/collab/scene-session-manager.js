import { getSceneHeadDocument } from '../scenes/legacy-document.js';
import { createSceneYDocFromCanonicalDocument } from './yjs-scene-adapter.js';
import { SceneSession } from './scene-session.js';

const sessions = new Map();

const toSessionMetadata = (scene) => ({
  _id: scene._id,
  publicId: scene.publicId,
  projectPublicId: scene.projectPublicId ?? scene.projectId?.publicId ?? null,
  scriptPublicId: scene.scriptPublicId ?? scene.scriptId?.publicId ?? null,
  currentMajorVersionId:
    scene.currentMajorVersionId ?? scene.latestMajorVersionId ?? null,
  headUpdatedAt: scene.headUpdatedAt,
  headRevision: scene.headRevision ?? 0
});

export const sceneSessionManager = {
  async ensureSession({ scene }) {
    const existing = sessions.get(scene.publicId);
    if (existing) {
      if (!existing.isLive()) {
        existing.destroy();
      } else {
        return existing;
      }
    }

    const session = SceneSession.create({
      scene: toSessionMetadata(scene),
      document: getSceneHeadDocument(scene),
      createYDoc: createSceneYDocFromCanonicalDocument,
      onDispose: (sceneId) => {
        sessions.delete(sceneId);
      }
    });

    sessions.set(scene.publicId, session);

    return session;
  },

  async join({ scene, socketId, user, canEdit }) {
    const session = await this.ensureSession({ scene });
    session.addMember({ socketId, user, canEdit });
    return session;
  },

  get(sceneId) {
    return sessions.get(sceneId) ?? null;
  },

  hasActiveSession(sceneId) {
    return this.get(sceneId)?.isLive() ?? false;
  },

  async leave({ sceneId, socketId }) {
    const session = this.get(sceneId);
    if (!session) {
      return null;
    }

    return session.leave(socketId);
  },

  async flushIfActive(sceneId, reason = 'manual') {
    const session = this.get(sceneId);

    if (!session) {
      return null;
    }

    return session.flush(reason);
  },

  materializeDocument(sceneId) {
    const session = this.get(sceneId);

    if (!session) {
      return null;
    }

    return session.materializeDocument();
  },

  replaceDocument(sceneId, payload) {
    const session = this.get(sceneId);

    if (!session) {
      return null;
    }

    return session.replaceDocument(payload);
  },

  updateCurrentMajorVersionId(sceneId, currentMajorVersionId) {
    const session = this.get(sceneId);

    if (!session) {
      return null;
    }

    session.updateVersionState({
      currentMajorVersionId
    });

    return session;
  },

  clear() {
    for (const session of sessions.values()) {
      session.destroy();
    }
    sessions.clear();
  }
};

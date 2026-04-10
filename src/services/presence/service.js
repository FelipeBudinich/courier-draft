const projectPresence = new Map();

const ensureProjectPresence = (projectId) => {
  if (!projectPresence.has(projectId)) {
    projectPresence.set(projectId, new Map());
  }

  return projectPresence.get(projectId);
};

const serializeEntry = (entry) => ({
  userId: entry.userId,
  username: entry.username,
  displayName: entry.displayName,
  avatarUrl: entry.avatarUrl ?? '',
  view: entry.view
});

export const presenceService = {
  clear() {
    projectPresence.clear();
  },

  joinProject(projectId, user, socketId) {
    const presence = ensureProjectPresence(projectId);
    const existing = presence.get(user.publicId);
    const socketIds = existing?.socketIds ?? new Set();
    const isFirstConnection = socketIds.size === 0;

    socketIds.add(socketId);

    const entry = {
      userId: user.publicId,
      username: user.username ?? null,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? '',
      view:
        existing?.view ??
        {
          projectId,
          scriptId: null,
          sceneId: null,
          noteId: null,
          mode: 'idle'
        },
      socketIds
    };

    presence.set(user.publicId, entry);

    return {
      entry: serializeEntry(entry),
      isFirstConnection,
      snapshot: [...presence.values()].map(serializeEntry)
    };
  },

  leaveProject(projectId, userId, socketId) {
    const presence = projectPresence.get(projectId);
    if (!presence) {
      return { removed: false, snapshot: [] };
    }

    const existing = presence.get(userId);
    if (!existing) {
      return {
        removed: false,
        snapshot: [...presence.values()].map(serializeEntry)
      };
    }

    existing.socketIds.delete(socketId);
    if (existing.socketIds.size === 0) {
      presence.delete(userId);
    }

    if (presence.size === 0) {
      projectPresence.delete(projectId);
    }

    return {
      removed: existing.socketIds.size === 0,
      snapshot: [...(projectPresence.get(projectId)?.values() ?? [])].map(serializeEntry)
    };
  },

  forceRemoveUser(projectId, userId) {
    const presence = projectPresence.get(projectId);
    if (!presence) {
      return { removed: false, snapshot: [] };
    }

    const removed = presence.delete(userId);
    if (presence.size === 0) {
      projectPresence.delete(projectId);
    }

    return {
      removed,
      snapshot: [...(projectPresence.get(projectId)?.values() ?? [])].map(serializeEntry)
    };
  },

  leaveAll(socketId, userId) {
    const removedProjects = [];

    for (const [projectId, presence] of projectPresence.entries()) {
      const existing = presence.get(userId);
      if (!existing) {
        continue;
      }

      existing.socketIds.delete(socketId);
      if (existing.socketIds.size === 0) {
        presence.delete(userId);
        removedProjects.push(projectId);
      }

      if (presence.size === 0) {
        projectPresence.delete(projectId);
      }
    }

    return removedProjects;
  },

  updateView(projectId, userId, view) {
    const presence = projectPresence.get(projectId);
    const existing = presence?.get(userId);
    if (!existing) {
      return null;
    }

    existing.view = view;
    return serializeEntry(existing);
  },

  setScriptContext(projectId, userId, scriptId) {
    const presence = projectPresence.get(projectId);
    const existing = presence?.get(userId);
    if (!existing) {
      return null;
    }

    existing.view = {
      ...existing.view,
      projectId,
      scriptId,
      sceneId: null,
      noteId: null,
      mode: existing.view?.mode ?? 'viewing'
    };

    return serializeEntry(existing);
  },

  clearScriptContext(projectId, userId, scriptId) {
    const presence = projectPresence.get(projectId);
    const existing = presence?.get(userId);
    if (!existing || existing.view?.scriptId !== scriptId) {
      return null;
    }

    existing.view = {
      ...existing.view,
      scriptId: null,
      sceneId: null,
      noteId: null,
      mode: existing.view?.mode ?? 'idle'
    };

    return serializeEntry(existing);
  },

  snapshot(projectId) {
    return [...(projectPresence.get(projectId)?.values() ?? [])].map(serializeEntry);
  },

  snapshotScript(projectId, scriptId) {
    return this.snapshot(projectId).filter((entry) => entry.view?.scriptId === scriptId);
  }
};

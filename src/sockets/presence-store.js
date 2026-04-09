const projectPresence = new Map();

const ensureProjectPresence = (projectId) => {
  if (!projectPresence.has(projectId)) {
    projectPresence.set(projectId, new Map());
  }

  return projectPresence.get(projectId);
};

export const presenceStore = {
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
      username: user.username,
      displayName: user.displayName,
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
      entry,
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

  snapshot(projectId) {
    return [...(projectPresence.get(projectId)?.values() ?? [])].map(serializeEntry);
  }
};

const serializeEntry = (entry) => ({
  userId: entry.userId,
  username: entry.username,
  displayName: entry.displayName,
  view: entry.view
});


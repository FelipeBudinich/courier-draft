const projectPresence = new Map();

const createIdleView = (projectId) => ({
  projectId,
  scriptId: null,
  sceneId: null,
  noteId: null,
  mode: 'idle'
});

const ensureProjectPresence = (projectId) => {
  if (!projectPresence.has(projectId)) {
    projectPresence.set(projectId, new Map());
  }

  return projectPresence.get(projectId);
};

const ensureEntry = (projectId, user) => {
  const presence = ensureProjectPresence(projectId);
  const existing = presence.get(user.publicId);

  if (existing) {
    return existing;
  }

  const entry = {
    userId: user.publicId,
    username: user.username ?? null,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? '',
    socketViews: new Map()
  };

  presence.set(user.publicId, entry);
  return entry;
};

const resolveVisibleView = (projectId, entry) => {
  const socketStates = [...entry.socketViews.values()];

  if (!socketStates.length) {
    return createIdleView(projectId);
  }

  return socketStates
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt)[0].view;
};

const serializeEntry = (projectId, entry) => ({
  userId: entry.userId,
  username: entry.username,
  displayName: entry.displayName,
  avatarUrl: entry.avatarUrl,
  view: resolveVisibleView(projectId, entry)
});

const removeProjectIfEmpty = (projectId) => {
  if (projectPresence.get(projectId)?.size === 0) {
    projectPresence.delete(projectId);
  }
};

const updateSocketView = (entry, socketId, view) => {
  entry.socketViews.set(socketId, {
    view,
    updatedAt: Date.now()
  });
};

export const presenceService = {
  clear() {
    projectPresence.clear();
  },

  joinProject(projectId, user, socketId) {
    const presence = ensureProjectPresence(projectId);
    const existing = presence.get(user.publicId);
    const isFirstConnection = !existing;
    const entry = ensureEntry(projectId, user);

    updateSocketView(
      entry,
      socketId,
      existing ? resolveVisibleView(projectId, entry) : createIdleView(projectId)
    );

    return {
      entry: serializeEntry(projectId, entry),
      isFirstConnection,
      snapshot: this.snapshot(projectId)
    };
  },

  leaveProject(projectId, userId, socketId) {
    const presence = projectPresence.get(projectId);
    const existing = presence?.get(userId);

    if (!presence || !existing) {
      return {
        removed: false,
        entry: null,
        snapshot: this.snapshot(projectId)
      };
    }

    existing.socketViews.delete(socketId);

    if (existing.socketViews.size === 0) {
      presence.delete(userId);
      removeProjectIfEmpty(projectId);
      return {
        removed: true,
        entry: null,
        snapshot: this.snapshot(projectId)
      };
    }

    return {
      removed: false,
      entry: serializeEntry(projectId, existing),
      snapshot: this.snapshot(projectId)
    };
  },

  forceRemoveUser(projectId, userId) {
    const presence = projectPresence.get(projectId);
    if (!presence) {
      return { removed: false, snapshot: [] };
    }

    const removed = presence.delete(userId);
    removeProjectIfEmpty(projectId);

    return {
      removed,
      snapshot: this.snapshot(projectId)
    };
  },

  leaveAll(socketId, userId) {
    const results = [];

    for (const projectId of projectPresence.keys()) {
      const result = this.leaveProject(projectId, userId, socketId);
      if (result.removed || result.entry) {
        results.push({
          projectId,
          ...result
        });
      }
    }

    return results;
  },

  updateView(projectId, userId, socketId, view) {
    const presence = projectPresence.get(projectId);
    const existing = presence?.get(userId);
    if (!existing) {
      return null;
    }

    updateSocketView(existing, socketId, view);
    return serializeEntry(projectId, existing);
  },

  setScriptContext(projectId, userId, socketId, scriptId, mode = 'viewing') {
    return this.updateView(projectId, userId, socketId, {
      projectId,
      scriptId,
      sceneId: null,
      noteId: null,
      mode
    });
  },

  clearScriptContext(projectId, userId, socketId, scriptId) {
    const presence = projectPresence.get(projectId);
    const existing = presence?.get(userId);
    const socketState = existing?.socketViews.get(socketId);

    if (!existing || !socketState || socketState.view?.scriptId !== scriptId) {
      return null;
    }

    updateSocketView(existing, socketId, createIdleView(projectId));
    return serializeEntry(projectId, existing);
  },

  setSceneContext(projectId, userId, socketId, scriptId, sceneId, mode) {
    return this.updateView(projectId, userId, socketId, {
      projectId,
      scriptId,
      sceneId,
      noteId: null,
      mode
    });
  },

  clearSceneContext(projectId, userId, socketId, sceneId) {
    const presence = projectPresence.get(projectId);
    const existing = presence?.get(userId);
    const socketState = existing?.socketViews.get(socketId);

    if (!existing || !socketState || socketState.view?.sceneId !== sceneId) {
      return null;
    }

    updateSocketView(existing, socketId, {
      ...socketState.view,
      sceneId: null,
      noteId: null,
      mode: socketState.view.scriptId ? 'viewing' : 'idle'
    });

    return serializeEntry(projectId, existing);
  },

  snapshot(projectId) {
    return [...(projectPresence.get(projectId)?.values() ?? [])].map((entry) =>
      serializeEntry(projectId, entry)
    );
  },

  snapshotScript(projectId, scriptId) {
    return this.snapshot(projectId).filter((entry) => entry.view?.scriptId === scriptId);
  },

  snapshotScene(projectId, sceneId) {
    return this.snapshot(projectId).filter((entry) => entry.view?.sceneId === sceneId);
  }
};

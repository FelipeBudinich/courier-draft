import { createCollabClient } from '../collab-client.js';
import { createCollabStateManager } from './collab-state.js';
import { createSaveStateUI } from './save-state-ui.js';
import { createSceneLoader } from './scene-loader.js';
import { SceneRealtimeProvider } from './realtime-provider.js';
import { ScreenplayEditor } from './screenplay-editor.js';

const createApiError = (payload, fallbackMessage) => {
  const error = new Error(payload?.error?.message ?? fallbackMessage);
  error.code = payload?.error?.code ?? 'SERVER_ERROR';
  error.details = payload?.error?.details ?? null;
  return error;
};

const emitWithAck = (socket, eventName, payload) =>
  new Promise((resolve, reject) => {
    socket.emit(eventName, payload, (ack) => {
      if (ack?.ok) {
        resolve(ack.data);
        return;
      }

      reject(createApiError(ack, `Socket event ${eventName} failed.`));
    });
  });

const readBootPayload = () => {
  const payloadElement = document.querySelector('[data-editor-boot]');

  if (!payloadElement?.textContent) {
    return null;
  }

  return JSON.parse(payloadElement.textContent);
};

const buildOutlineFragmentUrl = (projectId, scriptId, sceneId) => {
  const params = new URLSearchParams({
    surface: 'editor'
  });

  if (sceneId) {
    params.set('sceneId', sceneId);
  }

  return `/fragments/projects/${projectId}/scripts/${scriptId}/outline-tree?${params.toString()}`;
};

const syncSceneSelectionUi = (sceneId) => {
  document.querySelectorAll('[data-scene-link]').forEach((link) => {
    const isActive = link.dataset.sceneLink === sceneId;

    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  const select = document.querySelector('[data-scene-select]');

  if (select) {
    select.value = sceneId;
  }
};

const syncOutlineFragmentUrl = (projectId, scriptId, sceneId) => {
  const shell = document.querySelector('[data-script-shell]');

  if (!shell) {
    return;
  }

  shell.dataset.outlineFragmentUrl = buildOutlineFragmentUrl(projectId, scriptId, sceneId);
};

const getSceneDisplayTitle = (bootstrap, documentValue = null) => {
  const slugline = documentValue?.blocks?.find(
    (block) => block.type === 'slugline' && block.text?.trim()
  );

  return (
    slugline?.text ??
    bootstrap.scene.cachedSlugline ??
    bootstrap.scene.title
  );
};

const setSceneMeta = (elements, bootstrap, documentValue = null, canEdit = false) => {
  elements.sceneTitle.textContent = getSceneDisplayTitle(bootstrap, documentValue);
  elements.sceneNumber.textContent =
    bootstrap.scene.displayedSceneNumber ?? '—';
  elements.readOnlyBadge.hidden = canEdit;
};

const renderCollaborators = (elements, activeSceneId, collaborators, currentUserId) => {
  if (!elements.collaboratorSummary || !elements.collaboratorList) {
    return;
  }

  const sceneUsers = [...collaborators.values()].filter(
    (entry) =>
      entry.userId !== currentUserId &&
      entry.view?.sceneId === activeSceneId
  );

  if (!sceneUsers.length) {
    elements.collaboratorSummary.textContent = 'No collaborators are currently in this scene.';
    elements.collaboratorList.innerHTML = '';
    return;
  }

  elements.collaboratorSummary.textContent = `${sceneUsers.length} collaborator${sceneUsers.length === 1 ? '' : 's'} in this scene.`;
  elements.collaboratorList.innerHTML = sceneUsers
    .map(
      (entry) => `
        <article class="rounded-2xl border border-ink/10 bg-mist/50 px-3 py-3">
          <p class="font-semibold text-ink">${entry.displayName ?? entry.userId}</p>
          <p class="text-xs uppercase tracking-[0.18em] text-ink/45">${entry.view.mode}</p>
        </article>
      `
    )
    .join('');
};

const setEditorControls = ({ elements, canEdit, connected }) => {
  const enabled = canEdit && connected;

  elements.blockTypeSelect.disabled = !enabled;
  elements.dualDialogueButton.disabled = !enabled;
};

export const initEditorPage = () => {
  const page = document.querySelector('[data-editor-page]');

  if (!page) {
    return;
  }

  const boot = readBootPayload();

  if (!boot) {
    return;
  }

  const elements = {
    canvas: page.querySelector('[data-editor-canvas]'),
    sceneTitle: page.querySelector('[data-scene-title]'),
    sceneNumber: page.querySelector('[data-scene-number]'),
    statusPanel: page.querySelector('[data-save-status-panel]'),
    saveState: page.querySelector('[data-save-state-badge]'),
    lastSaved: page.querySelector('[data-last-saved]'),
    message: page.querySelector('[data-editor-message]'),
    reloadButton: page.querySelector('[data-reload-latest]'),
    readOnlyBadge: page.querySelector('[data-read-only-badge]'),
    blockTypeSelect: page.querySelector('[data-block-type-select]'),
    dualDialogueButton: page.querySelector('[data-insert-dual-dialogue]'),
    collaboratorSummary: page.querySelector('[data-collaborator-summary]'),
    collaboratorList: page.querySelector('[data-collaborator-list]'),
    connectionState: document.querySelector('[data-script-connection-state]')
  };

  const state = {
    bootstrap: boot,
    currentSceneId: boot.scene.publicId,
    runtime: null,
    collaborators: new Map(),
    needsResync: false
  };
  const socket = createCollabClient({
    namespace: boot.collaboration?.namespace ?? '/collab'
  });
  const sceneLoader = createSceneLoader({
    projectId: boot.project.publicId,
    scriptId: boot.script.publicId
  });
  const saveStateUi = createSaveStateUI({
    root: elements.statusPanel,
    statusElement: elements.saveState,
    timestampElement: elements.lastSaved,
    messageElement: elements.message,
    reloadButton: elements.reloadButton,
    labels: boot.ui.persistenceStates,
    locale: document.documentElement.lang || 'en',
    emptyLabel: elements.lastSaved.textContent.trim() || 'Not saved yet'
  });
  const collabState = createCollabStateManager({
    connectionElement: elements.connectionState,
    connectionLabels: boot.ui.connectionStates,
    saveStateUi
  });

  const renderPresence = () =>
    renderCollaborators(
      elements,
      state.currentSceneId,
      state.collaborators,
      state.bootstrap.currentUser?.id
    );

  const applyBootstrapMeta = (nextBootstrap, documentValue = null, canEdit = false) => {
    state.bootstrap = nextBootstrap;
    state.currentSceneId = nextBootstrap.scene.publicId;
    setSceneMeta(elements, nextBootstrap, documentValue, canEdit);
    syncSceneSelectionUi(nextBootstrap.scene.publicId);
    syncOutlineFragmentUrl(
      nextBootstrap.project.publicId,
      nextBootstrap.script.publicId,
      nextBootstrap.scene.publicId
    );
    renderPresence();
  };

  const joinBaseRooms = async () => {
    await emitWithAck(socket, 'project:join', {
      projectId: boot.project.publicId
    });
    await emitWithAck(socket, 'script:join', {
      projectId: boot.project.publicId,
      scriptId: boot.script.publicId
    });
  };

  const mountScene = async (
    nextBootstrap,
    { historyMode = 'push', leavePreviousScene = true } = {}
  ) => {
    let previousRuntime = state.runtime;
    const isSameSceneResync =
      previousRuntime &&
      previousRuntime.provider.sceneId === nextBootstrap.scene.publicId &&
      !leavePreviousScene;

    if (isSameSceneResync) {
      previousRuntime.editor.destroy();
      await previousRuntime.provider.dispose({
        leaveScene: false
      });
      previousRuntime = null;
      state.runtime = null;
    }

    const nextProvider = new SceneRealtimeProvider({
      socket,
      projectId: nextBootstrap.project.publicId,
      scriptId: nextBootstrap.script.publicId,
      sceneId: nextBootstrap.scene.publicId,
      currentUser: nextBootstrap.currentUser,
      canEdit: nextBootstrap.capabilities.canEdit,
      onLocalChange() {
        collabState.markUnsaved();
      },
      onPersisted(persistedAt) {
        collabState.markPersisted(persistedAt);
      },
      onPersistenceError(message) {
        collabState.markFailed(message);
      },
      onServerError(message) {
        collabState.showMessage(message);
      }
    });

    try {
      await nextProvider.connect();
    } catch (error) {
      await nextProvider.dispose({
        leaveScene: true
      });
      throw error;
    }

    previousRuntime?.editor?.destroy();

    const nextEditor = new ScreenplayEditor({
      mountElement: elements.canvas,
      readOnly: !nextProvider.canEdit,
      collaboration: {
        xmlFragment: nextProvider.getXmlFragment(),
        awareness: nextProvider.awareness
      },
      onChange(documentValue) {
        setSceneMeta(elements, nextBootstrap, documentValue, nextProvider.canEdit);
      },
      onSelectionChange(blockType) {
        if (elements.blockTypeSelect && blockType) {
          elements.blockTypeSelect.value = blockType;
        }
      }
    });

    state.runtime = {
      provider: nextProvider,
      editor: nextEditor
    };

    applyBootstrapMeta(
      nextBootstrap,
      nextEditor.getCanonicalDocument(),
      nextProvider.canEdit
    );
    collabState.clearMessage();
    collabState.setReadOnly(!nextProvider.canEdit, nextBootstrap.scene.headUpdatedAt);
    if (nextProvider.canEdit) {
      collabState.markPersisted(nextBootstrap.scene.headUpdatedAt);
    }
    setEditorControls({
      elements,
      canEdit: nextProvider.canEdit,
      connected: socket.connected
    });

    const nextUrl = sceneLoader.buildEditorUrl(nextBootstrap.scene.publicId);

    if (historyMode === 'replace') {
      window.history.replaceState(
        { sceneId: nextBootstrap.scene.publicId },
        '',
        nextUrl
      );
    } else {
      window.history.pushState(
        { sceneId: nextBootstrap.scene.publicId },
        '',
        nextUrl
      );
    }

    if (previousRuntime) {
      await previousRuntime.provider.dispose({
        leaveScene: leavePreviousScene
      });
    }
  };

  const navigateToScene = async (sceneId, historyMode = 'push') => {
    if (sceneId === state.currentSceneId) {
      return;
    }

    if (!socket.connected) {
      throw new Error('Reconnect before switching scenes.');
    }

    const bootstrapPayload = await sceneLoader.fetchBootstrap(sceneId);
    await mountScene(bootstrapPayload, {
      historyMode,
      leavePreviousScene: true
    });
  };

  const reloadCurrentScene = async () => {
    if (!socket.connected) {
      return;
    }

    const previousRuntime = state.runtime;
    state.runtime = null;

    if (previousRuntime) {
      previousRuntime.editor.destroy();
      await previousRuntime.provider.dispose({
        leaveScene: true
      });
    }

    const bootstrapPayload = await sceneLoader.fetchBootstrap(state.currentSceneId);
    await mountScene(bootstrapPayload, {
      historyMode: 'replace',
      leavePreviousScene: false
    });
  };

  socket.on('presence:snapshot', ({ users }) => {
    state.collaborators.clear();
    users.forEach((entry) => {
      state.collaborators.set(entry.userId, entry);
    });
    renderPresence();
  });

  socket.on('presence:user-joined', (entry) => {
    state.collaborators.set(entry.userId, entry);
    renderPresence();
  });

  socket.on('presence:user-left', ({ userId }) => {
    state.collaborators.delete(userId);
    renderPresence();
  });

  socket.on('presence:view-changed', (payload) => {
    const existing = state.collaborators.get(payload.userId) ?? {
      userId: payload.userId,
      displayName: payload.userId,
      username: null,
      avatarUrl: ''
    };

    existing.view = {
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      sceneId: payload.sceneId,
      noteId: payload.noteId,
      mode: payload.mode
    };
    state.collaborators.set(payload.userId, existing);
    renderPresence();
  });

  socket.on('project:access-revoked', ({ projectId }) => {
    if (projectId === boot.project.publicId) {
      window.location.assign('/app');
    }
  });

  socket.on('connect', async () => {
    collabState.setConnectionStatus('connected');

    try {
      await joinBaseRooms();

      if (!state.runtime) {
        await mountScene(state.bootstrap, {
          historyMode: 'replace',
          leavePreviousScene: false
        });
        return;
      }

      if (state.needsResync) {
        const bootstrapPayload = await sceneLoader.fetchBootstrap(state.currentSceneId);
        await mountScene(bootstrapPayload, {
          historyMode: 'replace',
          leavePreviousScene: false
        });
      }
    } catch (error) {
      collabState.setConnectionStatus('unavailable');
      collabState.showMessage(error.message);
    } finally {
      state.needsResync = false;
    }
  });

  socket.on('disconnect', () => {
    state.needsResync = true;
    collabState.setConnectionStatus('reconnecting');
    collabState.markReconnecting('Realtime connection lost. Reconnecting…');
    state.runtime?.editor?.setReadOnly(true);
    setEditorControls({
      elements,
      canEdit: state.runtime?.provider?.canEdit ?? boot.capabilities.canEdit,
      connected: false
    });
  });

  socket.on('connect_error', () => {
    collabState.setConnectionStatus('unavailable');
    collabState.showMessage('Realtime connection is unavailable.');
  });

  page.addEventListener('click', (event) => {
    const toggleButton = event.target.closest('[data-outline-toggle]');

    if (toggleButton) {
      const target = document.getElementById(toggleButton.dataset.outlineToggle);

      if (!target) {
        return;
      }

      const isOpen = toggleButton.getAttribute('aria-expanded') === 'true';
      toggleButton.setAttribute('aria-expanded', String(!isOpen));
      target.hidden = isOpen;
      return;
    }

    const sceneLink = event.target.closest('[data-scene-link]');

    if (
      !sceneLink ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();
    void navigateToScene(sceneLink.dataset.sceneLink).catch((error) => {
      collabState.showMessage(error.message);
    });
  });

  document
    .querySelector('[data-scene-select]')
    ?.addEventListener('change', (event) => {
      void navigateToScene(event.target.value).catch((error) => {
        collabState.showMessage(error.message);
      });
    });

  elements.blockTypeSelect.addEventListener('change', (event) => {
    if (!state.runtime?.provider?.canEdit || !socket.connected) {
      return;
    }

    state.runtime.editor.setCurrentBlockType(event.target.value);
    state.runtime.editor.focus();
  });

  elements.dualDialogueButton.addEventListener('click', () => {
    if (!state.runtime?.provider?.canEdit || !socket.connected) {
      return;
    }

    state.runtime.editor.insertDualDialogue();
    state.runtime.editor.focus();
  });

  elements.reloadButton.addEventListener('click', () => {
    void reloadCurrentScene().catch((error) => {
      collabState.showMessage(error.message);
    });
  });

  window.addEventListener('popstate', (event) => {
    const nextSceneId = event.state?.sceneId;

    if (!nextSceneId || nextSceneId === state.currentSceneId) {
      return;
    }

    void navigateToScene(nextSceneId, 'replace').catch((error) => {
      collabState.showMessage(error.message);
    });
  });

  window.addEventListener('beforeunload', () => {
    void state.runtime?.provider?.dispose({
      leaveScene: false
    });
    socket.emit('script:leave', {
      projectId: boot.project.publicId,
      scriptId: boot.script.publicId
    });
    socket.emit('project:leave', {
      projectId: boot.project.publicId
    });
    socket.close();
  });
};

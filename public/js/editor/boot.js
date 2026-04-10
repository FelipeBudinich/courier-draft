import { csrfFetch } from '../csrf-fetch.js';
import { createAutosaveController } from './autosave.js';
import { createSaveStateUI } from './save-state-ui.js';
import { createSceneLoader } from './scene-loader.js';
import { ScreenplayEditor } from './screenplay-editor.js';

const createApiError = (payload, fallbackMessage) => {
  const error = new Error(payload?.error?.message ?? fallbackMessage);
  error.code = payload?.error?.code ?? 'SERVER_ERROR';
  error.details = payload?.error?.details ?? null;
  return error;
};

const readBootPayload = () => {
  const payloadElement = document.querySelector('[data-editor-boot]');

  if (!payloadElement?.textContent) {
    return null;
  }

  return JSON.parse(payloadElement.textContent);
};

const buildSaveUrl = (projectId, scriptId, sceneId) =>
  `/api/v1/projects/${projectId}/scripts/${scriptId}/scenes/${sceneId}/head`;

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

const setSceneMeta = (elements, bootstrap) => {
  elements.sceneTitle.textContent =
    bootstrap.scene.cachedSlugline ?? bootstrap.scene.title;
  elements.sceneNumber.textContent =
    bootstrap.scene.displayedSceneNumber ?? '—';
  elements.readOnlyBadge.hidden = bootstrap.capabilities.canEdit;
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
    saveButton: page.querySelector('[data-save-now]')
  };
  const state = {
    bootstrap: boot,
    headRevision: boot.scene.headRevision,
    currentSceneId: boot.scene.publicId,
    canEdit: boot.capabilities.canEdit
  };
  const saveStateUi = createSaveStateUI({
    root: elements.statusPanel,
    statusElement: elements.saveState,
    timestampElement: elements.lastSaved,
    messageElement: elements.message,
    reloadButton: elements.reloadButton,
    labels: boot.ui.saveStates,
    locale: document.documentElement.lang || 'en'
  });
  const editor = new ScreenplayEditor({
    mountElement: elements.canvas,
    initialDocument: boot.document,
    readOnly: !state.canEdit,
    onChange(documentValue) {
      autosave.markDirty({
        document: documentValue
      });
    },
    onSelectionChange(blockType) {
      if (elements.blockTypeSelect && blockType) {
        elements.blockTypeSelect.value = blockType;
      }
    }
  });

  const saveSceneHead = async (payload, reason) => {
    const response = await csrfFetch(
      buildSaveUrl(boot.project.publicId, boot.script.publicId, state.currentSceneId),
      {
        method: 'PUT',
        keepalive: reason === 'pagehide' || reason === 'beforeunload',
        body: JSON.stringify({
          baseHeadRevision: state.headRevision,
          document: payload.document
        })
      }
    );
    const responsePayload = await response.json();

    if (!response.ok) {
      throw createApiError(responsePayload, 'Failed to save scene draft.');
    }

    state.headRevision = responsePayload.data.headRevision;
    return responsePayload.data;
  };

  const autosave = createAutosaveController({
    delayMs: 2000,
    save: saveSceneHead,
    onStateChange(nextState) {
      saveStateUi.update(nextState);
    }
  });

  const applyBootstrap = (nextBootstrap) => {
    state.bootstrap = nextBootstrap;
    state.headRevision = nextBootstrap.scene.headRevision;
    state.currentSceneId = nextBootstrap.scene.publicId;
    state.canEdit = nextBootstrap.capabilities.canEdit;
    editor.setReadOnly(!state.canEdit);
    editor.replaceDocument(nextBootstrap.document);
    autosave.reset({
      lastSavedAt: nextBootstrap.scene.headUpdatedAt,
      readOnly: !state.canEdit
    });
    elements.blockTypeSelect.disabled = !state.canEdit;
    elements.dualDialogueButton.disabled = !state.canEdit;
    elements.saveButton.disabled = !state.canEdit;
    setSceneMeta(elements, nextBootstrap);
    syncSceneSelectionUi(nextBootstrap.scene.publicId);
    syncOutlineFragmentUrl(
      nextBootstrap.project.publicId,
      nextBootstrap.script.publicId,
      nextBootstrap.scene.publicId
    );
  };

  const sceneLoader = createSceneLoader({
    projectId: boot.project.publicId,
    scriptId: boot.script.publicId,
    async onBeforeLoad(nextSceneId) {
      if (nextSceneId === state.currentSceneId) {
        return;
      }

      if (autosave.getState().status === 'stale') {
        throw createApiError(
          {
            error: {
              code: 'STALE_STATE',
              message: 'Reload the latest scene head before leaving this scene.'
            }
          },
          'Reload the latest scene head before leaving this scene.'
        );
      }

      if (autosave.hasPendingWork()) {
        await autosave.flush('scene-switch');
      }
    },
    onAfterLoad(nextBootstrap) {
      applyBootstrap(nextBootstrap);
    }
  });

  applyBootstrap(boot);
  window.history.replaceState(
    { sceneId: state.currentSceneId },
    '',
    sceneLoader.buildEditorUrl(state.currentSceneId)
  );

  const navigateToScene = async (sceneId, historyMode = 'push') => {
    try {
      await sceneLoader.loadScene(sceneId, { historyMode });
    } catch (error) {
      saveStateUi.showNavigationError(error.message);
      throw error;
    }
  };

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
    void navigateToScene(sceneLink.dataset.sceneLink);
  });

  document
    .querySelector('[data-scene-select]')
    ?.addEventListener('change', (event) => {
      void navigateToScene(event.target.value);
    });

  elements.blockTypeSelect.addEventListener('change', (event) => {
    if (!state.canEdit) {
      return;
    }

    editor.setCurrentBlockType(event.target.value);
    editor.focus();
  });

  elements.dualDialogueButton.addEventListener('click', () => {
    if (!state.canEdit) {
      return;
    }

    editor.insertDualDialogue();
    editor.focus();
  });

  elements.saveButton.addEventListener('click', () => {
    void autosave.flush('manual');
  });

  elements.reloadButton.addEventListener('click', () => {
    void sceneLoader.loadScene(state.currentSceneId, {
      historyMode: 'replace',
      skipBeforeLoad: true
    });
  });

  window.addEventListener('popstate', (event) => {
    const nextSceneId = event.state?.sceneId;

    if (!nextSceneId || nextSceneId === state.currentSceneId) {
      return;
    }

    void sceneLoader.loadScene(nextSceneId, {
      historyMode: 'replace'
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && autosave.hasPendingWork()) {
      void autosave.flush('pagehide').catch(() => {});
    }
  });

  window.addEventListener('pagehide', () => {
    if (autosave.hasPendingWork()) {
      void autosave.flush('pagehide').catch(() => {});
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!autosave.hasPendingWork()) {
      return;
    }

    void autosave.flush('beforeunload').catch(() => {});
    event.preventDefault();
    event.returnValue = '';
  });
};

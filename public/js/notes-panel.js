import { createCollabClient } from './collab-client.js';
import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson } from './form-helpers.js';

const DETAIL_EMPTY_MESSAGE = 'Select a note to view details.';
let noteRealtimeProviderModulePromise = null;

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const readBootPayload = (root) => {
  const payloadElement = root.querySelector('[data-notes-panel-boot]');

  if (!payloadElement?.textContent) {
    return null;
  }

  return JSON.parse(payloadElement.textContent);
};

const loadNoteRealtimeProvider = async () => {
  if (!noteRealtimeProviderModulePromise) {
    noteRealtimeProviderModulePromise = import('/build/note-room.js');
  }

  const module = await noteRealtimeProviderModulePromise;
  return module.NoteRealtimeProvider;
};

const buildFragmentUrl = (state) => {
  const url = new URL(state.shell.dataset.notesFragmentUrl, window.location.origin);
  const filterForm = state.root?.querySelector?.('[data-notes-filters]');
  const scope =
    filterForm?.elements?.scope?.value ??
    state.boot?.filters?.scope ??
    state.shell.dataset.notesScope ??
    'script';
  const ownership =
    filterForm?.elements?.ownership?.value ??
    state.boot?.filters?.ownership ??
    'all';
  const noteType =
    filterForm?.elements?.noteType?.value ??
    state.boot?.filters?.noteType ??
    'all';
  const detached =
    filterForm?.elements?.detached?.checked ||
    state.boot?.filters?.detached === 'detached'
      ? 'detached'
      : 'all';

  url.searchParams.set('surface', state.shell.dataset.notesSurface ?? 'script');
  url.searchParams.set('scope', scope);
  url.searchParams.set('ownership', ownership);
  url.searchParams.set('noteType', noteType);
  url.searchParams.set('detached', detached);

  if (state.shell.dataset.sceneId) {
    url.searchParams.set('sceneId', state.shell.dataset.sceneId);
  }

  return url.pathname + url.search;
};

const dispatchNotesListChanged = (state) => {
  window.dispatchEvent(
    new CustomEvent('courier:notes-list-changed', {
      detail: {
        shell: state.shell,
        notes: state.boot?.notes ?? [],
        sceneId: state.boot?.sceneId ?? null
      }
    })
  );
};

const dispatchSelectedNote = (state, note) => {
  window.dispatchEvent(
    new CustomEvent('courier:note-selected', {
      detail: {
        shell: state.shell,
        note
      }
    })
  );
};

const setCreateStatus = (state, message, isError = false) => {
  const status = state.root?.querySelector('[data-note-create-status]');
  if (!status) {
    return;
  }

  status.textContent = message ?? '';
  status.classList.toggle('text-red-700', isError);
  status.classList.toggle('text-ink/55', !isError);
};

const setDetailStatus = (state, message, isError = false) => {
  const status = state.root?.querySelector('[data-note-detail-status]');
  if (!status) {
    return;
  }

  status.textContent = message ?? '';
  status.classList.toggle('text-red-700', isError);
  status.classList.toggle('text-ink/55', !isError);
};

const setSelectionStatus = (state) => {
  const selectionStatus = state.root?.querySelector('[data-anchor-selection-status]');
  const anchorButton = state.root?.querySelector('[data-create-anchored-note]');
  const reattachButton = state.root?.querySelector('[data-note-reattach]');

  if (selectionStatus) {
    if (state.pendingAnchor) {
      selectionStatus.hidden = false;
      selectionStatus.textContent = `Selection ready in block ${state.pendingAnchor.blockId}.`;
    } else {
      selectionStatus.hidden = true;
      selectionStatus.textContent = '';
    }
  }

  if (anchorButton) {
    anchorButton.disabled = !state.pendingAnchor;
  }

  if (reattachButton) {
    reattachButton.hidden = !state.pendingAnchor;
  }
};

const highlightActiveListItem = (state) => {
  state.root?.querySelectorAll('[data-note-item]').forEach((item) => {
    item.classList.toggle('ring-2', item.dataset.noteId === state.activeNoteId);
    item.classList.toggle('ring-accent', item.dataset.noteId === state.activeNoteId);
  });
};

const renderDetail = (state, note) => {
  const detail = state.root?.querySelector('[data-note-detail]');
  if (!detail) {
    return;
  }

  if (!note) {
    detail.hidden = false;
    detail.innerHTML = `
      <p class="text-sm text-ink/60">${DETAIL_EMPTY_MESSAGE}</p>
    `;
    dispatchSelectedNote(state, null);
    return;
  }

  detail.hidden = false;
  detail.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="badge">${escapeHtml(note.container?.type ?? 'note')}</span>
            ${note.isDetached ? '<span class="badge">DETACHED</span>' : ''}
            ${note.anchor ? '<span class="badge">ANCHORED</span>' : '<span class="badge">STANDALONE</span>'}
          </div>
          <p class="text-sm text-ink/60">${escapeHtml(note.container?.title ?? 'Untitled container')}</p>
          <p class="text-xs text-ink/45">Last saved ${escapeHtml(new Date(note.headUpdatedAt).toLocaleString())}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn-secondary" type="button" data-note-copy="${escapeHtml(note.id)}">Copy</button>
          ${
            note.anchor && !note.isDetached
              ? '<button class="btn-secondary" type="button" data-note-go-to-anchor>Go to anchor</button>'
              : ''
          }
          ${
            note.capabilities?.canEdit && note.anchor && !note.isDetached
              ? '<button class="btn-secondary" type="button" data-note-detach>Detach</button>'
              : ''
          }
          ${
            note.capabilities?.canDelete
              ? '<button class="btn-secondary" type="button" data-note-delete>Delete</button>'
              : ''
          }
        </div>
      </div>
      <label class="space-y-2">
        <span class="text-sm font-semibold text-ink">Note</span>
        <textarea class="input min-h-40" data-note-editor ${note.capabilities?.canEdit ? '' : 'readonly'}>${escapeHtml(note.headText ?? '')}</textarea>
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-secondary" type="button" data-note-reattach hidden>Reattach to selection</button>
        <p class="text-sm text-ink/55" data-note-detail-status></p>
      </div>
    </div>
  `;

  setSelectionStatus(state);
  dispatchSelectedNote(state, note);
};

const refreshAfterMutation = async (state, noteId = null) => {
  await state.refresh({
    activeNoteId: noteId ?? state.activeNoteId
  });
};

const fetchNoteDetail = async (state, noteId) => {
  const response = await fetch(
    `/api/v1/projects/${state.boot.project.id}/notes/${noteId}`,
    {
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'fetch'
      }
    }
  );
  const payload = await readJson(response);

  if (!response.ok || !payload?.ok) {
    throw new Error(getErrorMessage(payload, 'Note detail could not be loaded.'));
  }

  return payload.data.note;
};

const copyNoteText = async (state, noteId) => {
  try {
    const note =
      state.activeNoteId === noteId && state.activeNoteDetail
        ? state.activeNoteDetail
        : await fetchNoteDetail(state, noteId);
    await navigator.clipboard.writeText(note.headText ?? '');
  } catch (error) {
    window.alert(error.message ?? 'Note text could not be copied.');
  }
};

const bindDetailActions = async (state) => {
  const detail = state.root?.querySelector('[data-note-detail]');
  const textarea = detail?.querySelector('[data-note-editor]');

  if (!detail || !state.activeNoteDetail) {
    return;
  }

  if (textarea && state.socket) {
    if (state.noteRealtime) {
      void state.noteRealtime.dispose();
      state.noteRealtime = null;
    }

    const NoteRealtimeProvider = await loadNoteRealtimeProvider();
    const provider = new NoteRealtimeProvider({
      socket: state.socket,
      projectId: state.boot.project.id,
      noteId: state.activeNoteDetail.id,
      currentUser: state.boot.currentUser,
      canEdit: state.activeNoteDetail.capabilities?.canEdit,
      onPersisted(persistedAt) {
        setDetailStatus(state, `Saved ${new Date(persistedAt).toLocaleTimeString()}`);
      },
      onServerError(message) {
        setDetailStatus(state, message, true);
      }
    });

    state.noteRealtime = provider;
    void provider
      .connect()
      .then(() => {
        provider.bindTextarea(textarea);
      })
      .catch((error) => {
        setDetailStatus(state, error.message, true);
      });
  }

  detail.querySelector('[data-note-go-to-anchor]')?.addEventListener('click', () => {
    window.dispatchEvent(
      new CustomEvent('courier:note-anchor-request', {
        detail: {
          shell: state.shell,
          note: state.activeNoteDetail
        }
      })
    );
  });

  detail.querySelector('[data-note-copy]')?.addEventListener('click', () => {
    void copyNoteText(state, state.activeNoteDetail.id);
  });

  detail.querySelector('[data-note-delete]')?.addEventListener('click', async () => {
    const confirmed = window.confirm('Delete this note?');
    if (!confirmed) {
      return;
    }

    const response = await csrfFetch(
      `/api/v1/projects/${state.boot.project.id}/notes/${state.activeNoteDetail.id}`,
      {
        method: 'DELETE'
      }
    );
    const payload = await readJson(response);

    if (!response.ok || !payload?.ok) {
      setDetailStatus(state, getErrorMessage(payload, 'Note could not be deleted.'), true);
      return;
    }

    state.activeNoteId = null;
    state.activeNoteDetail = null;
    if (state.noteRealtime) {
      await state.noteRealtime.dispose();
      state.noteRealtime = null;
    }
    await state.refresh();
  });

  detail.querySelector('[data-note-detach]')?.addEventListener('click', async () => {
    const response = await csrfFetch(
      `/api/v1/projects/${state.boot.project.id}/notes/${state.activeNoteDetail.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          detach: true
        })
      }
    );
    const payload = await readJson(response);

    if (!response.ok || !payload?.ok) {
      setDetailStatus(state, getErrorMessage(payload, 'Note could not be detached.'), true);
      return;
    }

    await refreshAfterMutation(state, state.activeNoteDetail.id);
  });

  detail.querySelector('[data-note-reattach]')?.addEventListener('click', async () => {
    if (!state.pendingAnchor) {
      setDetailStatus(state, 'Select scene text before reattaching.', true);
      return;
    }

    const response = await csrfFetch(
      `/api/v1/projects/${state.boot.project.id}/notes/${state.activeNoteDetail.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          sceneId: state.pendingAnchor.sceneId,
          anchor: state.pendingAnchor
        })
      }
    );
    const payload = await readJson(response);

    if (!response.ok || !payload?.ok) {
      setDetailStatus(state, getErrorMessage(payload, 'Note could not be reattached.'), true);
      return;
    }

    state.pendingAnchor = null;
    await refreshAfterMutation(state, state.activeNoteDetail.id);
  });
};

const openNote = async (state, noteId) => {
  state.activeNoteId = noteId;
  highlightActiveListItem(state);

  try {
    const note = await fetchNoteDetail(state, noteId);
    state.activeNoteDetail = note;
    renderDetail(state, note);
    await bindDetailActions(state);
  } catch (error) {
    renderDetail(state, null);
    setDetailStatus(state, error.message, true);
  }
};

const initializeSocket = (state) => {
  if (state.socket || !window.io) {
    return;
  }

  try {
    state.socket = createCollabClient();
  } catch {
    return;
  }

  const joinBaseRooms = () => {
    if (!state.boot?.project?.id) {
      return;
    }

    state.socket.emit('project:join', {
      projectId: state.boot.project.id
    });

    if (state.boot.script?.id) {
      state.socket.emit('script:join', {
        projectId: state.boot.project.id,
        scriptId: state.boot.script.id
      });
    }
  };

  state.socket.on('connect', () => {
    joinBaseRooms();

    if (state.activeNoteId) {
      void openNote(state, state.activeNoteId);
    }
  });

  const scheduleRefresh = () => {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      void state.refresh({
        activeNoteId: state.activeNoteId
      });
    }, 150);
  };

  state.socket.on('note:created', scheduleRefresh);
  state.socket.on('note:updated', ({ noteId }) => {
    if (noteId === state.activeNoteId) {
      void openNote(state, noteId);
    }
    scheduleRefresh();
  });
  state.socket.on('note:deleted', ({ noteId }) => {
    if (noteId === state.activeNoteId) {
      state.activeNoteId = null;
      state.activeNoteDetail = null;
      renderDetail(state, null);
    }
    scheduleRefresh();
  });
  state.socket.on('note:anchor-detached', ({ noteId }) => {
    if (noteId === state.activeNoteId) {
      void openNote(state, noteId);
    }
    scheduleRefresh();
  });

  if (state.socket.connected) {
    joinBaseRooms();
  }
};

const bindPanelEvents = (state) => {
  state.root.querySelector('[data-notes-filters]')?.addEventListener('change', () => {
    state.activeNoteId = null;
    state.activeNoteDetail = null;
    void state.refresh();
  });

  state.root.querySelector('[data-note-create-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const targetField = form.querySelector('[name="target"]');
    const textField = form.querySelector('[name="text"]');
    const targetValue = String(targetField?.value ?? '');
    const [containerType, containerId] = targetValue.split(':');
    const text = String(textField?.value ?? '');

    const response = await csrfFetch(
      `/api/v1/projects/${state.boot.project.id}/notes`,
      {
        method: 'POST',
        body: JSON.stringify({
          containerType,
          containerId,
          scriptId: state.boot.script?.id ?? undefined,
          text
        })
      }
    );
    const payload = await readJson(response);

    if (!response.ok || !payload?.ok) {
      setCreateStatus(state, getErrorMessage(payload, 'Note could not be created.'), true);
      return;
    }

    form.reset();
    state.pendingAnchor = null;
    setCreateStatus(state, 'Note created.');
    await refreshAfterMutation(state, payload.data.note.id);
  });

  state.root.querySelector('[data-create-anchored-note]')?.addEventListener('click', async () => {
    const form = state.root.querySelector('[data-note-create-form]');
    const text = String(form?.querySelector?.('[name="text"]')?.value ?? '');

    if (!state.pendingAnchor) {
      setCreateStatus(state, 'Select scene text before creating an anchored note.', true);
      return;
    }

    const response = await csrfFetch(
      `/api/v1/projects/${state.boot.project.id}/notes`,
      {
        method: 'POST',
        body: JSON.stringify({
          containerType: 'scene',
          containerId: state.pendingAnchor.sceneId,
          sceneId: state.pendingAnchor.sceneId,
          scriptId: state.boot.script?.id ?? undefined,
          text,
          anchor: state.pendingAnchor
        })
      }
    );
    const payload = await readJson(response);

    if (!response.ok || !payload?.ok) {
      setCreateStatus(state, getErrorMessage(payload, 'Anchored note could not be created.'), true);
      return;
    }

    if (form) {
      form.reset();
    }
    state.pendingAnchor = null;
    await refreshAfterMutation(state, payload.data.note.id);
  });

  state.root.querySelectorAll('[data-note-open]').forEach((button) => {
    button.addEventListener('click', () => {
      void openNote(state, button.dataset.noteOpen);
    });
  });

  state.root.querySelectorAll('[data-note-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      void copyNoteText(state, button.dataset.noteCopy);
    });
  });

  state.root.querySelectorAll('[data-note-jump]').forEach((button) => {
    button.addEventListener('click', async () => {
      const noteId = button.dataset.noteJump;
      const note =
        state.boot.notes.find((entry) => entry.id === noteId) ??
        (await fetchNoteDetail(state, noteId));

      window.dispatchEvent(
        new CustomEvent('courier:note-anchor-request', {
          detail: {
            shell: state.shell,
            note
          }
        })
      );
    });
  });
};

const bindRoot = (state, root) => {
  state.root = root;
  state.boot = readBootPayload(root);
  initializeSocket(state);
  state.shell.__notesPanelController = {
    refresh: (options = {}) => state.refresh(options),
    openNote: (noteId) => openNote(state, noteId),
    setSelectionAnchor(anchor) {
      state.pendingAnchor = anchor;
      setSelectionStatus(state);
    },
    clearSelectionAnchor() {
      state.pendingAnchor = null;
      setSelectionStatus(state);
    },
    setSceneContext(sceneId) {
      state.shell.dataset.sceneId = sceneId ?? '';
      void state.refresh({
        activeNoteId: state.activeNoteId
      });
    },
    getNotes: () => state.boot?.notes ?? []
  };

  renderDetail(state, state.activeNoteDetail);
  setSelectionStatus(state);
  highlightActiveListItem(state);
  bindPanelEvents(state);
  dispatchNotesListChanged(state);
  window.dispatchEvent(
    new CustomEvent('courier:notes-panel-ready', {
      detail: {
        shell: state.shell,
        controller: state.shell.__notesPanelController
      }
    })
  );
};

const loadFragment = async (state) => {
  const response = await fetch(buildFragmentUrl(state), {
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'fetch'
    }
  });

  if (!response.ok) {
    throw new Error('Notes panel could not be loaded.');
  }

  state.target.innerHTML = await response.text();
  const root = state.target.querySelector('[data-notes-panel]');
  if (!root) {
    throw new Error('Notes panel markup was incomplete.');
  }

  bindRoot(state, root);
};

const createState = (shell) => {
  const target =
    shell.querySelector('[data-notes-fragment-target]') ??
    shell.querySelector('[data-notes-panel-host]') ??
    shell;

  const state = {
    shell,
    target,
    root: null,
    boot: null,
    socket: null,
    noteRealtime: null,
    activeNoteId: shell.dataset.activeNoteId || null,
    activeNoteDetail: null,
    pendingAnchor: null,
    refreshTimer: null,
    async refresh({ activeNoteId = state.activeNoteId } = {}) {
      if (state.noteRealtime) {
        await state.noteRealtime.dispose();
        state.noteRealtime = null;
      }

      state.activeNoteId = activeNoteId ?? null;
      state.activeNoteDetail = null;

      if (state.shell.dataset.notesFragmentUrl) {
        await loadFragment(state);
      } else {
        const root = state.target.querySelector('[data-notes-panel]');
        if (!root) {
          return;
        }
        bindRoot(state, root);
      }

      if (state.activeNoteId) {
        await openNote(state, state.activeNoteId);
      }
    }
  };

  return state;
};

const initNotesShell = (shell) => {
  if (shell.dataset.notesReady === 'true') {
    return;
  }

  shell.dataset.notesReady = 'true';
  const state = createState(shell);

  if (shell.dataset.notesFragmentUrl) {
    const root = shell.querySelector('[data-notes-panel]');
    if (root) {
      bindRoot(state, root);
    }
    void state.refresh();
  } else {
    const root = shell.querySelector('[data-notes-panel]');
    if (root) {
      bindRoot(state, root);
    }
  }

  window.addEventListener('courier:open-note', (event) => {
    if (!event.detail?.noteId) {
      return;
    }

    void openNote(state, event.detail.noteId);
  });
};

export const initNotesPanels = () => {
  document.querySelectorAll('[data-notes-shell]').forEach((shell) => {
    initNotesShell(shell);
  });
};

import { csrfFetch } from '../csrf-fetch.js';
import { getErrorMessage, readJson } from '../form-helpers.js';
import { showConfirmDialog } from '../ui/dialog-focus.js';

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const readBootPayload = (root) => {
  const payloadElement = root?.querySelector?.('[data-version-sidebar-boot]');

  if (!payloadElement?.textContent) {
    return null;
  }

  return JSON.parse(payloadElement.textContent)?.versionSidebar ?? null;
};

const formatDateTime = (value) => {
  if (!value) {
    return 'No checkpoint timestamp yet.';
  }

  return new Date(value).toLocaleString();
};

const setHeaderMeta = (boot) => {
  const currentVersionLabel = document.querySelector('[data-script-current-version-label]');
  const lastCheckpointAt = document.querySelector('[data-script-last-checkpoint-at]');

  if (currentVersionLabel) {
    currentVersionLabel.textContent = boot?.script?.currentVersionLabel ?? 'No major save yet';
  }

  if (lastCheckpointAt) {
    lastCheckpointAt.textContent = formatDateTime(boot?.script?.lastCheckpointAt ?? null);
  }
};

const setPrimaryStatus = (message, isError = false) => {
  const status = document.querySelector('[data-script-major-save-status]');

  if (!status) {
    return;
  }

  status.textContent = message ?? '';
  status.classList.toggle('text-red-700', isError);
  status.classList.toggle('text-ink/55', !isError);
};

const setPrimaryBusy = (busy) => {
  const button = document.querySelector('[data-script-major-save-primary]');

  if (button) {
    button.disabled = busy;
  }
};

const setSidebarStatus = (state, message, isError = false) => {
  const status = state.root?.querySelector('[data-version-sidebar-status]');

  if (!status) {
    return;
  }

  status.textContent = message ?? '';
  status.classList.toggle('text-red-700', isError);
  status.classList.toggle('text-ink/55', !isError);
};

const buildFragmentUrl = (state) => {
  const url = new URL(state.shell.dataset.versionFragmentUrl, window.location.origin);

  if (state.shell.dataset.sceneId) {
    url.searchParams.set('sceneId', state.shell.dataset.sceneId);
  }

  return url.pathname + url.search;
};

const createCompareSource = (value) => {
  if (!value || value === 'currentHead') {
    return {
      kind: 'currentHead'
    };
  }

  const [, versionId] = String(value).split(':');
  return {
    kind: 'version',
    versionId
  };
};

const renderTextSegments = (segments = []) =>
  segments
    .map((segment) => {
      if (segment.kind === 'added') {
        return `<span class="bg-amber-200">${escapeHtml(segment.text)}</span>`;
      }

      if (segment.kind === 'deleted') {
        return `<span class="line-through text-rose-700">${escapeHtml(segment.text)}</span>`;
      }

      return `<span>${escapeHtml(segment.text)}</span>`;
    })
    .join('');

const renderSceneDiff = (state, diff) => {
  const container = state.root?.querySelector('[data-scene-diff-output]');

  if (!container) {
    return;
  }

  if (!diff?.hasMajorVersion) {
    container.innerHTML = '<p class="text-sm text-ink/60">No major save exists for this scene yet.</p>';
    return;
  }

  container.innerHTML = `
    <div class="space-y-2">
      <p class="text-xs uppercase tracking-[0.18em] text-ink/45">Compare</p>
      <p class="text-sm text-ink/60">
        ${escapeHtml(diff.compare?.left?.versionLabel ?? diff.compare?.left?.kind ?? 'left')}
        ->
        ${escapeHtml(diff.compare?.right?.versionLabel ?? diff.compare?.right?.kind ?? 'right')}
      </p>
    </div>
    <div class="space-y-3">
      ${(diff.blocks ?? [])
        .map(
          (block) => `
            <article class="rounded-2xl border border-ink/10 bg-paper/50 px-3 py-3">
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">
                  ${escapeHtml(block.blockType)}${block.lane !== 'main' ? ` · ${escapeHtml(block.lane)}` : ''}
                </p>
                <span class="badge">${escapeHtml(block.status)}</span>
              </div>
              <p class="mt-2 text-sm leading-6 text-ink">${renderTextSegments(block.segments)}</p>
            </article>
          `
        )
        .join('')}
    </div>
  `;
};

const fetchSceneDiff = async (state, compare = null) => {
  const sceneId = state.shell.dataset.sceneId;

  if (!sceneId) {
    return null;
  }

  const response = await csrfFetch(
    `/api/v1/projects/${state.shell.dataset.projectId}/scripts/${state.shell.dataset.scriptId}/scenes/${sceneId}/diff`,
    {
      method: 'POST',
      body: JSON.stringify(compare ?? {})
    }
  );
  const payload = await readJson(response);

  if (!response.ok || !payload?.ok) {
    throw new Error(getErrorMessage(payload, 'Scene diff could not be loaded.'));
  }

  return payload.data;
};

const bindRootInteractions = (state) => {
  state.root?.querySelector('[data-scene-major-save]')?.addEventListener('click', async () => {
    if (!state.shell.dataset.sceneId) {
      return;
    }

    try {
      setSidebarStatus(state, 'Saving scene major save…');
      const response = await csrfFetch(
        `/api/v1/projects/${state.shell.dataset.projectId}/scripts/${state.shell.dataset.scriptId}/scenes/${state.shell.dataset.sceneId}/versions/major-save`,
        {
          method: 'POST'
        }
      );
      const payload = await readJson(response);

      if (!response.ok || !payload?.ok) {
        setSidebarStatus(state, getErrorMessage(payload, 'Scene major save could not be created.'), true);
        return;
      }

      setSidebarStatus(state, 'Scene major save created.');
      await refreshFragment(state);
    } catch (error) {
      setSidebarStatus(state, error.message, true);
    }
  });

  const compareForm = state.root?.querySelector('[data-scene-compare-form]');

  if (compareForm) {
    compareForm.addEventListener('change', async () => {
      try {
        setSidebarStatus(state, 'Loading diff…');
        const diff = await fetchSceneDiff(state, {
          left: createCompareSource(compareForm.elements.left.value),
          right: createCompareSource(compareForm.elements.right.value)
        });
        renderSceneDiff(state, diff);
        setSidebarStatus(state, 'Diff updated.');
      } catch (error) {
        setSidebarStatus(state, error.message, true);
      }
    });
  }

  state.root?.querySelectorAll('[data-scene-version-restore]').forEach((button) => {
    button.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog({
        title: 'Restore scene version',
        description: 'Restore this scene version as the current head?',
        confirmText: 'Restore version'
      });
      if (!confirmed) {
        return;
      }

      try {
        setSidebarStatus(state, 'Restoring scene version…');
        const response = await csrfFetch(
          `/api/v1/projects/${state.shell.dataset.projectId}/scripts/${state.shell.dataset.scriptId}/scenes/${state.shell.dataset.sceneId}/versions/${button.dataset.sceneVersionRestore}/restore`,
          {
            method: 'POST'
          }
        );
        const payload = await readJson(response);

        if (!response.ok || !payload?.ok) {
          setSidebarStatus(state, getErrorMessage(payload, 'Scene version could not be restored.'), true);
          return;
        }

        setSidebarStatus(state, 'Scene restored.');
      } catch (error) {
        setSidebarStatus(state, error.message, true);
      }
    });
  });
};

const refreshFragment = async (state) => {
  const response = await fetch(buildFragmentUrl(state), {
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'fetch'
    }
  });

  if (!response.ok) {
    throw new Error('Version history could not be loaded.');
  }

  state.target.innerHTML = await response.text();
  state.root = state.target.querySelector('[data-version-sidebar]');
  state.boot = readBootPayload(state.root);
  setHeaderMeta(state.boot);
  bindRootInteractions(state);

  if (state.boot?.activeScene) {
    const diff = await fetchSceneDiff(state, null);
    renderSceneDiff(state, diff);
  }
};

export const createVersionSidebarController = ({
  shell,
  socket
}) => {
  const state = {
    shell,
    socket,
    target: shell.querySelector('[data-version-fragment-target]'),
    root: null,
    boot: null
  };

  const handleScriptUpdated = (payload) => {
    if (payload?.scriptId !== state.shell.dataset.scriptId) {
      return;
    }

    void refreshFragment(state).catch(() => {});
  };

  const handleSceneVersionEvent = (payload) => {
    if (payload?.sceneId !== state.shell.dataset.sceneId) {
      return;
    }

    void refreshFragment(state).catch(() => {});
  };

  socket.on('script:updated', handleScriptUpdated);
  socket.on('scene:version-created', handleSceneVersionEvent);
  socket.on('scene:version-restored', handleSceneVersionEvent);

  document
    .querySelector('[data-script-major-save-primary]')
    ?.addEventListener('click', async () => {
      try {
        setPrimaryBusy(true);
        setPrimaryStatus('Saving checkpoint…');
        const response = await csrfFetch(
          `/api/v1/projects/${state.shell.dataset.projectId}/scripts/${state.shell.dataset.scriptId}/versions/major-save`,
          {
            method: 'POST'
          }
        );
        const payload = await readJson(response);

        if (!response.ok || !payload?.ok) {
          setPrimaryStatus(getErrorMessage(payload, 'Checkpoint could not be created.'), true);
          return;
        }

        setPrimaryStatus('Checkpoint saved.');
        await refreshFragment(state);
      } catch (error) {
        setPrimaryStatus(error.message, true);
      } finally {
        setPrimaryBusy(false);
      }
    });

  return {
    async refresh() {
      await refreshFragment(state);
    },

    async setSceneContext(sceneId) {
      state.shell.dataset.sceneId = sceneId ?? '';
      await refreshFragment(state);
    }
  };
};

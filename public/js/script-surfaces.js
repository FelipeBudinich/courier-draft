import { createCollabClient } from './collab-client.js';
import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson, setFormStatus } from './form-helpers.js';

const createAuthorRow = (value = '') => {
  const row = document.createElement('div');
  row.className = 'flex flex-wrap items-center gap-2';
  row.dataset.authorRow = 'true';
  row.innerHTML = `
    <input class="input min-w-[14rem] flex-1" type="text" name="authors" maxlength="120" value="${value.replace(/"/g, '&quot;')}" />
    <button class="btn-secondary" type="button" data-author-move="-1">Up</button>
    <button class="btn-secondary" type="button" data-author-move="1">Down</button>
    <button class="btn-secondary" type="button" data-author-remove>Remove</button>
  `;
  return row;
};

const getAuthorRows = (list) => [...list.querySelectorAll('[data-author-row]')];

const ensureAuthorRow = (list) => {
  if (getAuthorRows(list).length) {
    return;
  }

  list.append(createAuthorRow());
};

const moveAuthorRow = (row, offset) => {
  const sibling =
    offset < 0 ? row.previousElementSibling : row.nextElementSibling;

  if (!sibling) {
    return;
  }

  if (offset < 0) {
    row.parentElement.insertBefore(row, sibling);
  } else {
    row.parentElement.insertBefore(sibling, row);
  }
};

const initAuthorsList = (scope) => {
  const list = scope.querySelector('[data-authors-list]');
  if (!list || list.dataset.authorsReady === 'true') {
    return;
  }

  list.dataset.authorsReady = 'true';
  ensureAuthorRow(list);

  scope.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-authors-add]');
    if (addButton && scope.contains(addButton)) {
      event.preventDefault();
      list.append(createAuthorRow());
      return;
    }

    const row = event.target.closest('[data-author-row]');
    if (!row || !list.contains(row)) {
      return;
    }

    if (event.target.closest('[data-author-remove]')) {
      event.preventDefault();
      row.remove();
      ensureAuthorRow(list);
      return;
    }

    const moveButton = event.target.closest('[data-author-move]');
    if (moveButton) {
      event.preventDefault();
      moveAuthorRow(row, Number.parseInt(moveButton.dataset.authorMove, 10));
    }
  });
};

const readScriptFormBody = (form) => {
  const formData = new FormData(form);

  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    genre: String(formData.get('genre') ?? ''),
    status: String(formData.get('status') ?? ''),
    language: String(formData.get('language') ?? ''),
    authors: formData
      .getAll('authors')
      .map((value) => String(value).trim())
      .filter(Boolean)
  };
};

const reloadOutlineFragment = async (shell) => {
  const fragmentTarget = shell?.querySelector?.('[data-outline-fragment-target]');
  if (!fragmentTarget) {
    return;
  }

  const response = await fetch(shell.dataset.outlineFragmentUrl, {
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'fetch'
    }
  });

  if (!response.ok) {
    return;
  }

  fragmentTarget.innerHTML = await response.text();
};

const initScriptCreateForm = () => {
  const form = document.querySelector('[data-script-create-form]');
  if (!form) {
    return;
  }

  initAuthorsList(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormStatus(form, 'Creating script…');

    const response = await csrfFetch(
      `/api/v1/projects/${form.dataset.projectId}/scripts`,
      {
        method: 'POST',
        body: JSON.stringify(readScriptFormBody(form))
      }
    );
    const result = await readJson(response);

    if (!response.ok || !result?.ok) {
      setFormStatus(form, getErrorMessage(result, 'Script could not be created.'), true);
      return;
    }

    window.location.assign(
      `/projects/${form.dataset.projectId}/scripts/${result.data.script.id}`
    );
  });
};

const initScriptMetadataForms = () => {
  document.querySelectorAll('[data-script-metadata-form]').forEach((form) => {
    initAuthorsList(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(form, 'Saving script metadata…');

      const response = await csrfFetch(
        `/api/v1/projects/${form.dataset.projectId}/scripts/${form.dataset.scriptId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(readScriptFormBody(form))
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        setFormStatus(form, getErrorMessage(result, 'Script metadata could not be saved.'), true);
        return;
      }

      setFormStatus(form, 'Saved.');
      window.location.reload();
    });
  });
};

const initSceneNumberForms = () => {
  document.querySelectorAll('[data-scene-number-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(form, 'Updating scene numbering…');

      const formData = new FormData(form);
      const response = await csrfFetch(
        `/api/v1/projects/${form.dataset.projectId}/scripts/${form.dataset.scriptId}/scene-numbering`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            sceneNumberMode: String(formData.get('sceneNumberMode') ?? '')
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        setFormStatus(form, getErrorMessage(result, 'Scene numbering could not be updated.'), true);
        return;
      }

      setFormStatus(form, 'Updated.');
      const shell = form.closest('[data-script-shell]');
      await reloadOutlineFragment(shell);
    });
  });
};

const initScriptDeleteButtons = () => {
  document.querySelectorAll('[data-script-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const confirmed = window.confirm('Delete this script and its outline?');
      if (!confirmed) {
        return;
      }

      const response = await csrfFetch(
        `/api/v1/projects/${button.dataset.projectId}/scripts/${button.dataset.scriptId}`,
        {
          method: 'DELETE'
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        window.alert(getErrorMessage(result, 'Script could not be deleted.'));
        return;
      }

      window.location.assign(button.dataset.redirectUrl);
    });
  });
};

const parseDownloadFilename = (contentDisposition) => {
  if (!contentDisposition) {
    return 'screenplay.pdf';
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return basicMatch?.[1] ?? 'screenplay.pdf';
};

const buildExportRequestBody = (form) => {
  const formData = new FormData(form);
  const selectionKind = String(formData.get('selectionKind') ?? 'full');

  if (selectionKind === 'full') {
    return {
      format: String(formData.get('format') ?? 'standard'),
      selection: {
        kind: 'full'
      }
    };
  }

  return {
    format: String(formData.get('format') ?? 'standard'),
    selection: {
      kind: 'partial',
      actNodeIds: formData.getAll('actNodeIds').map((value) => String(value)),
      sceneIds: formData.getAll('sceneIds').map((value) => String(value))
    }
  };
};

const toggleExportSelectionPanel = (form) => {
  const panel = form.querySelector('[data-export-selection-panel]');
  if (!panel) {
    return;
  }

  const isPartial =
    form.querySelector('input[name="selectionKind"]:checked')?.value === 'partial';
  panel.hidden = !isPartial;

  if (!isPartial) {
    return;
  }

  const hasSelection =
    form.querySelectorAll('input[name="actNodeIds"]:checked, input[name="sceneIds"]:checked')
      .length > 0;

  if (!hasSelection && form.dataset.activeSceneId) {
    const activeSceneCheckbox = form.querySelector(
      `input[name="sceneIds"][value="${form.dataset.activeSceneId}"]`
    );

    if (activeSceneCheckbox) {
      activeSceneCheckbox.checked = true;
    }
  }
};

const triggerBlobDownload = ({
  blob,
  filename
}) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

const initExportForms = () => {
  document.querySelectorAll('[data-export-form]').forEach((form) => {
    toggleExportSelectionPanel(form);

    form.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.name === 'selectionKind') {
        toggleExportSelectionPanel(form);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const payload = buildExportRequestBody(form);

      if (
        payload.selection.kind === 'partial' &&
        !payload.selection.actNodeIds.length &&
        !payload.selection.sceneIds.length
      ) {
        setFormStatus(form, 'Select at least one act or scene for a partial export.', true);
        return;
      }

      setFormStatus(form, 'Generating PDF…');

      const response = await csrfFetch(
        `/api/v1/projects/${form.dataset.projectId}/scripts/${form.dataset.scriptId}/exports/pdf`,
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const result = await readJson(response);
        setFormStatus(form, getErrorMessage(result, 'PDF export failed.'), true);
        return;
      }

      const blob = await response.blob();
      triggerBlobDownload({
        blob,
        filename: parseDownloadFilename(response.headers.get('Content-Disposition'))
      });
      setFormStatus(form, 'Download started.');
    });
  });
};

const initOutlineInteractions = () => {
  const shell = document.querySelector('[data-script-shell]');
  const fragmentTarget = shell?.querySelector?.('[data-outline-fragment-target]');
  if (!shell || !fragmentTarget) {
    return;
  }

  let draggedNodeId = null;

  fragmentTarget.addEventListener('click', async (event) => {
    const createButton = event.target.closest('[data-outline-create]');
    if (createButton) {
      const title = window.prompt('Node title');
      if (!title) {
        return;
      }

      const response = await csrfFetch(
        `/api/v1/projects/${shell.dataset.projectId}/scripts/${shell.dataset.scriptId}/outline/nodes`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: createButton.dataset.nodeType,
            title,
            placementParentId: createButton.dataset.parentId || null
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        window.alert(getErrorMessage(result, 'Outline node could not be created.'));
        return;
      }

      await reloadOutlineFragment(shell);
      return;
    }

    const renameButton = event.target.closest('[data-outline-rename]');
    if (renameButton) {
      const title = window.prompt('Rename node', renameButton.dataset.currentTitle || '');
      if (!title) {
        return;
      }

      const response = await csrfFetch(
        `/api/v1/projects/${shell.dataset.projectId}/scripts/${shell.dataset.scriptId}/outline/nodes/${renameButton.dataset.nodeId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        window.alert(getErrorMessage(result, 'Outline node could not be renamed.'));
        return;
      }

      await reloadOutlineFragment(shell);
      return;
    }

    const deleteButton = event.target.closest('[data-outline-delete]');
    if (deleteButton) {
      const confirmed = window.confirm(`Delete this ${deleteButton.dataset.nodeType}?`);
      if (!confirmed) {
        return;
      }

      const response = await csrfFetch(
        `/api/v1/projects/${shell.dataset.projectId}/scripts/${shell.dataset.scriptId}/outline/nodes/${deleteButton.dataset.nodeId}`,
        {
          method: 'DELETE'
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        window.alert(getErrorMessage(result, 'Outline node could not be deleted.'));
        return;
      }

      await reloadOutlineFragment(shell);
    }
  });

  fragmentTarget.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-outline-item]');
    if (!item) {
      return;
    }

    draggedNodeId = item.dataset.nodeId;
    item.classList.add('opacity-60');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedNodeId);
  });

  fragmentTarget.addEventListener('dragend', (event) => {
    const item = event.target.closest('[data-outline-item]');
    item?.classList.remove('opacity-60');
    draggedNodeId = null;
  });

  fragmentTarget.addEventListener('dragover', (event) => {
    if (!draggedNodeId) {
      return;
    }

    if (event.target.closest('[data-outline-item]') || event.target.closest('[data-outline-container]')) {
      event.preventDefault();
    }
  });

  fragmentTarget.addEventListener('drop', async (event) => {
    const overItem = event.target.closest('[data-outline-item]');
    const overContainer = event.target.closest('[data-outline-container]');
    if (!draggedNodeId || (!overItem && !overContainer)) {
      return;
    }

    event.preventDefault();

    let payload = null;
    if (overItem && overItem.dataset.nodeId !== draggedNodeId) {
      const rect = overItem.getBoundingClientRect();
      const beforeNode = event.clientY < rect.top + rect.height / 2;
      payload = {
        placementParentId: overItem.dataset.parentId || null,
        insert: beforeNode
          ? { beforeNodeId: overItem.dataset.nodeId }
          : { afterNodeId: overItem.dataset.nodeId }
      };
    } else if (overContainer) {
      payload = {
        placementParentId: overContainer.dataset.parentId || null
      };
    }

    if (!payload) {
      return;
    }

    const response = await csrfFetch(
      `/api/v1/projects/${shell.dataset.projectId}/scripts/${shell.dataset.scriptId}/outline/nodes/${draggedNodeId}/move`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
    const result = await readJson(response);

    if (!response.ok || !result?.ok) {
      window.alert(getErrorMessage(result, 'Outline node could not be moved.'));
      return;
    }

    await reloadOutlineFragment(shell);
  });
};

const initScriptRealtime = () => {
  const shell = document.querySelector('[data-script-shell]');
  const connectionNode = shell?.querySelector?.('[data-script-connection-state]');
  if (!shell || !window.io || document.querySelector('[data-editor-page]')) {
    return;
  }

  let reloadTimer = null;
  const schedulePageReload = () => {
    if (reloadTimer) {
      return;
    }

    reloadTimer = window.setTimeout(() => {
      window.location.reload();
    }, 250);
  };

  const socket = createCollabClient();
  const projectId = shell.dataset.projectId;
  const scriptId = shell.dataset.scriptId;

  socket.on('connect', () => {
    if (connectionNode) {
      connectionNode.textContent = 'Connected';
    }

    socket.emit('project:join', { projectId }, (projectAck) => {
      if (!projectAck?.ok) {
        if (connectionNode) {
          connectionNode.textContent = 'Unavailable';
        }
        return;
      }

      socket.emit('script:join', { projectId, scriptId }, (scriptAck) => {
        if (!scriptAck?.ok && connectionNode) {
          connectionNode.textContent = 'Unavailable';
        }
      });
    });
  });

  socket.on('connect_error', () => {
    if (connectionNode) {
      connectionNode.textContent = 'Unavailable';
    }
  });

  socket.on('outline:changed', () => {
    reloadOutlineFragment(shell);
  });

  socket.on('script:updated', schedulePageReload);

  window.addEventListener('beforeunload', () => {
    socket.emit('script:leave', { projectId, scriptId });
    socket.emit('project:leave', { projectId });
    socket.close();
  });
};

export const initScriptSurfaces = () => {
  initScriptCreateForm();
  initScriptMetadataForms();
  initSceneNumberForms();
  initScriptDeleteButtons();
  initExportForms();
  initOutlineInteractions();
  initScriptRealtime();
};

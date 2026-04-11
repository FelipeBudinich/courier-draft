import { createCollabClient } from './collab-client.js';
import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson, setFormStatus } from './form-helpers.js';

const parseAliases = (value) =>
  String(value ?? '')
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean);

const shouldReloadForActivity = (payload) =>
  [
    'entity.created',
    'entity.updated',
    'entity.merged',
    'outline.node_created',
    'outline.node_updated',
    'outline.node_moved',
    'outline.node_deleted',
    'script.updated',
    'script.deleted'
  ].includes(payload?.type);

export const initEntityRegistryPages = () => {
  const page = document.querySelector('[data-entity-registry-page]');
  if (!page) {
    return;
  }

  page.querySelectorAll('[data-entity-create-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(form, 'Creating entity…');

      const formData = new FormData(form);
      const response = await csrfFetch(
        `/api/v1/projects/${form.dataset.projectId}/entities`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: form.dataset.entityType,
            canonicalName: String(formData.get('canonicalName') ?? ''),
            aliases: parseAliases(formData.get('aliases'))
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        setFormStatus(form, getErrorMessage(result, 'Entity could not be created.'), true);
        return;
      }

      window.location.reload();
    });
  });

  page.querySelectorAll('[data-entity-update-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(form, 'Saving changes…');

      const formData = new FormData(form);
      const response = await csrfFetch(
        `/api/v1/projects/${form.dataset.projectId}/entities/${form.dataset.entityId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            canonicalName: String(formData.get('canonicalName') ?? ''),
            aliases: parseAliases(formData.get('aliases'))
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        setFormStatus(form, getErrorMessage(result, 'Entity could not be updated.'), true);
        return;
      }

      window.location.reload();
    });
  });

  page.querySelectorAll('[data-entity-merge-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(form, 'Merging entities…');

      const formData = new FormData(form);
      const targetEntityId = String(formData.get('targetEntityId') ?? '');
      if (!targetEntityId) {
        setFormStatus(form, 'Choose a target entity first.', true);
        return;
      }

      const response = await csrfFetch(
        `/api/v1/projects/${form.dataset.projectId}/entities/${form.dataset.entityId}/merge`,
        {
          method: 'POST',
          body: JSON.stringify({
            targetEntityId
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        setFormStatus(form, getErrorMessage(result, 'Entities could not be merged.'), true);
        return;
      }

      window.location.reload();
    });
  });

  if (!window.io) {
    return;
  }

  const socket = createCollabClient();
  let reloadTimer = null;
  const scheduleReload = () => {
    if (reloadTimer) {
      return;
    }

    reloadTimer = window.setTimeout(() => {
      window.location.reload();
    }, 250);
  };

  socket.on('connect', () => {
    socket.emit('project:join', {
      projectId: page.dataset.projectId
    });
  });

  socket.on('scene:head-persisted', scheduleReload);
  socket.on('scene:version-restored', scheduleReload);
  socket.on('activity:new', (payload) => {
    if (shouldReloadForActivity(payload)) {
      scheduleReload();
    }
  });
  socket.on('project:access-revoked', ({ projectId }) => {
    if (projectId === page.dataset.projectId) {
      window.location.assign('/app');
    }
  });

  window.addEventListener('beforeunload', () => {
    socket.emit('project:leave', {
      projectId: page.dataset.projectId
    });
    socket.close();
  });
};

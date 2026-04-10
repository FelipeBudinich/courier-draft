import { createCollabClient } from './collab-client.js';

const renderPresence = ({ users, summaryNode, listNode }) => {
  if (!users.length) {
    summaryNode.textContent = 'No one else is in this project right now.';
    listNode.innerHTML = '';
    return;
  }

  summaryNode.textContent = `${users.length} collaborator${users.length === 1 ? '' : 's'} connected.`;
  listNode.innerHTML = users
    .map(
      (user) => `
        <article class="list-card">
          <p class="font-semibold text-ink">${user.displayName}</p>
          <p class="text-sm text-ink/60">${user.username ? `@${user.username}` : 'No username yet'} · ${user.view.mode}</p>
        </article>
      `
    )
    .join('');
};

export const initProjectPresence = () => {
  const root = document.querySelector('[data-project-presence]');
  if (!root || !window.io) {
    return;
  }

  const projectId = root.dataset.projectId;
  const summaryNode = root.querySelector('[data-presence-summary]');
  const listNode = root.querySelector('[data-presence-list]');
  const connectionNode = document.querySelector('[data-project-connection-state]');
  const users = new Map();

  const sync = () =>
    renderPresence({
      users: [...users.values()],
      summaryNode,
      listNode
    });

  const socket = createCollabClient();

  socket.on('connect', () => {
    connectionNode.textContent = 'Connected';
    socket.emit('project:join', { projectId }, (ack) => {
      if (!ack?.ok) {
        connectionNode.textContent = 'Unavailable';
        return;
      }

      socket.emit('presence:set-view', {
        projectId,
        scriptId: null,
        sceneId: null,
        noteId: null,
        mode: 'viewing'
      });
    });
  });

  socket.on('connect_error', () => {
    connectionNode.textContent = 'Unavailable';
  });

  socket.on('presence:snapshot', ({ users: snapshot }) => {
    users.clear();
    for (const user of snapshot) {
      users.set(user.userId, user);
    }
    sync();
  });

  socket.on('presence:user-joined', (user) => {
    users.set(user.userId, user);
    sync();
  });

  socket.on('presence:user-left', ({ userId }) => {
    users.delete(userId);
    sync();
  });

  socket.on('presence:view-changed', (payload) => {
    const existing = users.get(payload.userId);
    if (!existing) {
      return;
    }

    existing.view = {
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      sceneId: payload.sceneId,
      noteId: payload.noteId,
      mode: payload.mode
    };
    sync();
  });

  socket.on('project:access-revoked', ({ projectId: revokedProjectId }) => {
    if (revokedProjectId === projectId) {
      window.location.assign('/app');
    }
  });

  window.addEventListener('beforeunload', () => {
    socket.emit('project:leave', { projectId });
    socket.close();
  });
};

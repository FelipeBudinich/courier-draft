import { createCollabClient } from './collab-client.js';
import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson } from './form-helpers.js';
import { announce } from './ui/live-announcer.js';
import { runOnce } from './ui/once-action.js';

const readBootJson = (selector) => {
  const node = document.querySelector(selector);

  if (!node?.textContent) {
    return null;
  }

  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
};

const parseHtml = async (response) => {
  const html = await response.text();
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return {
    html,
    root: template.content.firstElementChild
  };
};

const updateNavBadge = (unreadCount) => {
  const badge = document.querySelector('[data-inbox-nav-badge]');

  if (!badge) {
    return;
  }

  badge.textContent = String(unreadCount ?? 0);

  if (unreadCount > 0) {
    badge.hidden = false;
    badge.setAttribute('aria-label', `${unreadCount} unread inbox items`);
  } else {
    badge.hidden = true;
  }
};

const updateDashboardSummary = (summaryRoot) => {
  if (!summaryRoot) {
    return;
  }

  const unreadCount = Number.parseInt(summaryRoot.dataset.unreadCount ?? '0', 10) || 0;
  const pendingInvites = Number.parseInt(summaryRoot.dataset.pendingInviteCount ?? '0', 10) || 0;
  const unreadInvites = Number.parseInt(summaryRoot.dataset.unreadInvites ?? '0', 10) || 0;
  const unreadMembership =
    Number.parseInt(summaryRoot.dataset.unreadMembership ?? '0', 10) || 0;
  const unreadActivity = Number.parseInt(summaryRoot.dataset.unreadActivity ?? '0', 10) || 0;
  const cards = document.querySelector('[data-dashboard-inbox-summary]');

  updateNavBadge(unreadCount);

  if (!cards) {
    return;
  }

  const unreadNode = cards.querySelector('[data-dashboard-unread-total]');
  const invitesNode = cards.querySelector('[data-dashboard-unread-invites]');
  const activityNode = cards.querySelector('[data-dashboard-unread-activity]');

  if (unreadNode) {
    unreadNode.textContent = String(unreadCount);
  }

  if (invitesNode) {
    invitesNode.textContent = String(Math.max(pendingInvites, unreadInvites));
  }

  if (activityNode) {
    activityNode.textContent = String(unreadMembership + unreadActivity);
  }
};

const refreshSummaryRegion = async (summaryUrl) => {
  const response = await fetch(summaryUrl, {
    credentials: 'same-origin'
  });

  if (!response.ok) {
    throw new Error('Failed to refresh inbox summary.');
  }

  const fragment = await parseHtml(response);
  const summaryRoot = fragment.root;
  const region = document.querySelector('[data-inbox-summary-region]');

  if (region) {
    region.innerHTML = fragment.html;
  }

  updateDashboardSummary(summaryRoot);
  return summaryRoot;
};

const refreshInvitesRegion = async () => {
  const region = document.querySelector('[data-dashboard-invites-region]');

  if (!region) {
    return;
  }

  const response = await fetch('/fragments/inbox/invites', {
    credentials: 'same-origin'
  });

  if (!response.ok) {
    return;
  }

  region.innerHTML = await response.text();
};

const refreshItemsRegion = async ({ itemsUrl, filter, page }) => {
  const region = document.querySelector('[data-inbox-items-region]');

  if (!region) {
    return;
  }

  const url = new URL(itemsUrl, window.location.origin);
  url.searchParams.set('filter', filter || 'all');
  url.searchParams.set('page', String(page || 1));

  const response = await fetch(url, {
    credentials: 'same-origin'
  });

  if (!response.ok) {
    throw new Error('Failed to refresh inbox items.');
  }

  region.innerHTML = await response.text();
};

const readInboxState = () => {
  const itemsRoot = document.querySelector('[data-inbox-items]');

  if (!itemsRoot) {
    return {
      filter: 'all',
      page: 1
    };
  }

  return {
    filter: itemsRoot.dataset.currentFilter || 'all',
    page: Number.parseInt(itemsRoot.dataset.currentPage || '1', 10) || 1
  };
};

const dispatchInboxRefresh = () => {
  document.dispatchEvent(
    new CustomEvent('courier:refresh-inbox', {
      bubbles: true
    })
  );
};

export const initInboxCenter = () => {
  const inboxBoot = readBootJson('[data-inbox-boot]');
  const dashboardBoot = readBootJson('[data-dashboard-boot]');
  const boot = inboxBoot || dashboardBoot;

  if (!boot) {
    return;
  }

  const performRefresh = async () => {
    const { filter, page } = readInboxState();
    const summaryRoot = await refreshSummaryRegion(boot.inboxSummaryUrl);

    if (document.querySelector('[data-inbox-center]')) {
      await refreshItemsRegion({
        itemsUrl: boot.inboxItemsUrl,
        filter,
        page
      });
    }

    await refreshInvitesRegion();
    updateNavBadge(Number.parseInt(summaryRoot?.dataset.unreadCount ?? '0', 10) || 0);
  };

  document.addEventListener('click', async (event) => {
    const markReadButton = event.target.closest('[data-inbox-mark-read]');
    if (markReadButton) {
      event.preventDefault();
      const itemId = markReadButton.dataset.inboxMarkRead;

      await runOnce({
        element: markReadButton,
        action: async () => {
          const response = await csrfFetch(`/api/v1/inbox/items/${itemId}/read`, {
            method: 'POST',
            body: JSON.stringify({})
          });
          const result = await readJson(response);

          if (!response.ok || !result?.ok) {
            throw new Error(getErrorMessage(result, 'Could not mark this inbox item as read.'));
          }

          await performRefresh();
          announce('Inbox item marked as read.');
        }
      }).catch((error) => {
        announce(error.message || 'Could not update the inbox.', 'assertive');
      });
      return;
    }

    const readAllButton = event.target.closest('[data-inbox-read-all]');
    if (readAllButton) {
      event.preventDefault();

      await runOnce({
        element: readAllButton,
        action: async () => {
          const response = await csrfFetch('/api/v1/inbox/read-all', {
            method: 'POST',
            body: JSON.stringify({})
          });
          const result = await readJson(response);

          if (!response.ok || !result?.ok) {
            throw new Error(getErrorMessage(result, 'Could not mark inbox items as read.'));
          }

          await performRefresh();
          announce('Inbox updated.');
        }
      }).catch((error) => {
        announce(error.message || 'Could not update the inbox.', 'assertive');
      });
    }
  });

  document.addEventListener('courier:refresh-inbox', () => {
    performRefresh().catch(() => {});
  });

  if (!window.io) {
    return;
  }

  const socket = createCollabClient();
  let refreshTimer = null;
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      performRefresh().catch(() => {});
    }, 150);
  };

  socket.on('connect', () => {
    for (const projectId of boot.activeProjectIds ?? []) {
      socket.emit('project:join', {
        projectId
      });
    }
  });

  socket.on('invite:created', scheduleRefresh);
  socket.on('invite:updated', scheduleRefresh);
  socket.on('permission:changed', scheduleRefresh);
  socket.on('project:access-revoked', scheduleRefresh);
  socket.on('activity:new', scheduleRefresh);

  window.addEventListener('beforeunload', () => {
    socket.close();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      performRefresh().catch(() => {});
    }
  });
  document.addEventListener('courier:invite-updated', dispatchInboxRefresh);
};

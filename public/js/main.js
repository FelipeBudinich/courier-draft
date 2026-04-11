import { csrfFetch } from './csrf-fetch.js';
import { initEntityRegistryPages } from './entity-registry-pages.js';
import { initInboxCenter } from './inbox-center.js';
import { initInviteActions } from './invite-actions.js';
import { initInviteForm } from './invite-form.js';
import { initLocaleSwitcher } from './locale-switcher.js';
import { initMemberManagement } from './member-management.js';
import { initNotesPanels } from './notes-panel.js';
import { initProfileForm } from './profile-form.js';
import { initProjectCreateForm } from './project-create-form.js';
import { initProjectPresence } from './project-presence.js';
import { initProjectSettingsForms } from './project-settings.js';
import { initScriptSurfaces } from './script-surfaces.js';
import { announce } from './ui/live-announcer.js';

window.csrfFetch = csrfFetch;

const initAuthExpiryBanner = () => {
  window.addEventListener('courier:auth-expired', () => {
    const banner = document.querySelector('[data-auth-expired-banner]');
    if (!banner) {
      return;
    }

    banner.hidden = false;
    banner.className =
      'mb-4 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm text-ink';
    banner.innerHTML = `
      <p class="font-semibold text-ink">Your session expired.</p>
      <p class="mt-1">Sign in again to keep working safely.</p>
      <a class="btn-secondary mt-3" href="/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}">Sign in again</a>
    `;
    announce('Your session expired. Sign in again to continue.', 'assertive');
  });
};

const initializeApp = () => {
  initAuthExpiryBanner();
  initLocaleSwitcher();
  initProfileForm();
  initProjectCreateForm();
  initInboxCenter();
  initInviteActions();
  initInviteForm();
  initMemberManagement();
  initEntityRegistryPages();
  initProjectSettingsForms();
  initProjectPresence();
  initNotesPanels();
  initScriptSurfaces();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}

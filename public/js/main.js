import { csrfFetch } from './csrf-fetch.js';
import { initEntityRegistryPages } from './entity-registry-pages.js';
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

window.csrfFetch = csrfFetch;

const initializeApp = () => {
  initLocaleSwitcher();
  initProfileForm();
  initProjectCreateForm();
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

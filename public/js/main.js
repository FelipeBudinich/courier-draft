import { csrfFetch } from './csrf-fetch.js';
import { initInviteActions } from './invite-actions.js';
import { initInviteForm } from './invite-form.js';
import { initLocaleSwitcher } from './locale-switcher.js';
import { initMemberManagement } from './member-management.js';
import { initProfileForm } from './profile-form.js';
import { initProjectCreateForm } from './project-create-form.js';
import { initProjectPresence } from './project-presence.js';
import { initProjectSettingsForms } from './project-settings.js';

window.csrfFetch = csrfFetch;

document.addEventListener('DOMContentLoaded', () => {
  initLocaleSwitcher();
  initProfileForm();
  initProjectCreateForm();
  initInviteActions();
  initInviteForm();
  initMemberManagement();
  initProjectSettingsForms();
  initProjectPresence();
});

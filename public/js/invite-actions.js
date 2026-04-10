import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson } from './form-helpers.js';

export const initInviteActions = () => {
  const forms = [...document.querySelectorAll('[data-invite-action-form]')];
  if (!forms.length) {
    return;
  }

  for (const form of forms) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const button = form.querySelector('button[type="submit"]');
      button?.setAttribute('disabled', 'disabled');

      const response = await csrfFetch(form.action, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        window.alert(getErrorMessage(result, 'Invite action failed.'));
        button?.removeAttribute('disabled');
        return;
      }

      window.location.reload();
    });
  }
};

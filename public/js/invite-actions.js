import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson } from './form-helpers.js';
import { announce } from './ui/live-announcer.js';
import { runOnce } from './ui/once-action.js';

export const initInviteActions = () => {
  const forms = [...document.querySelectorAll('[data-invite-action-form]')];
  if (!forms.length) {
    return;
  }

  for (const form of forms) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const button = form.querySelector('button[type="submit"]');

      try {
        await runOnce({
          element: button,
          action: async () => {
            const response = await csrfFetch(form.action, {
              method: 'POST',
              body: JSON.stringify({})
            });
            const result = await readJson(response);

            if (!response.ok || !result?.ok) {
              throw new Error(getErrorMessage(result, 'Invite action failed.'));
            }

            document.dispatchEvent(
              new CustomEvent('courier:invite-updated', {
                bubbles: true
              })
            );
            announce('Invite updated.');
          }
        });
      } catch (error) {
        announce(error.message || 'Invite action failed.', 'assertive');
      }
    });
  }
};

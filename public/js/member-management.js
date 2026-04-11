import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson, setFormStatus } from './form-helpers.js';
import { showConfirmDialog } from './ui/dialog-focus.js';
import { announce } from './ui/live-announcer.js';
import { runOnce } from './ui/once-action.js';

export const initMemberManagement = () => {
  const roleForms = [...document.querySelectorAll('[data-member-role-form]')];
  const removeForms = [...document.querySelectorAll('[data-member-remove-form]')];

  for (const form of roleForms) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(form, 'Updating member role…');

      await runOnce({
        element: event.submitter,
        busyText: 'Saving…',
        action: async () => {
          const response = await csrfFetch(
            `/api/v1/projects/${form.dataset.projectId}/members/${form.dataset.memberId}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                role: form.querySelector('select[name="role"]').value
              })
            }
          );
          const result = await readJson(response);

          if (!response.ok || !result?.ok) {
            const message = getErrorMessage(result, 'Member role could not be updated.');
            setFormStatus(form, message, true);
            announce(message, 'assertive');
            return;
          }

          window.location.reload();
        }
      });
    });
  }

  for (const form of removeForms) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const confirmed = await showConfirmDialog({
        title: 'Remove member',
        description: 'Remove this member from the project?',
        confirmText: 'Remove member'
      });
      if (!confirmed) {
        return;
      }

      setFormStatus(form, 'Removing member…');

      await runOnce({
        element: event.submitter,
        busyText: 'Removing…',
        action: async () => {
          const response = await csrfFetch(
            `/api/v1/projects/${form.dataset.projectId}/members/${form.dataset.memberId}`,
            {
              method: 'DELETE'
            }
          );
          const result = await readJson(response);

          if (!response.ok || !result?.ok) {
            const message = getErrorMessage(result, 'Member could not be removed.');
            setFormStatus(form, message, true);
            announce(message, 'assertive');
            return;
          }

          window.location.reload();
        }
      });
    });
  }
};

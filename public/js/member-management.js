import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson } from './form-helpers.js';

export const initMemberManagement = () => {
  const roleForms = [...document.querySelectorAll('[data-member-role-form]')];
  const removeForms = [...document.querySelectorAll('[data-member-remove-form]')];

  for (const form of roleForms) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

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
        window.alert(getErrorMessage(result, 'Member role could not be updated.'));
        return;
      }

      window.location.reload();
    });
  }

  for (const form of removeForms) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const response = await csrfFetch(
        `/api/v1/projects/${form.dataset.projectId}/members/${form.dataset.memberId}`,
        {
          method: 'DELETE'
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        window.alert(getErrorMessage(result, 'Member could not be removed.'));
        return;
      }

      window.location.reload();
    });
  }
};

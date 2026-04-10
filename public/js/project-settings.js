import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson, setFormStatus } from './form-helpers.js';

export const initProjectSettingsForms = () => {
  const settingsForm = document.querySelector('[data-project-settings-form]');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(settingsForm, 'Saving…');

      const response = await csrfFetch(
        `/api/v1/projects/${settingsForm.dataset.projectId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: settingsForm.querySelector('input[name="title"]').value
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        setFormStatus(
          settingsForm,
          getErrorMessage(result, 'Project settings could not be saved.'),
          true
        );
        return;
      }

      window.location.reload();
    });
  }

  const transferForm = document.querySelector('[data-ownership-transfer-form]');
  if (transferForm) {
    transferForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFormStatus(transferForm, 'Transferring…');

      const response = await csrfFetch(
        `/api/v1/projects/${transferForm.dataset.projectId}/ownership-transfer`,
        {
          method: 'POST',
          body: JSON.stringify({
            memberId: transferForm.querySelector('select[name="memberId"]').value
          })
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        setFormStatus(
          transferForm,
          getErrorMessage(result, 'Ownership could not be transferred.'),
          true
        );
        return;
      }

      window.location.reload();
    });
  }
};

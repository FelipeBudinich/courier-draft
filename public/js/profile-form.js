import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson, setFormStatus } from './form-helpers.js';

export const initProfileForm = () => {
  const form = document.querySelector('[data-profile-form]');
  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormStatus(form, 'Saving…');

    const formData = new FormData(form);
    const payload = {
      displayName: String(formData.get('displayName') ?? ''),
      username: String(formData.get('username') ?? '')
    };

    const response = await csrfFetch('/api/v1/me', {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    const result = await readJson(response);

    if (!response.ok || !result?.ok) {
      setFormStatus(form, getErrorMessage(result, 'Profile could not be saved.'), true);
      return;
    }

    setFormStatus(form, 'Saved.');

    if (result.data.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    window.location.reload();
  });
};

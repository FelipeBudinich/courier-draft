import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson, setFormStatus } from './form-helpers.js';

export const initProjectCreateForm = () => {
  const form = document.querySelector('[data-project-create-form]');
  if (!form) {
    return;
  }

  form.dataset.projectCreateReady = 'true';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormStatus(form, 'Creating…');

    const formData = new FormData(form);
    const response = await csrfFetch('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({
        title: String(formData.get('title') ?? '')
      })
    });
    const result = await readJson(response);

    if (!response.ok || !result?.ok) {
      setFormStatus(form, getErrorMessage(result, 'Project could not be created.'), true);
      return;
    }

    window.location.assign(`/projects/${result.data.project.id}`);
  });
};

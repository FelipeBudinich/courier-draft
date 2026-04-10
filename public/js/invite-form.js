import { csrfFetch } from './csrf-fetch.js';
import { getErrorMessage, readJson, setFormStatus } from './form-helpers.js';

const renderCandidate = (user) => `
  <button
    class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-mist/70"
    type="button"
    data-candidate-id="${user.id}"
    data-candidate-label="${user.displayName} (${user.email})"
  >
    <span>
      <span class="block font-semibold text-ink">${user.displayName}</span>
      <span class="block text-sm text-ink/60">${user.username ? `@${user.username} · ` : ''}${user.email}</span>
    </span>
    <span class="badge">Select</span>
  </button>
`;

export const initInviteForm = () => {
  const form = document.querySelector('[data-invite-form]');
  if (!form) {
    return;
  }

  const projectId = form.dataset.projectId;
  const queryInput = form.querySelector('[data-invite-query]');
  const selectedUserInput = form.querySelector('[data-selected-user-id]');
  const resultsNode = form.querySelector('[data-invite-results]');
  let activeSearch = 0;

  const runSearch = async () => {
    const query = queryInput.value.trim();
    selectedUserInput.value = '';

    if (query.length < 2) {
      resultsNode.hidden = true;
      resultsNode.innerHTML = '';
      return;
    }

    const searchId = ++activeSearch;
    const response = await csrfFetch(`/api/v1/users/search?q=${encodeURIComponent(query)}`, {
      method: 'GET'
    });
    const result = await readJson(response);

    if (searchId !== activeSearch) {
      return;
    }

    if (!response.ok || !result?.ok) {
      setFormStatus(form, getErrorMessage(result, 'User search failed.'), true);
      return;
    }

    if (!result.data.users.length) {
      resultsNode.hidden = false;
      resultsNode.innerHTML = '<p class="px-4 py-3 text-sm text-ink/60">No matching users found.</p>';
      return;
    }

    resultsNode.hidden = false;
    resultsNode.innerHTML = result.data.users.map(renderCandidate).join('');
  };

  queryInput.addEventListener('input', () => {
    window.clearTimeout(queryInput._inviteTimer);
    queryInput._inviteTimer = window.setTimeout(runSearch, 180);
  });

  resultsNode.addEventListener('click', (event) => {
    const button = event.target.closest('[data-candidate-id]');
    if (!button) {
      return;
    }

    selectedUserInput.value = button.dataset.candidateId;
    queryInput.value = button.dataset.candidateLabel;
    resultsNode.hidden = true;
    resultsNode.innerHTML = '';
    setFormStatus(form, 'User selected.');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormStatus(form, 'Sending invite…');

    const formData = new FormData(form);
    const payload = {
      role: String(formData.get('role') ?? 'editor')
    };

    const userId = String(formData.get('userId') ?? '');
    const identifier = String(formData.get('query') ?? '').trim();
    if (userId) {
      payload.userId = userId;
    } else {
      payload.identifier = identifier;
    }

    const response = await csrfFetch(`/api/v1/projects/${projectId}/invites`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const result = await readJson(response);

    if (!response.ok || !result?.ok) {
      setFormStatus(form, getErrorMessage(result, 'Invite could not be sent.'), true);
      return;
    }

    window.location.reload();
  });
};

export const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const setFormStatus = (scope, message, isError = false) => {
  const node = scope?.querySelector?.('[data-form-status]') ?? scope;
  if (!node) {
    return;
  }

  node.textContent = message ?? '';
  node.classList.toggle('text-red-700', isError);
  node.classList.toggle('text-ink/55', !isError);
};

export const getErrorMessage = (payload, fallback) =>
  payload?.error?.message || fallback || 'Something went wrong.';

const readCsrfToken = () =>
  document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';

export const csrfFetch = (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('X-CSRF-Token', readCsrfToken());

  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers
  });
};


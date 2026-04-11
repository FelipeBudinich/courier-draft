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
  }).then((response) => {
    if (response.status === 401 || response.status === 403) {
      window.dispatchEvent(
        new CustomEvent('courier:auth-expired', {
          detail: {
            status: response.status
          }
        })
      );
    }

    return response;
  });
};

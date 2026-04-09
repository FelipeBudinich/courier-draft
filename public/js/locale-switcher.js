export const initLocaleSwitcher = () => {
  const forms = document.querySelectorAll('[data-locale-switcher]');

  forms.forEach((form) => {
    const select = form.querySelector('select');
    if (!select) {
      return;
    }

    select.addEventListener('change', () => {
      form.requestSubmit();
    });
  });
};


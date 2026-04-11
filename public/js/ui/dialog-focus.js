const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

const getFocusableElements = (container) =>
  [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hidden && !element.closest('[hidden]')
  );

const applyStatusState = (node, message, isError = false) => {
  if (!node) {
    return;
  }

  node.hidden = !message;
  node.textContent = message ?? '';
  node.classList.toggle('text-rose-700', isError);
  node.classList.toggle('text-ink/60', !isError);
};

const trapFocus = (event, dialog) => {
  if (event.key !== 'Tab') {
    return;
  }

  const focusable = getFocusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || active === dialog) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last) {
    event.preventDefault();
    first.focus();
  }
};

const createDialogShell = ({
  title,
  description,
  confirmText,
  cancelText,
  renderBody
}) => {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-ink/50 px-4 py-8';
  overlay.dataset.dialogOverlay = 'true';

  const dialog = document.createElement('div');
  dialog.className = 'modal-shell w-full max-w-lg';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;

  const titleId = `dialog-title-${Math.random().toString(36).slice(2, 10)}`;
  const descriptionId = `dialog-description-${Math.random().toString(36).slice(2, 10)}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.setAttribute('aria-describedby', descriptionId);

  const wrapper = document.createElement('div');
  wrapper.className = 'space-y-4';

  const header = document.createElement('div');
  header.className = 'space-y-2';

  const heading = document.createElement('h2');
  heading.id = titleId;
  heading.className = 'text-2xl text-ink';
  heading.textContent = title;

  const bodyText = document.createElement('p');
  bodyText.id = descriptionId;
  bodyText.className = 'text-sm leading-7 text-ink/70';
  bodyText.textContent = description;

  header.append(heading, bodyText);

  const form = document.createElement('form');
  form.className = 'space-y-4';

  const body = document.createElement('div');
  body.className = 'space-y-3';
  renderBody?.(body);

  const status = document.createElement('p');
  status.className = 'text-sm text-ink/60';
  status.hidden = true;
  status.dataset.dialogStatus = 'true';

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap justify-end gap-3';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn-secondary';
  cancelButton.dataset.dialogCancel = 'true';
  cancelButton.textContent = cancelText;

  const confirmButton = document.createElement('button');
  confirmButton.type = 'submit';
  confirmButton.className = 'btn-primary';
  confirmButton.dataset.dialogConfirm = 'true';
  confirmButton.textContent = confirmText;

  actions.append(cancelButton, confirmButton);
  form.append(body, status, actions);
  wrapper.append(header, form);
  dialog.append(wrapper);
  overlay.append(dialog);

  return {
    overlay,
    dialog,
    form,
    cancelButton,
    confirmButton,
    status
  };
};

const openDialog = ({
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  renderBody,
  getInitialFocus,
  onConfirm
}) =>
  new Promise((resolve) => {
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const { overlay, dialog, form, cancelButton, status } = createDialogShell({
      title,
      description,
      confirmText,
      cancelText,
      renderBody
    });

    let closed = false;

    const close = (value) => {
      if (closed) {
        return;
      }

      closed = true;
      overlay.removeEventListener('click', handleBackdropClick);
      dialog.removeEventListener('keydown', handleKeyDown);
      cancelButton.removeEventListener('click', handleCancel);
      form.removeEventListener('submit', handleSubmit);
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      previousActive?.focus?.({ preventScroll: true });
      resolve(value);
    };

    const handleBackdropClick = (event) => {
      if (event.target === overlay) {
        close(null);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
        return;
      }

      trapFocus(event, dialog);
    };

    const handleCancel = () => {
      close(null);
    };

    const handleSubmit = async (event) => {
      event.preventDefault();
      applyStatusState(status, null);

      try {
        const result = await onConfirm({
          dialog,
          form,
          close,
          setError(message) {
            applyStatusState(status, message, true);
          }
        });

        if (result !== undefined) {
          close(result);
        }
      } catch (error) {
        applyStatusState(status, error.message ?? 'This action could not be completed.', true);
      }
    };

    overlay.addEventListener('click', handleBackdropClick);
    dialog.addEventListener('keydown', handleKeyDown);
    cancelButton.addEventListener('click', handleCancel);
    form.addEventListener('submit', handleSubmit);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';

    window.requestAnimationFrame(() => {
      const preferredFocus = getInitialFocus?.(dialog);
      const fallbackFocus = getFocusableElements(dialog)[0];
      (preferredFocus ?? fallbackFocus ?? dialog).focus();
    });
  });

export const showConfirmDialog = ({
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel'
}) =>
  openDialog({
    title,
    description,
    confirmText,
    cancelText,
    renderBody: null,
    onConfirm: async () => true
  }).then((result) => Boolean(result));

export const showPromptDialog = ({
  title,
  description,
  label = 'Value',
  initialValue = '',
  placeholder = '',
  confirmText = 'Save',
  cancelText = 'Cancel',
  allowEmpty = false
}) => {
  let input = null;

  return openDialog({
    title,
    description,
    confirmText,
    cancelText,
    renderBody(container) {
      const field = document.createElement('label');
      field.className = 'space-y-2';

      const labelText = document.createElement('span');
      labelText.className = 'block text-sm font-semibold text-ink';
      labelText.textContent = label;

      input = document.createElement('input');
      input.className = 'field-input';
      input.type = 'text';
      input.value = initialValue;
      input.placeholder = placeholder;
      input.autocomplete = 'off';

      field.append(labelText, input);
      container.append(field);
    },
    getInitialFocus() {
      return input;
    },
    async onConfirm({ setError }) {
      const value = input?.value?.trim?.() ?? '';

      if (!allowEmpty && !value) {
        setError('A value is required.');
        input?.focus();
        return undefined;
      }

      return value;
    }
  });
};

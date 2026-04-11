import {
  replaceSluglineLocation,
  splitSluglineParts
} from '../../../src/services/entities/location-extract.js';

const normalizeQuery = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const createApiError = (payload, fallbackMessage) => {
  const error = new Error(payload?.error?.message ?? fallbackMessage);
  error.code = payload?.error?.code ?? 'SERVER_ERROR';
  error.details = payload?.error?.details ?? null;
  return error;
};

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const getAutocompleteContext = (blockContext) => {
  if (!blockContext) {
    return null;
  }

  if (blockContext.blockType === 'character') {
    const query = String(blockContext.text ?? '').trim();
    return query
      ? {
          type: 'character',
          query,
          text: blockContext.text
        }
      : null;
  }

  if (blockContext.blockType === 'slugline') {
    const parts = splitSluglineParts(blockContext.text);
    if (!parts?.location) {
      return null;
    }

    return {
      type: 'location',
      query: parts.location,
      text: blockContext.text
    };
  }

  return null;
};

const positionAutocompleteRoot = (root, anchor) => {
  const page = root.closest('[data-editor-page]');
  if (!page || !anchor) {
    return;
  }

  const pageRect = page.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  root.style.left = `${Math.max(0, anchorRect.left - pageRect.left)}px`;
  root.style.top = `${Math.max(0, anchorRect.bottom - pageRect.top + 8)}px`;
  root.style.width = `${Math.min(360, Math.max(240, anchorRect.width))}px`;
};

const buildSuggestionMarkup = (suggestion, isActive) => `
  <button
    class="w-full rounded-2xl border px-3 py-3 text-left transition ${
      isActive
        ? 'border-accent/40 bg-white shadow-panel'
        : 'border-transparent bg-mist/70 hover:border-ink/10 hover:bg-white'
    }"
    type="button"
    data-entity-autocomplete-option="${suggestion.id}"
  >
    <span class="block font-semibold text-ink">${suggestion.canonicalName}</span>
    ${
      suggestion.aliases?.length
        ? `<span class="mt-1 block text-xs text-ink/55">${suggestion.aliases
            .map((alias) => alias.display)
            .join(', ')}</span>`
        : ''
    }
  </button>
`;

export const createEntityAutocompleteController = ({
  root,
  projectId
}) => {
  const state = {
    editor: null,
    cache: new Map(),
    requestId: 0,
    refreshTimer: null,
    visible: false,
    suggestions: [],
    activeIndex: 0,
    context: null,
    keyboardNavigationActive: false
  };

  const hide = () => {
    state.visible = false;
    state.suggestions = [];
    state.context = null;
    state.keyboardNavigationActive = false;
    root.classList.add('hidden');
    root.hidden = true;
    root.innerHTML = '';
  };

  const render = () => {
    if (!state.context?.dom || !state.suggestions.length) {
      hide();
      return;
    }

    positionAutocompleteRoot(root, state.context.dom);
    state.keyboardNavigationActive = false;
    root.classList.remove('hidden');
    root.hidden = false;
    root.innerHTML = `
      <div class="rounded-[1.5rem] border border-ink/10 bg-white/95 p-2 shadow-panel backdrop-blur">
        <p class="px-3 py-2 text-xs uppercase tracking-[0.18em] text-ink/45">
          ${state.context.type === 'character' ? 'Character' : 'Location'} suggestions
        </p>
        <div class="space-y-2">
          ${state.suggestions
            .map((suggestion, index) =>
              buildSuggestionMarkup(suggestion, index === state.activeIndex)
            )
            .join('')}
        </div>
      </div>
    `;
    state.visible = true;
  };

  const fetchSuggestions = async (type, query) => {
    const normalizedQuery = normalizeQuery(query);
    const cacheKey = `${type}:${normalizedQuery}`;

    if (state.cache.has(cacheKey)) {
      return state.cache.get(cacheKey);
    }

    const response = await fetch(
      `/api/v1/projects/${projectId}/entities?type=${encodeURIComponent(type)}&q=${encodeURIComponent(query)}&autocomplete=true`,
      {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json'
        }
      }
    );
    const payload = await readJson(response);

    if (!response.ok || !payload?.ok) {
      throw createApiError(payload, 'Entity suggestions could not be loaded.');
    }

    const suggestions = (payload.data.entities ?? []).slice(0, 8);
    state.cache.set(cacheKey, suggestions);
    return suggestions;
  };

  const applySuggestion = (suggestion) => {
    if (!state.editor || !state.context) {
      return;
    }

    const nextText =
      state.context.type === 'character'
        ? suggestion.canonicalName
        : replaceSluglineLocation(state.context.text, suggestion.canonicalName);

    if (!nextText) {
      return;
    }

    state.editor.replaceCurrentBlockText(nextText);
    state.editor.focus();
    hide();
  };

  const refresh = async () => {
    const currentEditor = state.editor;
    if (!currentEditor || currentEditor.readOnly) {
      hide();
      return;
    }

    const blockContext = currentEditor.getCurrentBlockContext();
    const autocompleteContext = getAutocompleteContext(blockContext);
    if (!autocompleteContext?.query) {
      hide();
      return;
    }

    const requestId = ++state.requestId;
    const suggestions = await fetchSuggestions(
      autocompleteContext.type,
      autocompleteContext.query
    );

    if (requestId !== state.requestId || currentEditor !== state.editor) {
      return;
    }

    state.context = {
      ...autocompleteContext,
      dom: blockContext.dom
    };
    state.activeIndex = 0;
    state.suggestions = suggestions;

    if (!suggestions.length) {
      hide();
      return;
    }

    render();
  };

  const scheduleRefresh = () => {
    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
    }

    state.refreshTimer = window.setTimeout(() => {
      void refresh().catch(() => {
        hide();
      });
    }, 120);
  };

  const handleKeyDown = (event) => {
    if (
      !state.visible ||
      !state.suggestions.length ||
      !document.activeElement?.closest('.ProseMirror')
    ) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.keyboardNavigationActive = true;
      state.activeIndex = (state.activeIndex + 1) % state.suggestions.length;
      render();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.keyboardNavigationActive = true;
      state.activeIndex =
        (state.activeIndex - 1 + state.suggestions.length) %
        state.suggestions.length;
      render();
      return;
    }

    if (event.key === 'Enter' && state.keyboardNavigationActive) {
      event.preventDefault();
      applySuggestion(state.suggestions[state.activeIndex]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    }
  };

  const handleRootClick = (event) => {
    const option = event.target.closest('[data-entity-autocomplete-option]');
    if (!option) {
      return;
    }

    const suggestion = state.suggestions.find(
      (candidate) => candidate.id === option.dataset.entityAutocompleteOption
    );
    if (!suggestion) {
      return;
    }

    applySuggestion(suggestion);
  };

  root.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  root.addEventListener('click', handleRootClick);
  document.addEventListener('keydown', handleKeyDown);

  return {
    setEditor(editor) {
      state.editor = editor;
      hide();
      scheduleRefresh();
    },
    scheduleRefresh,
    invalidateCache() {
      state.cache.clear();
    },
    dispose() {
      if (state.refreshTimer) {
        window.clearTimeout(state.refreshTimer);
      }

      document.removeEventListener('keydown', handleKeyDown);
      root.removeEventListener('click', handleRootClick);
      hide();
    }
  };
};

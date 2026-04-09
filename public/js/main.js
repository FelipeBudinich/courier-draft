import { csrfFetch } from './csrf-fetch.js';
import { initLocaleSwitcher } from './locale-switcher.js';

window.csrfFetch = csrfFetch;

document.addEventListener('DOMContentLoaded', () => {
  initLocaleSwitcher();
});


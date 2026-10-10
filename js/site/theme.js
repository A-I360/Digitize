/**
 * Theme controller.
 *
 * The initial theme is applied by a tiny inline script in <head> before first
 * paint, so there is no flash. This module only wires up the toggle.
 */

import { $, $$ } from './lib/dom.js';
import { store } from './lib/storage.js';

const KEY = 'theme';

export function currentTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function apply(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);

  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#080d18' : '#ffffff');

  $$('[data-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(dark));
    const label = btn.querySelector('[data-theme-label]');
    if (label) label.textContent = dark ? 'Light' : 'Dark';
    btn.setAttribute('title', dark ? 'Switch to light theme' : 'Switch to dark theme');
  });

  store.set(KEY, theme);
}

export function initTheme() {
  apply(currentTheme());

  $$('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      apply(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  });

  // Follow the OS when the visitor has not made an explicit choice.
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', (e) => {
    if (store.get(KEY) === null) apply(e.matches ? 'dark' : 'light');
  });
}

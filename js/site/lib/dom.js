/** Tiny DOM helpers — no framework, no dependencies. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escapes text before it is interpolated into an HTML template. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a value used inside an href/src attribute. */
export function escAttr(value) {
  return esc(value).replace(/`/g, '&#96;');
}

export function el(tag, attrs = {}, html = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === false || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  if (html) node.innerHTML = html;
  return node;
}

/** Fires `fn` once the DOM is ready — safe to call at any point. */
export function ready(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Splits an array into `count` roughly equal columns. */
export function chunk(list, count) {
  const out = Array.from({ length: count }, () => []);
  list.forEach((item, i) => out[i % count].push(item));
  return out;
}

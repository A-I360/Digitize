/**
 * Scroll reveals + number counters.
 *
 * Fails safe: if IntersectionObserver is unavailable the content is shown
 * immediately rather than staying at opacity 0.
 */

import { $$, prefersReducedMotion } from './lib/dom.js';

function runCounter(node) {
  if (node.dataset.counted) return;
  node.dataset.counted = '1';

  const end = Number(node.dataset.count);
  const suffix = node.dataset.suffix || '';
  const prefix = node.dataset.prefix || '';
  if (!Number.isFinite(end)) return;

  if (prefersReducedMotion()) {
    node.textContent = prefix + end + suffix;
    return;
  }

  const duration = 1200;
  const start = performance.now();

  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = prefix + Math.round(eased * end) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function initReveal(root = document) {
  const targets = $$('.reveal', root).filter((n) => !n.classList.contains('is-visible'));

  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    targets.forEach((n) => n.classList.add('is-visible'));
    $$('[data-count]', root).forEach(runCounter);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        $$('[data-count]', entry.target).forEach(runCounter);
        if (entry.target.matches('[data-count]')) runCounter(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  );

  targets.forEach((node) => observer.observe(node));

  // Anything already in view on load should not wait for a scroll.
  requestAnimationFrame(() => {
    targets.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
        node.classList.add('is-visible');
        $$('[data-count]', node).forEach(runCounter);
        if (node.matches('[data-count]')) runCounter(node);
        observer.unobserve(node);
      }
    });
  });
}

/** Staggers direct children of a container for a cascading entrance. */
export function stagger(container, step = 70, cap = 600) {
  if (!container) return;
  Array.from(container.children).forEach((child, i) => {
    if (child.classList.contains('reveal')) {
      child.style.setProperty('--reveal-delay', `${Math.min(i * step, cap)}ms`);
    }
  });
}

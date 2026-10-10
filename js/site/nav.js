/**
 * Navigation: mobile drawer, active-link marking, header state, back-to-top.
 */

import { $, $$ } from './lib/dom.js';
import { prefersReducedMotion } from './lib/dom.js';

const NAV_FLAG = 'navigating';

function isExternal(href, link) {
  return (
    link.target === '_blank' ||
    link.hasAttribute('download') ||
    link.dataset.noTransition === '' ||
    link.hasAttribute('data-no-transition') ||
    /^(https?:)?\/\//i.test(href) ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('#')
  );
}

export function initNav() {
  const toggle = $('[data-menu-toggle]');
  const links = $('[data-nav-links]');
  const header = $('[data-site-header]');

  /* ---- Mobile drawer -------------------------------------------------- */
  if (toggle && links) {
    const setOpen = (open) => {
      links.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      document.body.style.overflow = open ? 'hidden' : '';
    };

    toggle.addEventListener('click', () => {
      setOpen(!links.classList.contains('is-open'));
    });

    links.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && links.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });

    document.addEventListener('click', (e) => {
      if (!links.classList.contains('is-open')) return;
      if (e.target.closest('[data-site-header]')) return;
      setOpen(false);
    });

    // A resize past the breakpoint must not leave the body locked.
    window.matchMedia('(min-width: 1081px)').addEventListener?.('change', (e) => {
      if (e.matches) setOpen(false);
    });
  }

  /* ---- Active link ---------------------------------------------------- */
  const here = location.pathname.split('/').pop() || 'index.html';
  $$('[data-nav-links] a').forEach((a) => {
    const target = a.getAttribute('href').split('#')[0].split('?')[0];
    const targetFile = target.split('/').pop() || 'index.html';
    if (targetFile === here) {
      a.setAttribute('aria-current', 'page');
    } else {
      a.removeAttribute('aria-current');
    }
  });

  /* ---- Header elevation + back to top --------------------------------- */
  const backTop = $('[data-back-top]');
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      header?.classList.toggle('is-stuck', y > 24);
      backTop?.classList.toggle('is-visible', y > 700);
      ticking = false;
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  backTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    $('[data-skip-target]')?.focus?.({ preventScroll: true });
  });

  /* ---- Internal link hand-off ----------------------------------------- */
  // Delegated so it also covers links rendered later (project cards, etc.).
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    if (!href || isExternal(href, link)) return;

    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    // Same page + hash only: let the browser handle it (smooth scroll).
    if (url.pathname === location.pathname && url.hash) return;
    if (url.pathname === location.pathname && !url.hash) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }

    e.preventDefault();
    window.SYNQ.transition?.go(url.href);
  });

  document.addEventListener('synq:navigate-start', () => {
    document.body.dataset[NAV_FLAG] = '1';
  });
}

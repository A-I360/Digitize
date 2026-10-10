/**
 * Site entry point.
 *
 * Modules are loaded as ES modules, so the site must be served over HTTP —
 * opening the files from disk (file://) will block module loading. See README.
 */

import { $, ready } from './lib/dom.js';
import { initTransition } from './transition.js';
import { initTheme } from './theme.js';
import { initNav } from './nav.js';
import { mountChrome } from './chrome.js';
import { initReveal } from './reveal.js';

import { initHome } from './pages/home.js';
import { initPortfolio } from './pages/portfolio.js';
import { initProjectPage } from './pages/project.js';
import { initServices } from './pages/services.js';
import { initContact } from './pages/contact.js';
import { emitForPage } from './structured-data.js';

const PAGES = {
  home: [initHome],
  portfolio: [initPortfolio],
  project: [initProjectPage],
  services: [initServices],
  contact: [initContact],
  about: [],
};

function runReveals() {
  initReveal();
  document.documentElement.classList.add('js-ready');
}

/**
 * Reveals are held back until the boot loader has lifted (unless we arrived
 * through an internal navigation, in which case there is no loader).
 * A failsafe timer guarantees they always run.
 */
function scheduleReveals() {
  const loader = $('[data-boot-loader]');
  if (loader && !loader.hidden && !loader.classList.contains('is-done')) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      runReveals();
    };
    document.addEventListener('synq:boot-complete', go, { once: true });
    setTimeout(go, 2600);
  } else {
    runReveals();
  }
}

function boot() {
  mountChrome();
  initTheme();
  initTransition();
  initNav();

  const page = document.body.dataset.page || 'home';

  // Structured data is built from config.js, so it can never claim anything
  // the page itself does not also say.
  try {
    const params = new URLSearchParams(location.search);
    emitForPage(page, { slug: params.get('slug') || undefined });
  } catch (error) {
    console.error('[synq] structured data failed', error);
  }

  (PAGES[page] || []).forEach((init) => {
    try {
      init();
    } catch (error) {
      // One broken page module must not take the whole site down.
      console.error(`[synq] page module "${page}" failed`, error);
    }
  });

  scheduleReveals();
}

ready(boot);

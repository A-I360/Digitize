/**
 * Loading experience + route transitions.
 *
 * Two visuals, used in two different situations:
 *
 *   boot loader  — first paint of a session. Progress is driven by real
 *                  readiness signals (fonts, window load) and bounded by a
 *                  hard cap so it can never hang.
 *   route veil   — internal navigation. Panels sweep up on exit and away on
 *                  entrance. On very fast navigations the whole thing is
 *                  ~400ms, not a full loading sequence.
 *
 * Safety properties:
 *   - never blocks navigation (the veil is pointer-transparent until it is
 *     actually leaving, and every overlay has an independent inline failsafe
 *     in the page <head>)
 *   - duplicate navigation is impossible (single `busy` latch)
 *   - back / forward and bfcache restores are handled
 *   - reduced-motion collapses every duration
 */

import { $, ready, prefersReducedMotion } from './lib/dom.js';
import { sessionStore } from './lib/storage.js';

const NAV_KEY = 'navigating';
const COVER_MS = 420; // must match .route-veil__panel transition-delay chain
const REVEAL_MS = 460;
const BOOT_MIN_MS = 620;
const BOOT_MAX_MS = 2000;

const reduced = prefersReducedMotion();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Resolves when the page is genuinely usable, or after the cap. */
function whenReady() {
  const signals = [];

  signals.push(
    new Promise((resolve) => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve, { once: true });
    })
  );

  if (document.fonts?.ready) {
    signals.push(document.fonts.ready.catch(() => {}));
  }

  const cap = new Promise((resolve) => setTimeout(resolve, BOOT_MAX_MS));
  // The first hero image, if any, is worth waiting a beat for.
  const heroImg = document.querySelector('[data-boot-image]');
  if (heroImg && !heroImg.complete) {
    signals.push(
      new Promise((resolve) => {
        heroImg.addEventListener('load', resolve, { once: true });
        heroImg.addEventListener('error', resolve, { once: true });
      })
    );
  }

  return Promise.race([Promise.all(signals), cap]);
}

function buildVeil() {
  if ($('[data-route-veil]')) return $('[data-route-veil]');
  const veil = document.createElement('div');
  veil.className = 'route-veil';
  veil.id = 'route-veil';
  veil.setAttribute('data-route-veil', '');
  veil.setAttribute('aria-hidden', 'true');
  veil.innerHTML =
    '<div class="route-veil__panel"></div>'.repeat(5) +
    '<div class="route-veil__mark"><span>SYNQ</span></div>';
  document.body.appendChild(veil);
  return veil;
}

class Transition {
  constructor() {
    this.busy = false;
    this.veil = null;
  }

  init() {
    this.veil = buildVeil();

    const wasNav = sessionStore.take(NAV_KEY) === '1';
    document.documentElement.classList.remove('is-route-nav');

    if (wasNav) {
      // Coming from another page: skip the boot loader entirely.
      const boot = $('[data-boot-loader]');
      if (boot) {
        boot.classList.add('is-done');
        boot.hidden = true;
      }
      this.reveal();
    } else {
      this.boot();
    }

    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      // Restored from the back/forward cache: make sure nothing is covering.
      this.busy = false;
      this.veil.classList.remove('is-covering', 'is-busy');
      this.veil.classList.add('is-revealing');
    });

    window.addEventListener('pagehide', () => {
      this.veil.classList.remove('is-busy');
    });
  }

  /** First load of a session. */
  async boot() {
    const boot = $('[data-boot-loader]');
    const fill = boot?.querySelector('[data-boot-fill]');
    const pct = boot?.querySelector('[data-boot-pct]');

    if (boot) {
      boot.hidden = false;
      document.documentElement.classList.add('is-booting');
    }

    // Progress ticks on a curve that decelerates, then snaps to 100 on ready.
    let value = 0;
    const timer = setInterval(() => {
      value = Math.min(92, value + Math.max(1.5, (92 - value) * 0.14));
      if (fill) fill.style.width = `${value}%`;
      if (pct) pct.textContent = `${Math.round(value)}%`;
    }, 90);

    const startedAt = performance.now();
    await whenReady();
    const elapsed = performance.now() - startedAt;
    if (elapsed < BOOT_MIN_MS) await wait(BOOT_MIN_MS - elapsed);

    clearInterval(timer);
    if (fill) fill.style.width = '100%';
    if (pct) pct.textContent = '100%';
    await wait(reduced ? 0 : 180);

    if (boot) {
      boot.classList.add('is-done');
      setTimeout(() => {
        boot.hidden = true;
      }, reduced ? 0 : 460);
    }
    document.documentElement.classList.remove('is-booting');
    document.body.classList.add('page-enter');
    document.dispatchEvent(new CustomEvent('synq:boot-complete'));
  }

  /** Entrance after an internal navigation. */
  async reveal() {
    const veil = this.veil;
    // Start from "covered", then let the panels sweep away.
    veil.classList.add('is-covering');
    await nextFrame();
    veil.classList.remove('is-covering');
    veil.classList.add('is-revealing');
    document.body.classList.add('page-enter');
    setTimeout(() => {
      veil.classList.remove('is-revealing', 'is-busy');
    }, reduced ? 90 : REVEAL_MS);
  }

  /** Exit to another internal page. */
  async go(href) {
    if (this.busy) return;
    this.busy = true;

    const veil = this.veil;
    veil.classList.add('is-busy', 'is-covering');

    try {
      sessionStore.set(NAV_KEY, '1');
    } catch {
      /* storage blocked — navigation still works, just without the sweep */
    }

    await wait(reduced ? 90 : COVER_MS);
    window.location.href = href;

    // If the browser somehow declines to navigate, release the latch.
    setTimeout(() => {
      this.busy = false;
      veil.classList.remove('is-busy', 'is-covering');
    }, 3000);
  }
}

export function initTransition() {
  const instance = new Transition();
  window.SYNQ = window.SYNQ || {};
  window.SYNQ.transition = instance;
  ready(() => instance.init());
  return instance;
}

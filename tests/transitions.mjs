/**
 * Loading and route-transition test.
 *
 * The brief asks for a branded loading animation and page transitions that
 * survive back/forward, direct URLs and refreshes, without ever leaving a
 * stuck loader or double-navigating. Those are all claims about behaviour
 * under awkward timing, which is exactly the kind of thing that rots quietly.
 *
 *   node tests/transitions.mjs
 */

import { loadPage, closeAllWindows, wait, hasJsdom } from './helpers/env.mjs';

if (!hasJsdom) {
  console.log('jsdom is not installed — skipping the transition test.');
  console.log('Install it with:  npm install');
  process.exit(0);
}

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

const consoleErrors = [];
const realError = console.error;
console.error = (...args) => { consoleErrors.push(args.join(' ')); realError(...args); };

// The store adds its own `synq:` prefix, so the key here is the bare name —
// double-prefixing it was the bug that made three of these checks lie.
const NAV_KEY = 'navigating';

/**
 * storage.js resolves its session backend when it is first imported, so it
 * keeps pointing at whichever window was current at that moment. Every later
 * window's own sessionStorage is invisible to it — the flag has to be written
 * through the store itself, which is what the module actually reads.
 */
const { sessionStore } = await import('../js/site/lib/storage.js');

/** jsdom refuses real navigation and says so on the console. */
const navigationAttempts = () =>
  consoleErrors.filter((m) => /Not implemented: navigation/.test(m)).length;

/** Imports transition.js fresh, so module-level state is rebuilt. */
async function freshTransition(cacheKey) {
  return (await import(`../js/site/transition.js?${cacheKey}`)).initTransition();
}

/* -------------------------------------------------------------------------- */

section('A cold visit shows the loader, then gets out of the way');
{
  const env = loadPage('index.html');
  const { document, window } = env;

  let bootComplete = false;
  document.addEventListener('synq:boot-complete', () => { bootComplete = true; });

  const instance = await freshTransition('cold');
  await wait(60);

  const boot = document.querySelector('[data-boot-loader]');
  expect(Boolean(boot), 'there is a boot loader in the page');
  expect(boot && !boot.hidden, 'and it is visible while the page settles');
  expect(document.documentElement.classList.contains('is-booting'),
    'the document is marked as booting');

  const pct = document.querySelector('[data-boot-pct]');
  await wait(400);
  const midway = Number((pct?.textContent || '0').replace(/\D/g, ''));
  expect(midway > 0, `progress is reported as it goes (${midway}%)`);

  // BOOT_MIN_MS is 620 and the loader waits 460ms after the last frame.
  await wait(1600);
  expect(bootComplete, 'the page announces that booting finished');
  expect(boot.classList.contains('is-done'), 'the loader is told to finish');
  await wait(700);
  expect(boot.hidden, 'and is then actually removed from view');
  expect(!document.documentElement.classList.contains('is-booting'),
    'the booting flag is cleared');
  expect(document.body.classList.contains('page-enter'),
    'the entrance animation is applied to the body');

  const veil = document.querySelector('[data-route-veil]');
  expect(Boolean(veil), 'a route veil exists for later navigations');
  expect(veil?.getAttribute('aria-hidden') === 'true',
    'and it is hidden from assistive technology');
  closeAllWindows();
}

section('The loader cannot hang, even if nothing ever loads');
{
  const env = loadPage('index.html');
  const { document, window } = env;

  // The worst case: window.load never fires and fonts never resolve. The
  // BOOT_MAX_MS cap is the only thing standing between this and a visitor
  // staring at a frozen loader forever.
  //
  // 'interactive', not 'loading': `ready()` defers to DOMContentLoaded only
  // while the document reports 'loading', and that event has already been
  // and gone — init() would never run at all.
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'interactive' });
  Object.defineProperty(window, 'fonts', {
    configurable: true,
    value: { ready: new Promise(() => {}) }, // never settles
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: new Promise(() => {}) },
  });

  let bootComplete = false;
  document.addEventListener('synq:boot-complete', () => { bootComplete = true; });

  const started = Date.now();
  await freshTransition('hung');
  await wait(2900); // BOOT_MAX_MS 2000 + the 460ms exit

  const boot = document.querySelector('[data-boot-loader]');
  expect(bootComplete,
    `booting still completes when every signal hangs (${Date.now() - started}ms)`);
  expect(boot.hidden, 'and the loader is gone');
  expect(!document.documentElement.classList.contains('is-booting'),
    'with the booting flag cleared, so nothing is left covering the page');
  closeAllWindows();
}

section('An internal navigation skips the loader entirely');
{
  const env = loadPage('about.html');
  const { document, window } = env;
  // The previous page set this just before it navigated.
  sessionStore.set(NAV_KEY, '1');

  const started = Date.now();
  await freshTransition('nav');
  await wait(120);

  const boot = document.querySelector('[data-boot-loader]');
  expect(boot && boot.hidden,
    'the boot loader is never shown — this is not a new session');
  expect(sessionStore.get(NAV_KEY) === null,
    'the navigation flag is consumed, so a refresh starts a fresh boot');

  const veil = document.querySelector('[data-route-veil]');
  expect(veil.classList.contains('is-revealing'),
    'the veil is revealing, which is the entrance half of the transition');
  expect(document.body.classList.contains('page-enter'),
    'and the page entrance runs straight away');

  // The whole point: a fast navigation is not padded out with a full
  // loading sequence. BOOT_MIN_MS (620ms) must not apply here.
  expect(Date.now() - started < 400,
    `and it is over quickly (${Date.now() - started}ms, no 620ms boot floor)`);

  await wait(600);
  expect(!veil.classList.contains('is-revealing'),
    'the veil clears itself once the sweep is done');
  closeAllWindows();
}

section('Duplicate navigation is impossible');
{
  const env = loadPage('index.html');
  const { document, window } = env;
  const instance = await freshTransition('dup');
  await wait(60);

  expect(instance.busy === false, 'nothing is in flight to begin with');

  instance.go('/about.html');
  // Half way through the cover sweep, before it navigates.
  await wait(40);
  expect(instance.busy === true, 'the first click latches the transition');

  // Wipe the flag it set. If a second call gets through, it will set it again.
  sessionStore.remove(NAV_KEY);
  instance.go('/services.html');
  await wait(40);

  expect(!sessionStore.get(NAV_KEY),
    'a second click while one is in flight is ignored');

  await wait(500);
  const attempts = navigationAttempts();
  expect(attempts <= 1, `the browser is asked to navigate at most once (${attempts})`);
  closeAllWindows();
}

section('Back, forward and the back/forward cache');
{
  const env = loadPage('index.html');
  const { document, window } = env;
  const instance = await freshTransition('bfcache');
  await wait(60);

  const veil = document.querySelector('[data-route-veil]');

  // Leave mid-transition, the way the back/forward cache can restore a page.
  instance.go('/about.html');
  await wait(40);
  expect(instance.busy === true, 'the page was mid-navigation');

  window.dispatchEvent(new window.Event('pagehide'));
  expect(!veil.classList.contains('is-busy'),
    'leaving the page releases the busy latch on the veil');

  // Restored from bfcache: nothing may be left covering the page.
  veil.classList.add('is-covering');
  const show = new window.Event('pageshow');
  show.persisted = true;
  window.dispatchEvent(show);
  await wait(40);

  expect(instance.busy === false, 'a bfcache restore clears the latch');
  expect(!veil.classList.contains('is-covering'),
    'and takes the covering veil away, so the restored page is visible');
  expect(veil.classList.contains('is-revealing'),
    'it reveals instead, which is the correct entrance');

  // A page shown normally (not from bfcache) must not be disturbed.
  const plain = new window.Event('pageshow');
  plain.persisted = false;
  veil.classList.add('is-covering');
  window.dispatchEvent(plain);
  await wait(20);
  expect(veil.classList.contains('is-covering'),
    'a normal pageshow leaves the veil alone');
  closeAllWindows();
}

section('A declined navigation releases the latch');
{
  const env = loadPage('index.html');
  const { document, window } = env;
  const instance = await freshTransition('declined');
  await wait(60);

  instance.go('/about.html');
  await wait(60);
  expect(instance.busy === true, 'the transition starts');

  // jsdom will not actually navigate. The failsafe is what stops the visitor
  // being stuck behind a veil if a real browser also declines. It fires 1.2s
  // after the navigation attempt, which itself happens COVER_MS (420ms) in.
  await wait(1900);
  expect(instance.busy === false, 'and the latch releases if navigation never happens');
  const veil = document.querySelector('[data-route-veil]');
  expect(!veil.classList.contains('is-covering'),
    'with the veil taken away so the page is readable again');
  closeAllWindows();
}

section('Reduced motion collapses every duration');
{
  const env = loadPage('index.html');
  const { window, document } = env;
  window.matchMedia = (q) => ({
    matches: /prefers-reduced-motion/.test(q),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });

  const started = Date.now();
  await freshTransition('reduced');
  await wait(1000);

  const boot = document.querySelector('[data-boot-loader]');
  expect(boot.hidden, 'the loader still completes with reduced motion');
  expect(!document.documentElement.classList.contains('is-booting'),
    'and the boot flag is still cleared');

  // With motion reduced there is no 180ms hold and no 460ms exit.
  expect(Date.now() - started < 1400,
    `and it finishes sooner than the animated path (${Date.now() - started}ms)`);
  closeAllWindows();
}

section('The inline failsafes in the page head');
{
  // transition.js is a module: if it never runs, the inline script in <head>
  // is the only thing that can clear the overlays. It must not depend on
  // anything the module provides.
  const env = loadPage('index.html');
  const { document } = env;
  await wait(80); // the inline script scaffolds on DOMContentLoaded

  const boot = document.querySelector('[data-boot-loader]');
  const veil = document.querySelector('[data-route-veil]');
  expect(Boolean(boot) && Boolean(veil),
    'the inline script scaffolds both overlays before any module runs');
  expect(boot.getAttribute('role') === 'status' && boot.getAttribute('aria-live') === 'polite',
    'the loader announces itself politely to a screen reader');

  // Simulate a route navigation whose module never boots.
  document.documentElement.classList.add('is-route-nav');
  veil.classList.add('is-covering', 'is-busy');
  await wait(2700);
  expect(!veil.classList.contains('is-covering'),
    'the head script clears a stuck veil on its own, without the module');

  await wait(1200);
  expect(boot.classList.contains('is-done') || boot.hidden,
    'and eventually clears the loader too, so nothing can trap the visitor');
  closeAllWindows();
}

/* -------------------------------------------------------------------------- */

console.error = realError;
closeAllWindows();
console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);

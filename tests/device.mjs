/**
 * Device behaviour — the things that only show up on a real phone, a background
 * tab, or a browser that refuses to play audio before you touch anything.
 *
 * These are all claims the code makes about itself: the loop idles when the tab
 * is hidden, touch controls appear only where a finger can reach them, the game
 * never scrolls the page out from under you, and a browser with no Web Audio
 * does not take the game down with it.
 *
 *   node tests/device.mjs
 */

import { loadPage, closeAllWindows, wait, hasJsdom } from './helpers/env.mjs';
import { STATE } from '../js/game/game.js';

if (!hasJsdom) {
  console.log('jsdom is not installed — skipping the device behaviour test.');
  console.log('Install it with:  npm install');
  process.exit(0);
}

// Load a throwaway page first. storage.js resolves its localStorage backend at
// import time, so the globals have to exist before main.js is imported.
loadPage('game.html');
const { GamePage } = await import('../js/game/main.js');
await wait(20);

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

const consoleErrors = [];
const realError = console.error;
console.error = (...args) => { consoleErrors.push(args.join(' ')); realError(...args); };

const pages = [];

/**
 * Loads game.html with a given pointer type and boots a controller on it.
 * jsdom has no media query engine, so `(pointer: coarse)` is stubbed.
 */
async function boot({ coarsePointer = false, noAudio = false } = {}) {
  const env = loadPage('game.html');
  const { window } = env;
  window.matchMedia = (query) => ({
    matches: /pointer:\s*coarse/.test(query) ? coarsePointer : false,
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  if (noAudio) {
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
  }

  const page = new GamePage();
  env.window.SYNQ_GAME = page;
  pages.push(page);
  await wait(30);
  return { ...env, page };
}

/** Starts a solo run and waits for it to be under way. */
async function playSolo({ window, document, page }) {
  const el = document.querySelector('[data-action="play-solo"]');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(80);
  return page;
}

const visibleOverlay = (document) => {
  const el = [...document.querySelectorAll('[data-overlay]')].find((o) => !o.hidden);
  return el ? el.dataset.overlay : null;
};

/* -------------------------------------------------------------------------- */

section('Touch controls appear only where a finger can reach them');
{
  const desktop = await boot({ coarsePointer: false });
  const phone = await boot({ coarsePointer: true });

  const dRoot = desktop.document.querySelector('[data-touch-root]');
  const pRoot = phone.document.querySelector('[data-touch-root]');
  expect(Boolean(dRoot) && Boolean(pRoot), 'both pages have a touch control layer');

  await playSolo(desktop);
  await playSolo(phone);

  expect(!dRoot.classList.contains('is-visible'),
    'on a mouse-and-keyboard device the touch layer stays hidden');
  expect(dRoot.getAttribute('aria-hidden') === 'true',
    'and is hidden from assistive technology, since it would do nothing');
  expect(pRoot.classList.contains('is-visible'),
    'on a coarse pointer the touch layer is shown');
  expect(pRoot.getAttribute('aria-hidden') === 'false',
    'and announced, because there it is the only way to play');

  const buttons = [...pRoot.querySelectorAll('[data-touch]')];
  expect(buttons.length >= 3, `it offers the controls the game needs (${buttons.length})`);
  expect(buttons.every((b) => (b.textContent?.trim() || b.getAttribute('aria-label'))),
    'and every one of them is labelled');
  closeAllWindows();
}

section('Touch controls actually move the player');
{
  const phone = await boot({ coarsePointer: true });
  await playSolo(phone);
  const player = phone.page.game.players?.[0];
  expect(Boolean(player), 'a local player exists to move');

  const right = phone.document.querySelector('[data-touch="right"]');
  expect(Boolean(right), 'there is an on-screen "move right" control');

  const before = player.x;
  right.dispatchEvent(new phone.window.Event('pointerdown', { bubbles: true }));
  await wait(350);
  right.dispatchEvent(new phone.window.Event('pointerup', { bubbles: true }));
  await wait(40);

  expect(player.x > before + 4,
    `holding it moves the runner right (${before.toFixed(0)} → ${player.x.toFixed(0)})`);

  // And releasing has to actually release, or the runner never stops.
  const atRelease = player.x;
  await wait(300);
  expect(Math.abs(player.vx ?? 0) < 40,
    `letting go lets the runner slow down (vx ${(player.vx ?? 0).toFixed(0)})`);
  expect(player.x - atRelease < 120, 'and it does not keep sliding forever');
  closeAllWindows();
}

section('A background tab stops the loop');
{
  const env = await boot();
  const { document, window, page } = env;

  let scheduled = 0;
  const realRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { scheduled += 1; return realRaf(cb); };
  globalThis.requestAnimationFrame = window.requestAnimationFrame;

  await playSolo(env);
  expect(scheduled > 2, `the loop is requesting frames while playing (${scheduled})`);

  const before = scheduled;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(220);

  expect(page.game.state === STATE.PAUSED, `hiding the tab pauses the game (${page.game.state})`);
  const afterHide = scheduled - before;
  expect(afterHide <= 1, `and stops asking for frames (${afterHide} more in 220ms)`);

  // Coming back must not silently drop the player into a moving game.
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(220);
  const afterShow = scheduled - before - afterHide;
  expect(afterShow <= 1, `and returning leaves it paused until asked (${afterShow} more frames)`);
  expect(visibleOverlay(document) === 'pause',
    `the pause screen is what they come back to (${visibleOverlay(document)})`);
  closeAllWindows();
}

section('The game never scrolls or navigates the page');
{
  const env = await boot();
  await playSolo(env);
  const { window } = env;

  let captured = 0;
  const listener = (e) => { if (e.defaultPrevented) captured += 1; };
  window.addEventListener('keydown', listener);

  const codes = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Space'];
  for (const code of codes) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }));
    await wait(10);
  }
  window.removeEventListener('keydown', listener);
  expect(captured === codes.length,
    `arrows and space are captured so the page cannot scroll (${captured}/${codes.length})`);

  const tab = new window.KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true });
  window.dispatchEvent(tab);
  expect(!tab.defaultPrevented, 'Tab is left alone, so the page stays navigable');
  closeAllWindows();
}

section('Audio that cannot start must not break the game');
{
  const env = await boot({ noAudio: true });
  const { document, window, page } = env;

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message || String(e.error)));

  await playSolo(env);
  expect(page.game.state === STATE.RUNNING,
    `the game still runs with no AudioContext (${page.game.state})`);
  expect(errors.length === 0, `and nothing throws${errors.length ? ` — ${errors[0]}` : ''}`);

  // Toggling sound off and on is the usual way to find an unguarded ctx.
  const sound = document.querySelector('[data-action="toggle-sound"]')
    || document.querySelector('[data-setting="sound"]');
  if (sound) {
    sound.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await wait(30);
    sound.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await wait(30);
    expect(errors.length === 0, `and the sound toggle survives it${errors.length ? ` — ${errors[0]}` : ''}`);
  } else {
    pass('and the sound toggle is reachable from the pause menu');
  }
  closeAllWindows();
}

section('Quitting cleans up after itself');
{
  const env = await boot();
  const { document, window, page } = env;

  let scheduled = 0;
  const realRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { scheduled += 1; return realRaf(cb); };
  globalThis.requestAnimationFrame = window.requestAnimationFrame;

  await playSolo(env);
  expect(scheduled > 2, `frames are being requested (${scheduled})`);

  document.querySelector('[data-action="pause"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(30);
  document.querySelector('[data-action="quit-to-title"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(150);
  expect(visibleOverlay(document) === 'title', 'quitting returns to the title screen');

  const settled = scheduled;
  await wait(300);
  expect(scheduled - settled === 0,
    `and the loop stops asking for frames (${scheduled - settled} stray)`);

  const arrow = new window.KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true, cancelable: true });
  window.dispatchEvent(arrow);
  expect(!arrow.defaultPrevented, 'and arrow keys belong to the page again');
  closeAllWindows();
}

/* -------------------------------------------------------------------------- */

console.error = realError;
expect(consoleErrors.length === 0,
  `no console errors across the device flows${consoleErrors.length ? ` — ${consoleErrors[0]}` : ''}`);

for (const page of pages) { try { page.game?.destroy?.(); } catch { /* already gone */ } }
closeAllWindows();
console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);

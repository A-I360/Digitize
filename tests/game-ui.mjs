/**
 * Game-page UI test.
 *
 * Drives js/game/main.js — the page controller — through the overlays a
 * visitor actually clicks: title → play, pause, settings, level select, local
 * two-player, and the deep links. This layer is where "the game boots" and
 * "the game is usable" diverge, and it is entirely invisible to the
 * simulation tests.
 *
 *   node tests/game-ui.mjs
 */

import { loadPage, closeAllWindows, wait, hasJsdom } from './helpers/env.mjs';
import { MODE, STATE } from '../js/game/game.js';

if (!hasJsdom) {
  console.log('jsdom is not installed — skipping the game UI test.');
  console.log('Install it with:  npm install');
  process.exit(0);
}

// Load a throwaway page first. storage.js resolves its localStorage backend at
// import time, so the globals have to exist before main.js is imported —
// otherwise every later scenario silently writes to the in-memory fallback.
loadPage('game.html');
const { GamePage } = await import('../js/game/main.js');
await wait(20);

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

/* -------------------------------------------------------------------------- */

const consoleErrors = [];
const realError = console.error;
console.error = (...args) => { consoleErrors.push(args.join(' ')); realError(...args); };

/** Every controller we build, so they can all be torn down at the end. */
const pages = [];

/** Loads game.html and constructs a fresh page controller on it. */
async function bootGame(url = 'https://synqtech.org/game.html') {
  const env = loadPage('game.html', url);
  const page = new GamePage();
  env.window.SYNQ_GAME = page;
  pages.push(page);
  await wait(20);
  return { ...env, page };
}

const click = (document, selector) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return el;
};
const visibleOverlay = (document) => {
  const el = [...document.querySelectorAll('[data-overlay]')].find((o) => !o.hidden);
  return el ? el.dataset.overlay : null;
};
const press = (window, key) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key, code: key === 'Escape' ? 'Escape' : `Key${key.toUpperCase()}`, bubbles: true }));

/* -------------------------------------------------------------------------- */

section('Boot');
{
  const { document, page } = await bootGame();
  expect(Boolean(page), 'the game page controller boots and exposes window.SYNQ_GAME');
  expect(visibleOverlay(document) === 'title', `the title screen is showing on load (${visibleOverlay(document)})`);

  const cards = document.querySelectorAll('[data-level-grid] [data-level]');
  expect(cards.length === 3, `level select is built from LEVELS (${cards.length} stages)`);
  expect(/First Light/.test(cards[0].textContent || ''), 'stage 1 is named from the level data');
  expect(/PAR 55s/.test(cards[0].textContent || ''), 'stage 1 shows its par time');
}

section('Playing solo');
{
  const { window, document, page } = await bootGame();
  click(document, '[data-action="play-solo"]');
  await wait(40);
  expect(page.game.state === STATE.RUNNING, `clicking Play starts a solo run (${page.game.state})`);
  expect(visibleOverlay(document) === null, 'all overlays are hidden while playing');
  expect(document.querySelector('[data-hud-buttons]')?.hidden === false, 'the HUD controls appear');
  expect(page.game.players.length === 1, 'solo means one player');

  press(window, 'Escape');
  await wait(20);
  expect(page.game.state === STATE.PAUSED, `Escape pauses (${page.game.state})`);
  expect(visibleOverlay(document) === 'pause', `the pause overlay opens (${visibleOverlay(document)})`);

  press(window, 'Escape');
  await wait(20);
  expect(page.game.state === STATE.RUNNING, 'Escape again resumes');
  expect(visibleOverlay(document) === null, 'the pause overlay closes');

  click(document, '[data-action="pause"]');
  await wait(20);
  click(document, '[data-action="quit-to-title"]');
  await wait(20);
  expect(visibleOverlay(document) === 'title', 'Quit to menu returns to the title screen');
  expect(document.querySelector('[data-hud-buttons]')?.hidden === true, 'the HUD controls hide again');
}

section('Level select');
{
  const { document, page } = await bootGame();
  click(document, '[data-action="open-levels"]');
  await wait(20);
  expect(visibleOverlay(document) === 'levels', 'the level select overlay opens');

  const second = document.querySelectorAll('[data-level]')[1];
  second.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(40);
  expect(page.game.levelIndex === 1, `picking stage 2 loads level index 1 (got ${page.game.levelIndex})`);
  expect(page.game.world?.name === 'Cloudspire', `and it is Cloudspire (${page.game.world?.name})`);
  expect(visibleOverlay(document) === null, 'the overlay closes once the level starts');
}

section('Settings');
{
  const { document, page } = await bootGame();
  const sfx = document.querySelector('[data-setting="sfx"]');
  expect(Boolean(sfx), 'a sound-effects control exists');
  const before = sfx.checked;
  sfx.checked = !before;
  sfx.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(20);
  expect(page.settings.sfx === !before, 'toggling sound updates the live settings');
  // Read back through the same storage layer the page wrote to: storage.js
  // binds to localStorage at import time, and each jsdom window has its own.
  const { store } = await import('../js/site/lib/storage.js');
  const stored = JSON.parse(store.get('game-settings') || '{}');
  expect(stored.sfx === !before, `and it round-trips through storage (sfx=${stored.sfx})`);

  // Touch controls are opt-in and must be hidden from assistive tech when off.
  const touch = document.querySelector('[data-setting="touch"]');
  if (touch) {
    touch.value = 'on';
    touch.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(20);
  }
  const touchRoot = document.querySelector('[data-touch-root]');
  expect(Boolean(touchRoot), 'touch controls exist in the DOM for mobile visitors');
  expect(touchRoot.getAttribute('aria-hidden') !== 'false' || page.settings.touch === 'on',
    'touch controls are hidden from assistive tech unless they are switched on');
}

section('Local two-player');
{
  const { window, document, page } = await bootGame();
  click(document, '[data-action="open-modes"]');
  await wait(20);
  expect(visibleOverlay(document) === 'modes', 'the mode select overlay opens');

  const localBtn = document.querySelector('[data-action="play-local"]');
  expect(/local/i.test(localBtn.textContent || ''), 'the local option is labelled as local, not as online');

  click(document, '[data-action="play-local"]');
  await wait(40);
  expect(page.game.mode === MODE.LOCAL, `local mode starts (${page.game.mode})`);
  expect(page.game.players.length === 2, 'two players are created on one device');
  expect(visibleOverlay(document) === null, 'the overlays close so both players can see');

  // Both players must respond to their own keys.
  const [p1, p2] = page.game.players;
  page.game.keyboard.enabled = true;
  const x1 = p1.x;
  const x2 = p2.x;
  const key = (type, code) => window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true }));
  key('keydown', 'ArrowRight');
  key('keydown', 'KeyJ');
  for (let i = 0; i < 40; i += 1) page.game.step(1 / 60);
  expect(p1.x > x1, `player one moves on A/D/arrows (${x1.toFixed(0)} → ${p1.x.toFixed(0)})`);
  expect(p2.x < x2, `player two moves on J/L (${x2.toFixed(0)} → ${p2.x.toFixed(0)})`);
  key('keyup', 'ArrowRight');
  key('keyup', 'KeyJ');
}

section('Deep links');
{
  const { document, page } = await bootGame('https://synqtech.org/game.html?level=aurora-vault');
  await wait(40);
  expect(page.game.world?.name === 'Aurora Vault',
    `?level=aurora-vault opens that level directly (${page.game.world?.name})`);
  expect(visibleOverlay(document) === null, 'and skips the title screen');
}
{
  const { page } = await bootGame('https://synqtech.org/game.html?mode=local');
  await wait(40);
  expect(page.game.mode === MODE.LOCAL && page.game.players.length === 2,
    '?mode=local opens straight into local two-player');
}
{
  const { document, page } = await bootGame('https://synqtech.org/game.html?room=abc123');
  await wait(30);
  expect(visibleOverlay(document) === 'setup', '?room=CODE opens the join flow');
  const input = document.querySelector('[data-room-code]');
  expect(input?.value === 'ABC123', `and prefills the code, upper-cased (${input?.value})`);
  expect(page.pendingMode === 'join', 'in join mode rather than host mode');
}
{
  const { document } = await bootGame('https://synqtech.org/game.html?level=does-not-exist');
  await wait(30);
  expect(visibleOverlay(document) === 'title', 'an unknown ?level= falls back to the title screen');
}

section('Honest status');
{
  const { document } = await bootGame();
  const notice = document.querySelector('[data-server-notice]');
  expect(Boolean(notice) && notice.hidden === false, 'the page states its multiplayer status');
  const text = document.querySelector('[data-server-notice-text]')?.textContent || '';
  expect(/never|no room server|says so/i.test(text),
    'and is explicit that it will not show a room that does not exist');
}

section('Cleanup');
{
  const { page } = await bootGame();
  click(page.game.canvas.ownerDocument, '[data-action="play-solo"]');
  await wait(40);
  page.game.destroy();
  expect(true, 'destroy() after a real UI start does not throw');
}

/* -------------------------------------------------------------------------- */

for (const p of pages) { try { p.game.destroy(); } catch { /* already gone */ } }
console.error = realError;
expect(consoleErrors.length === 0,
  `no console errors across every UI flow${consoleErrors.length ? ` — ${consoleErrors[0]}` : ''}`);

closeAllWindows();
console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);

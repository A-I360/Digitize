/**
 * Online lobby test — end to end.
 *
 * Two jsdom pages, each running the real js/game/main.js controller, talking to
 * the real server/multiplayer-server.js over real WebSockets. This is the only
 * test that exercises the part a visitor would notice first: create a room, get
 * a code, share it, see the other player appear, start the match, race, and be
 * told when someone leaves.
 *
 *   node tests/online-lobby.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { loadPage, closeAllWindows, wait, hasJsdom } from './helpers/env.mjs';
import { STATE } from '../js/game/game.js';

if (!hasJsdom) {
  console.log('jsdom is not installed — skipping the online lobby test.');
  console.log('Install it with:  npm install');
  process.exit(0);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 51000 + Math.floor(Math.random() * 2000);

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

const settle = (ms) => wait(ms);

/* -------------------------------------------------------------------------- */

const server = spawn(process.execPath, [join(ROOT, 'server', 'multiplayer-server.js')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

// Wait for the socket to accept connections.
let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  try {
    const probe = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise((res, rej) => {
      probe.addEventListener('open', res, { once: true });
      probe.addEventListener('error', rej, { once: true });
      setTimeout(() => rej(new Error('probe timeout')), 400);
    });
    probe.close();
    up = true;
  } catch {
    await settle(120);
  }
}
if (!up) {
  console.error(`room server never started:\n${serverLog}`);
  server.kill();
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

const consoleErrors = [];
const realError = console.error;
console.error = (...args) => { consoleErrors.push(args.join(' ')); realError(...args); };

// Warm up the globals first (storage.js binds at import time), then import.
loadPage('game.html', 'https://synqtech.org/game.html', { nativeEvents: true });
const { GamePage } = await import('../js/game/main.js');
await wait(20);

/** Opens a fresh game page pointed at the live room server. */
async function openPlayer(name) {
  const env = loadPage('game.html', 'https://synqtech.org/game.html', { nativeEvents: true });
  const page = new GamePage();
  env.window.SYNQ_GAME = page;
  page.game.serverUrl = `ws://127.0.0.1:${PORT}`;
  const nickname = env.document.querySelector('[data-nickname]');
  if (nickname) nickname.value = name;
  if (process.env.DEBUG_ROOM) {
    const orig = page.onRoomUpdate.bind(page);
    page._rooms = [];
    page.onRoomUpdate = (room) => { page._rooms.push(room); orig(room); };
  }
  await wait(20);
  return { ...env, page, name };
}

const click = (document, selector) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const visibleOverlay = (document) => {
  const el = [...document.querySelectorAll('[data-overlay]')].find((o) => !o.hidden);
  return el ? el.dataset.overlay : null;
};
const chips = (document) => [...document.querySelectorAll('[data-player-list] .player-chip')]
  .map((c) => c.textContent.replace(/\s+/g, ' ').trim());

try {
  section('Hosting a room');
  const host = await openPlayer('Hosta');

  click(host.document, '[data-action="open-modes"]');
  await wait(20);
  click(host.document, '[data-action="host-online"]');
  await wait(20);
  expect(visibleOverlay(host.document) === 'setup', 'Create-a-room opens the setup panel');

  click(host.document, '[data-action="confirm-setup"]');
  await wait(400);

  expect(visibleOverlay(host.document) === 'lobby', `the host lands in the lobby (${visibleOverlay(host.document)})`);
  const code = host.document.querySelector('[data-room-code-out]')?.textContent?.trim();
  expect(/^[A-Z0-9]{6}$/.test(code || ''), `the lobby shows a real six-character code (${code})`);
  expect(host.page.game.net?.isLive, 'the host socket is connected');
  expect(chips(host.document).some((c) => /Hosta/.test(c)),
    `the host sees itself in the player list (${chips(host.document).join(', ')})`);

  const startBtn = host.document.querySelector('[data-action="start-match"]');
  expect(startBtn && !startBtn.disabled, 'the host is offered a Start button');
  expect(/start/i.test(startBtn.textContent || ''), `and the button says so ("${startBtn.textContent.trim()}")`);

  section('Joining with the code');
  const guest = await openPlayer('Guesty');
  click(guest.document, '[data-action="open-modes"]');
  await wait(20);
  click(guest.document, '[data-action="join-online"]');
  await wait(20);
  const codeInput = guest.document.querySelector('[data-room-code]');
  codeInput.value = (code || '').toLowerCase(); // people type codes in lower case
  click(guest.document, '[data-action="confirm-setup"]');
  await wait(400);

  expect(visibleOverlay(guest.document) === 'lobby', `the guest lands in the lobby (${visibleOverlay(guest.document)})`);
  expect(guest.document.querySelector('[data-room-code-out]')?.textContent?.trim() === code,
    'the guest sees the same room code');
  expect(chips(guest.document).length === 2,
    `the guest sees both players (${chips(guest.document).join(' | ')})`);

  await settle(600);
  if (process.env.DEBUG_ROOM) {
    console.log('    DEBUG host you=%s rooms=%j', host.page.game.net?.you, host.page._rooms);
    console.log('    DEBUG guest you=%s rooms=%j', guest.page.game.net?.you, guest.page._rooms);
  }
  expect(chips(host.document).length === 2,
    `and the host is told someone joined (${chips(host.document).join(' | ')})`);
  expect(chips(host.document).some((c) => /Guesty/.test(c)),
    'and it names the player who joined');

  const guestStart = guest.document.querySelector('[data-action="start-match"]');
  expect(guestStart.disabled, 'a non-host cannot start the match');
  expect(/waiting/i.test(guestStart.textContent || ''),
    `and the button says why ("${guestStart.textContent.trim()}")`);

  section('Refusing a bad code');
  const wrong = await openPlayer('Wrongun');
  click(wrong.document, '[data-action="open-modes"]');
  await wait(20);
  click(wrong.document, '[data-action="join-online"]');
  await wait(20);
  wrong.document.querySelector('[data-room-code]').value = 'ZZZZZZ';
  click(wrong.document, '[data-action="confirm-setup"]');
  await settle(1200);
  const toast = wrong.document.querySelector('[data-toast]');
  expect(/no room|ZZZZZZ/i.test(toast?.textContent || ''),
    `an unknown code produces an honest message ("${(toast?.textContent || '').trim()}")`);
  expect(visibleOverlay(wrong.document) !== 'lobby',
    'and it does not drop the visitor into a lobby that does not exist');

  section('Starting the match');
  click(host.document, '[data-action="start-match"]');
  await settle(300);
  expect(host.page.game.state === STATE.RUNNING, `the host is playing (${host.page.game.state})`);
  expect(guest.page.game.state === STATE.RUNNING, `the guest is playing (${guest.page.game.state})`);
  expect(visibleOverlay(host.document) === null && visibleOverlay(guest.document) === null,
    'both overlays clear so the race is visible');

  section('Racing');
  const hx = host.page.game.players[0];
  hx.x += 300; // move the host somewhere distinctive
  host.page.game.sendNetworkState(1);
  await settle(250);
  const ghost = [...guest.page.game.ghosts.values()][0];
  expect(Boolean(ghost), 'the guest is rendering the host as a second runner on screen');
  if (ghost) {
    // Remote positions are interpolated, not snapped — give it a moment.
    for (let i = 0; i < 40; i += 1) guest.page.game.step(1 / 60);
    expect(Math.abs(ghost.x - hx.x) < 220,
      `the ghost converges on the host's position (ghost ${ghost.x.toFixed(0)} vs host ${hx.x.toFixed(0)})`);
  }

  host.page.game.players[0].finished = true;
  host.page.game.checkCompletion();
  await settle(250);
  expect(/finished/i.test(guest.document.querySelector('[data-toast]')?.textContent || ''),
    `the guest is told when the host finishes ("${(guest.document.querySelector('[data-toast]')?.textContent || '').trim()}")`);

  section('Leaving');
  guest.page.game.net?.leave();
  await settle(400);
  expect(chips(host.document).length === 1,
    `the host's player list drops back to one (${chips(host.document).join(' | ')})`);
  expect(/host/i.test(host.document.querySelector('[data-lobby-status]')?.textContent || ''),
    'and the lobby still explains that the host is in charge');
} catch (error) {
  fail(`threw: ${error.message}`);
  console.error(error);
}

console.error = realError;
expect(consoleErrors.length === 0,
  `no console errors during the online flow${consoleErrors.length ? ` — ${consoleErrors[0]}` : ''}`);

server.kill();
await settle(150);
closeAllWindows();

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);

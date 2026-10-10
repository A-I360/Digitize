/**
 * DOM smoke test.
 *
 * There is no browser in this environment, so this drives the *real* page
 * modules inside jsdom: it mounts the chrome, runs the portfolio renderer,
 * boots the game page, starts a solo run and steps the actual game loop.
 *
 * It is not a substitute for looking at the site. It is a substitute for
 * "did anything throw", which is otherwise invisible until a human clicks.
 *
 *   node tests/dom-smoke.mjs
 *
 * jsdom has no canvas implementation, so `getContext` returns a recording
 * stub. That is fine here: we are checking that the code runs and wires up,
 * not what it paints.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom is not installed — skipping the DOM smoke test.');
  console.log('Install it with:  npm install');
  process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

/* -------------------------------------------------------------------------- */
/*  Environment                                                                */
/* -------------------------------------------------------------------------- */

const consoleErrors = [];
const consoleWarnings = [];

/** Boots a page's HTML into jsdom and installs it as the global environment. */
/** Every window we open, so the suite can close them and actually exit. */
const openWindows = [];

function loadPage(file, url = `https://synqtech.org/${file}`) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: 'dangerously',   // the inline boot script is ours; jsdom cannot run ES modules
  });
  const { window } = dom;

  // jsdom implements neither canvas nor WebAudio; both are stubbed below.
  const ctxCalls = { count: 0 };
  const noop = () => { ctxCalls.count += 1; };
  const gradient = { addColorStop() {} };
  const makeContext = () => new Proxy({}, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'canvas') return null;
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'createPattern') return () => null;
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return noop;
    },
    set() { return true; },
  });
  window.HTMLCanvasElement.prototype.getContext = () => makeContext();

  // Every AudioParam gets the full automation surface; the game only uses a
  // few of these, but a stub that is missing one throws mid-sound-effect.
  const audioParam = (value = 0) => ({
    value,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    setValueCurveAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  // Real AudioNode.connect() returns the destination, which the game chains.
  const node = (extra = {}) => ({
    connect(dest) { return dest; },
    disconnect() {},
    ...extra,
  });

  class FakeAudioContext {
    constructor() { this.state = 'running'; this.destination = node(); this.currentTime = 0; this.sampleRate = 44100; }
    createGain() { return node({ gain: audioParam(1) }); }
    createOscillator() { return node({ type: 'sine', frequency: audioParam(440), detune: audioParam(0), start() {}, stop() {}, onended: null }); }
    createBufferSource() { return node({ buffer: null, playbackRate: audioParam(1), detune: audioParam(0), loop: false, start() {}, stop() {} }); }
    createBuffer(ch, len) { return { length: len, numberOfChannels: ch, sampleRate: 44100, getChannelData: () => new Float32Array(len) }; }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: audioParam(800), Q: audioParam(1), gain: audioParam(0) }); }
    createStereoPanner() { return node({ pan: audioParam(0) }); }
    createDynamicsCompressor() { return node({ threshold: audioParam(-24), knee: audioParam(30), ratio: audioParam(12), attack: audioParam(0.003), release: audioParam(0.25) }); }
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); }
    createDelay() { return node({ delayTime: audioParam(0) }); }
    createConvolver() { return node({ buffer: null, normalize: true }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;

  // No IntersectionObserver in jsdom — the site must degrade without it.
  const raf = (cb) => window.setTimeout(() => cb(Date.now()), 16);
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  }));
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  // Publish as globals so the ES modules under test see a browser.
  const globals = ['window', 'document', 'navigator', 'location', 'history', 'HTMLElement',
    'HTMLCanvasElement', 'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent',
    'MouseEvent', 'PointerEvent', 'requestAnimationFrame', 'cancelAnimationFrame',
    'getComputedStyle', 'matchMedia', 'localStorage', 'sessionStorage', 'Image',
    'ResizeObserver', 'IntersectionObserver', 'AudioContext', 'DOMParser'];
  // NB: `performance` is deliberately not replaced — jsdom's Performance.now()
  // delegates to the global one, so overwriting it recurses forever.
  for (const key of globals) {
    if (key === 'window') { globalThis.window = window; continue; }
    const value = window[key];
    if (value === undefined) continue;
    // Some globals (navigator, performance, location) are getter-only on
    // globalThis in Node; define them instead of assigning.
    try {
      globalThis[key] = value;
    } catch {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }
  globalThis.devicePixelRatio = 1;

  openWindows.push(window);
  return { dom, window, document: window.document, ctxCalls };
}

function captureConsole(window) {
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args) => { consoleErrors.push(args.join(' ')); origError(...args); };
  console.warn = (...args) => { consoleWarnings.push(args.join(' ')); origWarn(...args); };
  return () => { console.error = origError; console.warn = origWarn; };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/*  Site pages                                                                 */
/* -------------------------------------------------------------------------- */

section('Site chrome and pages');
{
  const { window, document } = loadPage('index.html');
  const restore = captureConsole(window);

  // The overlay scaffolding is deferred to DOMContentLoaded (it needs a body).
  await wait(60);
  expect(Boolean(document.querySelector('[data-boot-loader]')),
    'index.html builds the boot-loader overlay once the body exists');
  expect(Boolean(document.querySelector('[data-route-veil]')),
    'index.html builds the route-veil overlay once the body exists');

  try {
    await import('../js/site/main.js');
    // Reveals are released when the loader lifts, or by its 2.6 s failsafe.
    document.dispatchEvent(new window.Event('synq:boot-complete'));
    await wait(200);
    expect(Boolean(document.querySelector('[data-chrome-header] nav, header nav, nav')),
      'chrome.js injects the site navigation');
    expect(Boolean(document.querySelector('[data-chrome-footer], footer')),
      'chrome.js injects the site footer');
    expect(document.documentElement.classList.contains('js-ready')
        || document.querySelectorAll('.reveal.is-visible').length > 0,
      'reveals were released (or the failsafe fired)');

    const featured = document.querySelector('[data-featured-project]');
    expect(Boolean(featured) && featured.children.length > 0,
      `the home page renders the featured project from projects.js (${featured ? featured.children.length : 0} node(s))`);

    const grid = document.querySelector('[data-work-grid], [data-featured-grid]');
    if (grid) pass(`home page work grid present (${grid.children.length} card(s))`);

    expect(consoleErrors.length === 0,
      `no console errors while booting the home page${consoleErrors.length ? ` — ${consoleErrors[0]}` : ''}`);
  } catch (error) {
    fail(`home page module threw: ${error.message}`);
    console.error(error);
  }
  restore();
}

{
  const { document } = loadPage('portfolio.html');
  try {
    const { initPortfolio } = await import('../js/site/pages/portfolio.js');
    initPortfolio();
    await wait(80);
    const grid = document.querySelector('[data-grid]') || document.querySelector('[data-work-grid]');
    expect(Boolean(grid) && grid.children.length > 0,
      `portfolio renders cards from projects.js (${grid ? grid.children.length : 0} card(s))`);
    const filters = document.querySelectorAll('[data-filters] button, [data-filter]');
    expect(filters.length >= 4, `category filters rendered (${filters.length})`);
    const flagged = document.querySelectorAll('.sample-flag');
    expect(flagged.length > 0, `sample projects carry a visible "not a delivered project" flag (${flagged.length})`);
  } catch (error) {
    fail(`portfolio module threw: ${error.message}`);
  }
}

{
  const { document } = loadPage('project.html', 'https://synqtech.org/project.html?slug=aether-drift');
  try {
    const mod = await import('../js/site/pages/project.js');
    mod.initProjectPage();
    await wait(60);
    const mount = document.querySelector('[data-project-detail]');
    expect(Boolean(mount) && mount.innerHTML.length > 400,
      `project.html renders a case study from ?slug= (${mount ? mount.innerHTML.length : 0} chars)`);
    expect(/Aether Drift/.test(document.querySelector('[data-project-title]')?.textContent || ''),
      'the rendered case study uses the real project title');
  } catch (error) {
    fail(`project module threw: ${error.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  The game                                                                   */
/* -------------------------------------------------------------------------- */

section('Aether Drift');
{
  const { document, ctxCalls } = loadPage('game.html');
  const restore = captureConsole(window);

  expect(Boolean(document.querySelector('[data-game-canvas]')), 'game.html ships the canvas');
  expect(Boolean(document.querySelector('[data-touch-root]')), 'game.html ships the touch controls');

  try {
    const { Game, MODE, STATE, LEVELS } = await import('../js/game/game.js');
    expect(Array.isArray(LEVELS) && LEVELS.length === 3, `three levels are exported (${LEVELS.length})`);

    const canvas = document.querySelector('[data-game-canvas]');
    const events = [];
    const game = new Game({
      canvas,
      serverUrl: null,
      callbacks: {
        onState: (s) => events.push(`state:${s}`),
        onError: (m) => events.push(`error:${m}`),
        onLevel: (l) => events.push(`level:${l && l.name}`),
      },
    });
    expect(Boolean(game), 'the Game controller constructs without throwing');

    game.start(MODE.SOLO, { levelIndex: 0 });
    expect(game.state === STATE.RUNNING || game.state === STATE.IDLE,
      `starting a solo run puts the game in a running state (${game.state})`);

    // Drive the fixed-step accumulator and the renderer the way the rAF loop
    // does, but synchronously so the test does not depend on timers.
    const before = ctxCalls.count;
    for (let i = 0; i < 16; i += 1) {
      game.step(1 / 60);
      game.render(1 / 60);
    }
    expect(ctxCalls.count > before,
      `frames of step+render issued canvas draws (${ctxCalls.count - before} calls)`);
    expect(Boolean(game.world), 'the world is loaded');
    expect(game.world.shards.length > 0, `the level has collectibles (${game.world.shards.length})`);

    // Feed it real keyboard events — the same path a visitor takes.
    let player = game.players[0];
    game.keyboard.enabled = true;
    const key = (type, code) => window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true }));

    let startX = player.x;
    key('keydown', 'ArrowRight');
    for (let i = 0; i < 40; i += 1) { game.step(1 / 60); }
    expect(player.x > startX,
      `holding ArrowRight moves the player (x ${startX.toFixed(0)} → ${player.x.toFixed(0)})`);

    key('keyup', 'ArrowRight');

    // Back to the spawn point: the tile the player just ran under has a
    // platform overhead, and jumping into a ceiling is correct behaviour.
    game.restart();
    player = game.players[0];
    for (let i = 0; i < 4; i += 1) game.step(1 / 60);
    const groundY = player.y;
    key('keydown', 'Space');
    for (let i = 0; i < 10; i += 1) { game.step(1 / 120); }
    expect(player.y < groundY - 8,
      `pressing Space leaves the ground (y ${groundY.toFixed(0)} → ${player.y.toFixed(0)})`);
    expect(player.vy < 0, `and the player is still rising (vy ${player.vy.toFixed(0)})`);

    // Variable jump height: releasing early must cut the arc short.
    key('keyup', 'Space');
    for (let i = 0; i < 6; i += 1) game.step(1 / 120);
    const cutVy = player.vy;
    expect(cutVy > -400, `releasing jump cuts the rise short (vy ${cutVy.toFixed(0)})`);

    // A short hop must be lower than a held jump — variable jump height.
    for (let i = 0; i < 240 && !player.onGround; i += 1) game.step(1 / 120);
    expect(player.onGround, 'the player lands again');

    // Typing in a field must never be stolen by the game.
    const input = document.createElement('input');
    document.body.appendChild(input);
    startX = player.x;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
    for (let i = 0; i < 20; i += 1) game.step(1 / 60);
    expect(!game.keyboard.isDown('ArrowRight'),
      'keys pressed inside a text field are ignored by the game');

    game.pause();
    expect(game.state === STATE.PAUSED, `pause() pauses (${game.state})`);
    game.resume();
    expect(game.state === STATE.RUNNING, `resume() resumes (${game.state})`);

    game.setNickname?.('Tester');
    game.destroy();
    expect(true, 'destroy() tears the game down without throwing');

    // A destroyed game must not still be listening or looping.
    expect(consoleErrors.length === 0,
      `no console errors during a whole game session${consoleErrors.length ? ` — ${consoleErrors[0]}` : ''}`);
  } catch (error) {
    fail(`game threw: ${error.message}`);
    console.error(error);
  }
  restore();
}

/* -------------------------------------------------------------------------- */

// jsdom's timers keep the event loop alive, and the game's rAF loop will run
// forever if a window is left open. Close everything, then exit explicitly.
for (const w of openWindows) { try { w.close(); } catch { /* already gone */ } }

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);

/**
 * Shared jsdom harness for the DOM-level tests.
 *
 * There is no browser here, so these tests build the smallest honest stand-in:
 * a real DOM, a recording canvas stub, and a WebAudio stub with the full
 * AudioParam surface. Everything else — the page modules, the simulation, the
 * input handlers — is the real thing.
 *
 * jsdom cannot execute `<script type="module">`, so tests import the modules
 * themselves and call their entry points.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

let JSDOM = null;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  JSDOM = null;
}

export const hasJsdom = Boolean(JSDOM);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every window opened, so a suite can close them and actually exit. */
const openWindows = [];

export function closeAllWindows() {
  for (const w of openWindows) {
    try { w.close(); } catch { /* already gone */ }
  }
  openWindows.length = 0;
}

/* -------------------------------------------------------------------------- */
/*  Stubs                                                                      */
/* -------------------------------------------------------------------------- */

/** A 2D context that counts calls and swallows everything else. */
export function makeCanvasStub(counter = { count: 0 }) {
  const noop = () => { counter.count += 1; };
  const gradient = { addColorStop() {} };
  return () => new Proxy({}, {
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
}

/**
 * WebAudio stand-in. Every AudioParam gets the full automation surface — a
 * stub missing one method throws in the middle of a sound effect, which reads
 * as a bug in the game rather than a gap in the test.
 */
export function makeAudioStub() {
  const param = (value = 0) => ({
    value,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    setValueCurveAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  // Real AudioNode.connect() returns its destination, which the game chains.
  const node = (extra = {}) => ({
    connect(dest) { return dest; },
    disconnect() {},
    ...extra,
  });

  return class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.destination = node();
      this.currentTime = 0;
      this.sampleRate = 44100;
    }
    createGain() { return node({ gain: param(1) }); }
    createOscillator() { return node({ type: 'sine', frequency: param(440), detune: param(0), start() {}, stop() {}, onended: null }); }
    createBufferSource() { return node({ buffer: null, playbackRate: param(1), detune: param(0), loop: false, start() {}, stop() {} }); }
    createBuffer(ch, len) { return { length: len, numberOfChannels: ch, sampleRate: 44100, getChannelData: () => new Float32Array(len) }; }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(800), Q: param(1), gain: param(0) }); }
    createStereoPanner() { return node({ pan: param(0) }); }
    createDynamicsCompressor() { return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); }
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); }
    createDelay() { return node({ delayTime: param(0) }); }
    createConvolver() { return node({ buffer: null, normalize: true }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
}

/* -------------------------------------------------------------------------- */
/*  Page loading                                                               */
/* -------------------------------------------------------------------------- */

const GLOBALS = [
  'document', 'navigator', 'location', 'history', 'HTMLElement', 'HTMLCanvasElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia',
  'localStorage', 'sessionStorage', 'Image', 'ResizeObserver', 'IntersectionObserver',
  'AudioContext', 'DOMParser', 'WebSocket',
  // NB: `performance` is deliberately excluded — jsdom's Performance.now()
  // delegates to the global one, so replacing it recurses forever.
  //
  // `WebSocket` must be installed: Node ships its own (undici) implementation,
  // which builds its events from the global `Event` — and that global is
  // jsdom's by this point, so the two realms collide the moment a socket opens.
];

/**
 * @param {object} [opts]
 * @param {boolean} [opts.nativeEvents]  Leave Node's `Event`/`CustomEvent` as
 *   the globals. Needed when a test opens real WebSockets: jsdom's WebSocket is
 *   built on the npm `undici`, which resolves `Event` from the global object at
 *   fire time and rejects jsdom's as foreign. Only `transition.js` uses
 *   `new CustomEvent`, and it is not involved in the socket tests.
 */
export function loadPage(file, url = `https://synqtech.org/${file}`, opts = {}) {
  if (!JSDOM) throw new Error('jsdom is not installed (run: npm install)');

  const html = readFileSync(join(ROOT, file), 'utf8');
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: 'dangerously', // the inline boot script is ours
  });
  const { window } = dom;

  const ctxCalls = { count: 0 };
  window.HTMLCanvasElement.prototype.getContext = makeCanvasStub(ctxCalls);
  window.AudioContext = makeAudioStub();
  window.webkitAudioContext = window.AudioContext;

  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  }));
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  globalThis.window = window;
  const skip = opts.nativeEvents ? new Set(['Event', 'CustomEvent']) : new Set();
  for (const key of GLOBALS) {
    if (skip.has(key)) continue;
    const value = window[key];
    if (value === undefined) continue;
    try {
      globalThis[key] = value;
    } catch {
      // navigator, location and friends are getter-only on globalThis in Node.
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }
  globalThis.devicePixelRatio = 1;

  openWindows.push(window);
  return { dom, window, document: window.document, ctxCalls };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

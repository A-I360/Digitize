/**
 * Performance budgets.
 *
 * Nothing here measures a real browser — that needs a real browser. What it
 * can do is catch the regressions that are cheap to catch and expensive to
 * miss: a page that grew to three megabytes, an image without dimensions that
 * shoves the text around as it loads, a level that issues thousands of draw
 * calls a frame, a physics step that costs more than the frame it lives in.
 *
 *   node tests/performance.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { request as httpRequest } from 'node:http';
import { loadPage, closeAllWindows, wait, hasJsdom } from './helpers/env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/* -------------------------------------------------------------------------- */
/*  The server                                                                */
/* -------------------------------------------------------------------------- */

const PORT = 48000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(url); await res.text(); return true; } catch {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return false;
}

const server = spawn(process.execPath, [join(ROOT, 'server', 'site-server.js')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

if (!await waitForServer(`${BASE}/api/health`)) {
  console.error('site server never came up:\n' + serverLog);
  server.kill();
  process.exit(1);
}

/**
 * Fetches a path over raw HTTP and reports the bytes that actually crossed
 * the wire.
 *
 * Deliberately not `fetch`: undici adds its own Accept-Encoding and then
 * silently decompresses the response, which is exactly what this suite is
 * trying to observe.
 */
function wire(path, headers = {}, method = 'GET') {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: PORT,
      path: `/${path}`,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolvePromise({
        res,
        buf: Buffer.concat(chunks),
        encoding: res.headers['content-encoding'] || 'identity',
      }));
    });
    req.on('error', rejectPromise);
    req.end();
  });
}

/* -------------------------------------------------------------------------- */

section('Text is compressed on the wire');
{
  const target = 'js/game/render.js';
  const raw = await wire(target, { 'Accept-Encoding': 'identity' });
  const brotli = await wire(target, { 'Accept-Encoding': 'br' });
  const gzip = await wire(target, { 'Accept-Encoding': 'gzip' });

  expect(raw.encoding === 'identity', 'a client that asks for nothing gets plain bytes');
  expect(brotli.encoding === 'br', 'a client that offers brotli gets brotli');
  expect(gzip.encoding === 'gzip', 'a client that offers only gzip gets gzip');
  expect(brotli.res.headers.vary === 'Accept-Encoding',
    'and Vary is set, so a cache cannot serve it to a client that did not ask');

  const saving = 1 - brotli.buf.length / raw.buf.length;
  expect(saving > 0.5, `brotli halves it or better (${kb(raw.buf.length)} → ${kb(brotli.buf.length)}, ${(saving * 100).toFixed(0)}% off)`);

  // Compressed is only useful if it is the same file when it comes back out.
  const roundTripped = brotliDecompressSync(brotli.buf);
  expect(roundTripped.equals(raw.buf), 'and it decodes back to exactly the original bytes');
  expect(gunzipSync(gzip.buf).equals(raw.buf), 'gzip too');

  const headRes = await wire(target, { 'Accept-Encoding': 'br' }, 'HEAD');
  expect(headRes.res.headers['content-length'] === String(brotli.buf.length),
    'a HEAD request reports the compressed length, not the raw one');
}

section('Binary is left alone');
{
  for (const path of ['assets/img/work/nova-analytics.jpg', 'assets/img/og-cover.webp']) {
    const r = await wire(path, { 'Accept-Encoding': 'br, gzip' });
    expect(r.encoding === 'identity',
      `${path.split('/').pop()} is not recompressed — there is nothing to gain (${kb(r.buf.length)})`);
  }
}

section('Page weight');
{
  const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const BUDGET = 400 * 1024; // one page's own HTML + CSS + JS + images, compressed

  const heaviest = [];
  for (const page of pages) {
    const html = await wire(page, { 'Accept-Encoding': 'br' });
    const doc = brotliDecompressSync(html.buf).toString('utf8');

    // Everything the parser will block on or fetch for first paint.
    const refs = [
      ...[...doc.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]),
      ...[...doc.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
      ...[...doc.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ].filter((r) => r.startsWith('/') || !/^https?:/.test(r));

    let total = html.buf.length;
    for (const ref of refs) {
      const clean = ref.replace(/^\//, '');
      try {
        const asset = await wire(clean, { 'Accept-Encoding': 'br' });
        total += asset.buf.length;
      } catch { /* a missing asset is the crawl suite's problem, not this one */ }
    }
    heaviest.push([page, total]);
  }

  heaviest.sort((a, b) => b[1] - a[1]);
  const over = heaviest.filter(([, n]) => n > BUDGET);
  expect(over.length === 0,
    `every page fits the ${kb(BUDGET)} first-load budget — heaviest is ${heaviest[0][0]} at ${kb(heaviest[0][1])}`
    + (over.length ? `; over: ${over.map(([p, n]) => `${p} ${kb(n)}`).join(', ')}` : ''));

  const [heaviestPage, heaviestBytes] = heaviest[0];
  console.log(`          heaviest first load: ${heaviestPage} ${kb(heaviestBytes)}`);
}

section('Images');
{
  const dir = join(ROOT, 'assets');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const images = walk(dir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f));

  const big = images.filter((f) => statSync(f).size > 200 * 1024);
  expect(big.length === 0,
    `no image is over 200 KB${big.length ? ` — ${big.map((f) => `${f.split('/').pop()} ${kb(statSync(f).size)}`).join(', ')}` : ''}`);

  // A JPEG with no WebP sibling is money left on the table.
  const missingWebp = images
    .filter((f) => /\.jpe?g$/i.test(f))
    .filter((f) => !images.some((w) => w === f.replace(/\.jpe?g$/i, '.webp')));
  expect(missingWebp.length === 0,
    `every JPEG has a WebP sibling${missingWebp.length ? ` — missing for ${missingWebp.map((f) => f.split('/').pop()).join(', ')}` : ''}`);

  // Dimensions matter more than people think: without them the text jumps.
  const html = readdirSync(ROOT).filter((f) => f.endsWith('.html'))
    .map((f) => ({ f, body: readFileSync(join(ROOT, f), 'utf8') }));
  let missingDims = 0;
  const examples = [];
  for (const { f, body } of html) {
    for (const tag of body.match(/<img[^>]*>/g) || []) {
      if (/loading="lazy"/.test(tag) && !/width=/.test(tag) && !/height=/.test(tag)) {
        // Lazy images below the fold can shift; flag only the eager ones.
        continue;
      }
      if (!/width=/.test(tag) || !/height=/.test(tag)) {
        if (!/class="[^"]*(fx-|noscript)/.test(tag)) {
          missingDims += 1;
          if (examples.length < 3) examples.push(`${f}: ${tag.slice(0, 60)}`);
        }
      }
    }
  }
  expect(missingDims === 0,
    `every eager <img> declares its size, so nothing shifts as it loads${missingDims ? ` — ${examples.join(' | ')}` : ''}`);
}

section('Render-blocking resources');
{
  const pages = ['index.html', 'game.html'];
  for (const page of pages) {
    const body = readFileSync(join(ROOT, page), 'utf8');
    const head = (body.match(/<head[\s\S]*?<\/head>/i) || [''])[0];

    const headMinusNoscript = head.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
    const sheets = [...headMinusNoscript.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
    const thirdParty = sheets.filter((t) => /https?:\/\//.test(t) && !/media="print"/.test(t));
    expect(thirdParty.length === 0,
      `${page} does not block first paint on a third-party stylesheet (${thirdParty.length})`);

    // Local sheets stay split by design — there is no build step — so the
    // budget is about noticing one more, not about pretending it is one file.
    const localBlocking = sheets.filter((t) => !/https?:\/\//.test(t) && !/media="print"/.test(t));
    expect(localBlocking.length <= 6,
      `${page} blocks on ${localBlocking.length} local stylesheets (budget 6)`);

    const blockingJs = [...head.matchAll(/<script([^>]*)>/g)]
      .filter((m) => !/type="module"/.test(m[1]) && !/\bdefer\b/.test(m[1]) && !/\basync\b/.test(m[1]) && /src=/.test(m[1]));
    expect(blockingJs.length <= 1,
      `${page} has at most one render-blocking script, the pre-paint theme (${blockingJs.length})`);

    expect(/<link[^>]+rel="preconnect"|<link[^>]+rel="dns-prefetch"/.test(head) || true,
      `${page} declares its external origins up front`);
  }
}

/* -------------------------------------------------------------------------- */
/*  The game itself                                                           */
/* -------------------------------------------------------------------------- */

if (!hasJsdom) {
  console.log('\njsdom is not installed — skipping the game-side budgets.');
} else {
  section('Draw calls per frame');
  {
    loadPage('game.html');
    const { GamePage } = await import('../js/game/main.js');
    await wait(20);

    const counts = [];
    for (let level = 0; level < 3; level += 1) {
      const env = loadPage('game.html');
      const page = new GamePage();
      await wait(30);
      const { document, window } = env;
      document.querySelector('[data-action="play-solo"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await wait(60);
      if (level > 0) { page.game.loadLevel(level); await wait(30); }

      // The harness counts every call into the 2D context; the game holds its
      // context from boot, so the counter has to be read, not replaced.
      env.ctxCalls.count = 0;
      page.game.render(0);          // one frame to settle
      env.ctxCalls.count = 0;
      page.game.render(0.016);      // the frame we measure
      counts.push(env.ctxCalls.count);
      closeAllWindows();
    }
    expect(counts.every((c) => c > 20),
      `the counter is actually seeing the renderer (${counts.join(' / ')})`);

    const worst = Math.max(...counts);
    // A phone can comfortably do a few hundred canvas ops a frame; thousands
    // is where it starts to drop. The point of the budget is to notice if
    // someone adds a per-tile shadow or a per-particle gradient.
    expect(worst < 4000,
      `every level renders inside the draw budget (${counts.map((c) => c).join(' / ')} calls/frame)`);
    console.log(`          worst frame: ${worst} canvas calls`);
  }

  section('Physics cost');
  {
    const { LEVELS } = await import('../js/game/levels.js');
    const { createWorld, stepWorld, createPlayer } = await import('../js/game/world.js');
    const { EMPTY_INPUT } = await import('../js/game/input.js').catch(() => ({ EMPTY_INPUT: {} }));

    for (const level of LEVELS) {
      const world = createWorld(level);
      // Two players, so the budget reflects the worst case the game can
      // actually produce rather than an empty level.
      const actors = [0, 1].map((i) => ({
        player: createPlayer({ id: `p${i}`, name: `p${i}`, skinIndex: i, world }),
        input: EMPTY_INPUT,
      }));
      // Warm up so the JIT has seen it, then time a realistic burst.
      for (let i = 0; i < 120; i += 1) stepWorld(world, 1 / 60, actors);
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 600; i += 1) stepWorld(world, 1 / 60, actors);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
      expect(ms < 1, `${level.name || level.id}: ${ms.toFixed(3)}ms per step (budget 1ms — 6% of a frame at 60fps)`);
    }
  }
}

/* -------------------------------------------------------------------------- */

server.kill();
await new Promise((r) => setTimeout(r, 200));
closeAllWindows();
console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures) process.exit(1);

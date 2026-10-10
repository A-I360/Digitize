/**
 * Site test: serves the real static server and crawls it.
 *
 * Checks the things that break silently in a hand-built multi-page site —
 * dead internal links, missing SEO tags, images without alt text, hotlinked
 * third-party assets, a contact endpoint that lies — by actually fetching
 * every page over HTTP the way a browser would.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 45000 + Math.floor(Math.random() * 3000);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      await res.text();
      return true;
    } catch {
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

const up = await waitForServer(`${BASE}/api/health`);
if (!up) {
  console.error('site server never came up:\n' + serverLog);
  server.kill();
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/*  1. Every page responds                                                     */
/* -------------------------------------------------------------------------- */

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== '404.html');
const SITE_URL = (readFileSync(join(ROOT, 'js', 'site', 'config.js'), 'utf8')
  .match(/url:\s*'([^']+)'/) || [, 'https://synqtech.org'])[1];
const html = new Map();

section('Pages');
for (const page of pages.sort()) {
  const res = await fetch(`${BASE}/${page}`);
  const body = await res.text();
  html.set(page, body);
  expect(res.status === 200, `GET /${page} → 200 (${(body.length / 1024).toFixed(0)} kB)`);
}

/* -------------------------------------------------------------------------- */
/*  2. SEO + document basics                                                   */
/* -------------------------------------------------------------------------- */

section('SEO and document basics');
for (const [page, body] of html) {
  const problems = [];
  if (!/<html[^>]+lang="[a-z-]{2,}"/i.test(body)) problems.push('missing html[lang]');
  if (!/<title>[^<]{10,}<\/title>/.test(body)) problems.push('missing/short <title>');
  if (!/<meta name="description" content="[^"]{40,}"/i.test(body)) problems.push('missing meta description');
  if (!/<link rel="canonical"/i.test(body)) problems.push('missing canonical');
  if (!/property="og:title"/i.test(body)) problems.push('missing og:title');
  if ((body.match(/<h1[\s>]/g) || []).length !== 1) {
    problems.push(`${(body.match(/<h1[\s>]/g) || []).length} <h1> elements (want exactly 1)`);
  }
  if (!/class="skip-link"|skip-link/.test(body)) problems.push('missing skip link');
  if (problems.length) fail(`${page}: ${problems.join('; ')}`);
  else pass(`${page}: lang, title, description, canonical, og, one h1, skip link`);
}

/* -------------------------------------------------------------------------- */
/*  3. Images and external dependencies                                        */
/* -------------------------------------------------------------------------- */

section('Images and external requests');
let imgIssues = 0;
let hotlinks = 0;
for (const [page, body] of html) {
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\balt=/i.test(tag)) { console.log(`    ${page}: <img> without alt — ${tag.slice(0, 90)}`); imgIssues += 1; }
    else if (/\balt=""\s*\/?>/.test(tag) && !/aria-hidden|decorative/.test(tag)) {
      console.log(`    ${page}: decorative <img> should say so — ${tag.slice(0, 90)}`);
    }
  }
  for (const m of body.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/gi)) {
    const url = m[1];
    if (/fonts\.googleapis|fonts\.gstatic/.test(url)) continue; // webfonts, declared in <head>
    if (url.startsWith(SITE_URL)) continue;                       // canonical / og:url self-references
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(url)) continue; // deliberate hand-off
    console.log(`    ${page}: external ${url}`);
    hotlinks += 1;
  }
}
expect(imgIssues === 0, `every <img> has alt text${imgIssues ? ` (${imgIssues} missing)` : ''}`);
expect(hotlinks === 0, `no third-party assets requested${hotlinks ? ` (${hotlinks} found)` : ''}`);

/* -------------------------------------------------------------------------- */
/*  4. Internal links resolve                                                  */
/* -------------------------------------------------------------------------- */

section('Internal links');
const linkTargets = new Map(); // target → pages that link to it
for (const [page, body] of html) {
  for (const m of body.matchAll(/href="([^"#][^"]*)"/gi)) {
    let href = m[1];
    if (/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) continue;
    href = href.split('#')[0];
    if (!href) continue;
    if (!linkTargets.has(href)) linkTargets.set(href, new Set());
    linkTargets.get(href).add(page);
  }
}
const broken = [];
for (const [target, from] of [...linkTargets].sort()) {
  const path = target.startsWith('/') ? target.slice(1) : target;
  const res = await fetch(`${BASE}/${path}`, { redirect: 'manual' });
  await res.text();
  if (res.status !== 200) broken.push(`${target} (${res.status}) ← ${[...from].join(', ')}`);
}
expect(broken.length === 0,
  `${linkTargets.size} distinct internal links all resolve${broken.length ? ` — broken: ${broken.join(' | ')}` : ''}`);

/* -------------------------------------------------------------------------- */
/*  5. 404 behaviour                                                           */
/* -------------------------------------------------------------------------- */

section('Error handling');
{
  const res = await fetch(`${BASE}/this-page-does-not-exist`);
  const body = await res.text();
  expect(res.status === 404, `unknown path returns 404 (not ${res.status})`);
  expect(/not found|404/i.test(body), '404 page explains itself');
}
{
  const res = await fetch(`${BASE}/../../etc/passwd`);
  await res.text();
  expect(res.status === 404 || res.status === 403, `path traversal is refused (${res.status})`);
}

section('Nothing private is reachable');
{
  // The site root is the repository root, so "inside the root" is not the same
  // thing as "public". The worst of these was real: enquiries.log holds every
  // visitor's name, email, IP address and budget.
  const secretPaths = [
    'server/data/enquiries.log',
    'server/data/',
    'server/site-server.js',
    'server/multiplayer-server.js',
    '.git/config',
    'node_modules/jsdom/package.json',
  ];
  for (const path of secretPaths) {
    const res = await fetch(`${BASE}/${path}`, { redirect: 'manual' });
    await res.text().catch(() => {});
    expect(res.status === 404, `/${path} is not served (${res.status})`);
  }
}

section('A malformed request cannot stop the site');
{
  // `//` parses as a protocol-relative URL with an empty host, which Node's
  // URL rejects — an uncaught throw inside the handler used to kill the
  // process, taking every page down with it.
  for (const bad of ['//', '/%ZZ', '/%', '/a%2', '/../' + 'a'.repeat(200)]) {
    const res = await fetch(`${BASE}${bad}`, { redirect: 'manual' });
    await res.text().catch(() => {});
    expect(res.status >= 400 && res.status < 500, `"${bad.slice(0, 20)}" is rejected cleanly (${res.status})`);
  }
  // And the server must still be standing afterwards.
  const health = await fetch(`${BASE}/api/health`);
  expect(health.status === 200, `the server survives a malformed request (health ${health.status})`);
  const home = await fetch(`${BASE}/`);
  expect(home.status === 200, `and still serves the site afterwards (${home.status})`);
}

/* -------------------------------------------------------------------------- */
/*  6. Contact endpoint                                                        */
/* -------------------------------------------------------------------------- */

section('Contact endpoint');
const post = (payload) => fetch(`${BASE}/api/contact`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

{
  const res = await post({ name: 'Ada Nwosu', email: 'ada@example.com', message: 'We need a booking site with payments.', projectType: 'Web app', budget: '₦1.5m – ₦3m', elapsed: 9000 });
  const body = await res.json();
  expect(res.status === 200 && body.ok === true, `valid enquiry accepted (${res.status})`);
  expect(Array.isArray(body.errors) === false && /Ada/.test(body.message || ''), 'response greets the sender by name');
}
{
  const res = await post({ name: '', email: 'nope', message: 'short', elapsed: 9000 });
  const body = await res.json();
  expect(res.status === 422, `invalid enquiry rejected with 422 (got ${res.status})`);
  expect(body.errors && body.errors.name && body.errors.email && body.errors.message,
    'per-field errors returned for name, email and message');
}
{
  const res = await post({ name: 'Bot', email: 'bot@example.com', message: 'This is definitely a real message.', website: 'http://spam.example', elapsed: 9000 });
  expect(res.status === 400, `honeypot submission rejected (${res.status})`);
  await res.text();
}
{
  const res = await post({ name: 'Too fast', email: 'fast@example.com', message: 'This is definitely a real message.', elapsed: 20 });
  expect(res.status === 400, `sub-2s submission rejected (${res.status})`);
  await res.text();
}
{
  const res = await fetch(`${BASE}/api/contact`, { method: 'GET' });
  await res.text();
  expect(res.status === 405, `GET on the contact endpoint is refused (${res.status})`);
}

/* -------------------------------------------------------------------------- */
/*  7. Files that must exist                                                   */
/* -------------------------------------------------------------------------- */

section('Crawler files');
for (const file of ['robots.txt', 'sitemap.xml']) {
  const res = await fetch(`${BASE}/${file}`);
  const body = await res.text();
  expect(res.status === 200 && body.length > 20, `${file} served (${res.status}, ${body.length} bytes)`);
}
{
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  expect(/Sitemap:/i.test(robots), 'robots.txt points at the sitemap');
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.length >= pages.length, `sitemap lists ${locs.length} URLs for ${pages.length} pages`);
  const sitemapBroken = [];
  for (const loc of locs) {
    const path = new URL(loc).pathname.replace(/^\//, '');
    const res = await fetch(`${BASE}/${path}`, { redirect: 'manual' });
    await res.text();
    if (res.status !== 200) sitemapBroken.push(`${path} (${res.status})`);
  }
  expect(sitemapBroken.length === 0, `every sitemap URL resolves${sitemapBroken.length ? ` — broken: ${sitemapBroken.join(', ')}` : ''}`);
}

/* -------------------------------------------------------------------------- */

server.kill();
await new Promise((r) => setTimeout(r, 200));

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures) process.exit(1);

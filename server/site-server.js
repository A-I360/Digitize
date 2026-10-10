#!/usr/bin/env node
/**
 * SYNQ — local static server with an optional contact-form endpoint.
 *
 * This exists for two reasons: ES modules and `fetch` need HTTP (opening the
 * files from disk will not work), and the contact form needs somewhere real to
 * post to while you are developing.
 *
 *   node server/site-server.js            # serves the site on :8080
 *   PORT=3000 node server/site-server.js
 *
 * Static hosting in production (Netlify, Vercel, Cloudflare Pages, nginx) does
 * not need this file at all — see SETUP.md for the contact-form options.
 */

import { createServer } from 'node:http';
import { readFile, stat, appendFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { connect as netConnect } from 'node:net';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const LOG_DIR = join(ROOT, 'server', 'data');
const LOG_FILE = join(LOG_DIR, 'enquiries.log');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Rate limit: submissions per IP per window. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > RATE_MAX;
}

/** Resolves a request path inside ROOT, or null if it tries to escape. */
/**
 * Directory names that are never served.
 *
 * `../` traversal is already blocked below, but that is not the only way to
 * reach something private: the site root IS the repository root, so
 * `server/data/enquiries.log` — every name, email address, IP and budget
 * anyone has submitted — was sitting at a public URL. Anything that is not
 * part of the website must be unreachable, whether or not it is inside ROOT.
 */
const BLOCKED_SEGMENTS = new Set(['server', 'node_modules', '.git', 'tools']);

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  const candidate = resolve(join(ROOT, normalize(decoded)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;

  const inside = candidate.slice(ROOT.length).split(sep).filter(Boolean);
  if (inside.some((seg) => BLOCKED_SEGMENTS.has(seg) || seg.startsWith('.'))) return null;

  return candidate;
}

async function resolveFile(pathname) {
  const target = safePath(pathname);
  if (!target) return null;
  try {
    const info = await stat(target);
    if (info.isDirectory()) return resolveFile(join(pathname, 'index.html'));
    return target;
  } catch {
    return null;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/* -------------------------------------------------------------------------- */
/*  Contact endpoint                                                          */
/* -------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(payload) {
  const errors = {};
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const message = String(payload.message || '').trim();

  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';
  if (message.length < 12) errors.message = 'Please add a little more detail.';
  if (message.length > 5000) errors.message = 'That message is too long (5000 characters max).';
  return { errors, clean: { name, email, message,
    projectType: String(payload.projectType || '').slice(0, 80),
    budget: String(payload.budget || '').slice(0, 80) } };
}

async function handleContact(req, res, ip) {
  let raw = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 32_768) { tooBig = true; req.destroy(); }
  });

  await new Promise((done) => req.on('end', done));
  if (tooBig) return json(res, 413, { ok: false, message: 'That submission was too large.' });

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return json(res, 400, { ok: false, message: 'Malformed request body.' });
  }

  // Spam heuristics: honeypot must be empty, and a human needs a few seconds.
  if (payload.website) return json(res, 400, { ok: false, message: 'This submission looked automated.' });
  if (Number(payload.elapsed) >= 0 && Number(payload.elapsed) < 2000) {
    return json(res, 400, { ok: false, message: 'That was too fast to be a person. Try again.' });
  }
  if (rateLimited(ip)) {
    return json(res, 429, { ok: false, message: 'Too many submissions. Please email us directly.' });
  }

  const { errors, clean } = validate(payload);
  if (Object.keys(errors).length) {
    return json(res, 422, { ok: false, message: 'Please check the highlighted fields.', errors });
  }

  const record = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    ip,
    ...clean,
  };

  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    console.error('[synq] could not persist enquiry', error);
    return json(res, 500, { ok: false, message: 'We could not save that submission. Please email us directly.' });
  }

  console.log(`[synq] enquiry from ${clean.name} <${clean.email}> — ${clean.projectType || 'no type'}`);
  return json(res, 200, {
    ok: true,
    message: `Thanks ${clean.name} — your enquiry is with us. We reply within one business day.`,
  });
}

/* -------------------------------------------------------------------------- */
/*  Static handler                                                            */
/* -------------------------------------------------------------------------- */

/** pathname → the HTTP verbs that route accepts. */
const API_ROUTES = {
  '/api/contact': ['POST'],
  '/api/health': ['GET', 'HEAD'],
};

/**
 * Parses a request target without throwing.
 *
 * `new URL()` rejects a protocol-relative target like `//` (Node reads it as
 * "host is empty") and rejects some Host headers outright. Either would throw
 * inside the request handler — and an uncaught throw there takes the whole
 * site down, not just the one request.
 */
function parseTarget(req) {
  try {
    return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  // One bad request must never be able to stop the site from serving.
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error(`[synq] ${req.method} ${req.url} →`, error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    }
    res.end('Internal server error');
  }
});

async function handleRequest(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const url = parseTarget(req);
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad request');
  }

  if (req.method === 'POST' && url.pathname === '/api/contact') {
    return handleContact(req, res, ip);
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'synq-site', time: new Date().toISOString() });
  }
  // A known API route with the wrong verb gets a 405, not a 404 — a 404 would
  // suggest the endpoint does not exist at all.
  const allowed = API_ROUTES[url.pathname];
  if (allowed) {
    if (!allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '));
      return json(res, 405, { ok: false, message: `Method not allowed. Use ${allowed.join(' or ')}.` });
    }
  } else if (url.pathname.startsWith('/api/')) {
    return json(res, 404, { ok: false, message: 'No such endpoint.' });
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  let file = await resolveFile(url.pathname);
  let status = 200;

  if (!file) {
    file = await resolveFile('/404.html');
    status = 404;
  }
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  try {
    const body = await readFile(file);
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': body.length,
      // Versioned assets are cacheable; HTML is not, so edits show up instantly.
      'Cache-Control': file.includes(`${sep}assets${sep}`)
        ? 'public, max-age=3600'
        : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server error: ${error.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  WebSocket proxy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Forwards `/multiplayer` to the room server so the whole app — page, API and
 * game socket — lives on one origin. That matters for two reasons: an https
 * page is not allowed to open a plain ws:// connection, and a tunnelled
 * preview (or a corporate proxy) usually exposes only one port.
 *
 * The forward is a raw TCP splice: the browser's handshake bytes are handed to
 * the room server untouched, so it sees a normal WebSocket upgrade and answers
 * it itself. Nothing is inspected or rewritten beyond the Host header.
 */
const MP_HOST = process.env.MP_HOST || '127.0.0.1';
const MP_PORT = Number(process.env.MP_PORT || 8787);
const MP_PATH = process.env.MP_PATH || '/multiplayer';

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];
  if (pathname !== MP_PATH) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const upstream = netConnect(MP_PORT, MP_HOST);
  const kill = (err) => {
    if (err && err.code !== 'ECONNRESET') {
      console.warn(`[synq] multiplayer proxy: ${err.message}`);
    }
    upstream.destroy();
    socket.destroy();
  };

  upstream.on('error', kill);
  socket.on('error', kill);
  upstream.setTimeout(0);
  socket.setTimeout(0);

  upstream.on('connect', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const value = req.rawHeaders[i + 1];
      if (key.toLowerCase() === 'host') { lines.push(`Host: ${MP_HOST}:${MP_PORT}`); continue; }
      lines.push(`${key}: ${value}`);
    }
    lines.push('', '');
    upstream.write(lines.join('\r\n'));
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[synq] serving ${ROOT}`);
  console.log(`[synq] site        → http://localhost:${PORT}/`);
  console.log(`[synq] contact     → POST http://localhost:${PORT}/api/contact`);
  console.log(`[synq] multiplayer → ws://localhost:${PORT}${MP_PATH} → ${MP_HOST}:${MP_PORT}`);
});

// Touch the log directory once so the first submission never fails on mkdir.
mkdir(LOG_DIR, { recursive: true })
  .then(() => writeFile(join(LOG_DIR, '.gitkeep'), '', { flag: 'a' }))
  .catch(() => {});

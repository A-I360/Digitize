/**
 * Multiplayer test: two real WebSocket clients against the real server.
 *
 * Exercises the whole room lifecycle the game page depends on — handshake,
 * create, join, ready, start, position relay, finish, leave — plus the error
 * paths (bad room code, non-host trying to start, wrong protocol version).
 *
 * Uses the platform WebSocket global (Node 22+) so this test needs no
 * dependencies of its own. The server still needs `npm install` in server/.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 47000 + Math.floor(Math.random() * 3000);

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));

/* -------------------------------------------------------------------------- */

const server = spawn(process.execPath, [join(ROOT, 'server', 'multiplayer-server.js')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

/** A tiny collect-an-event client. */
class Client {
  constructor(name) {
    this.name = name;
    this.inbox = [];
    this.waiters = [];
    this.socket = null;
  }

  /** Wires a socket to this client's inbox and wakes anything waiting. */
  attach(socket) {
    this.socket = socket;
    socket.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      this.inbox.push(msg);
      const i = this.waiters.findIndex((w) => w.match(msg));
      if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(msg); }
    });
    return socket;
  }

  async open() {
    this.attach(new WebSocket(`ws://127.0.0.1:${PORT}`));
    await new Promise((res, rej) => {
      this.socket.addEventListener('open', res, { once: true });
      this.socket.addEventListener('error', rej, { once: true });
    });
  }

  send(msg) { this.socket.send(JSON.stringify(msg)); }

  /** Waits for the first message matching `predicate`, past or future. */
  wait(predicate, timeoutMs = 3000) {
    const match = typeof predicate === 'string' ? (m) => m.t === predicate : predicate;
    const i = this.inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(this.inbox[i]);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) { this.waiters.splice(at, 1); reject(new Error(`timed out waiting for a message (${this.name})`)); }
      }, timeoutMs);
    });
  }

  clear() { this.inbox.length = 0; }
  close() { try { this.socket.close(); } catch { /* already gone */ } }
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */

try {
  // Wait for the socket to accept connections.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    try {
      const probe = new WebSocket(`ws://127.0.0.1:${PORT}`);
      await new Promise((res, rej) => {
        probe.addEventListener('open', res, { once: true });
        probe.addEventListener('error', rej, { once: true });
        setTimeout(() => rej(new Error('probe timeout')), 400);
      });
      probe.close();
      ready = true;
    } catch {
      await settle(120);
    }
  }
  if (!ready) throw new Error(`server never listened\n${log}`);

  console.log('\nHandshake');
  const host = new Client('host');
  const guest = new Client('guest');
  await host.open();
  await guest.open();

  host.send({ t: 'hello', v: 1, name: 'Hosta' });
  const welcome = await host.wait('welcome');
  expect(typeof welcome.you === 'string' && welcome.you.length > 0, 'server assigns an id on hello');

  // Wrong protocol version must be refused, not silently accepted.
  const old = new Client('old');
  await old.open();
  old.send({ t: 'hello', v: 99, name: 'Legacy' });
  const rejected = await old.wait((m) => m.t === 'error').catch(() => null);
  expect(Boolean(rejected), 'a client on the wrong protocol version is refused');
  old.close();

  console.log('\nRooms');
  guest.send({ t: 'hello', v: 1, name: 'Guesty' });
  await guest.wait('welcome');

  host.send({ t: 'create', name: 'Hosta', level: 'cloudspire' });
  const room = await host.wait('room');
  expect(/^[A-Z0-9]{6}$/.test(room.code), `host receives a 6-character room code (${room.code})`);
  expect(room.host === welcome.you, 'host is marked as the room host');
  expect(room.level === 'cloudspire', 'the chosen level is echoed back');

  guest.send({ t: 'join', code: room.code.toLowerCase(), name: 'Guesty' });
  const joined = await guest.wait('room');
  expect(joined.players.length === 2, `guest sees both players in the room (${joined.players.length})`);

  const hostSeesGuest = await host.wait((m) => m.t === 'room' && m.players.length === 2);
  expect(Boolean(hostSeesGuest), 'host is notified when the guest joins');

  const bad = new Client('bad');
  await bad.open();
  bad.send({ t: 'hello', v: 1, name: 'Lost' });
  await bad.wait('welcome');
  bad.send({ t: 'join', code: 'ZZZZZZ', name: 'Lost' });
  const noRoom = await bad.wait('error').catch(() => null);
  expect(Boolean(noRoom) && /ZZZZZZ/.test(noRoom.message),
    `joining an unknown code returns a helpful error ("${noRoom && noRoom.message}")`);
  bad.close();

  console.log('\nStarting a match');
  guest.send({ t: 'start' });
  const notHost = await guest.wait('error').catch(() => null);
  expect(Boolean(notHost), 'a non-host cannot start the match');

  host.clear();
  guest.clear();
  host.send({ t: 'start' });
  const [hostStart, guestStart] = await Promise.all([host.wait('start'), guest.wait('start')]);
  expect(hostStart.level === 'cloudspire', 'both clients are told which level to load');
  expect(hostStart.at > Date.now() - 5000 && guestStart.at === hostStart.at,
    'both clients get the same start timestamp so they begin together');

  console.log('\nPlaying');
  guest.clear();
  host.send({ t: 'state', x: 1234.5, y: 456.25, vx: 240, vy: -90, facing: 1, anim: 'run', shards: 3, hearts: 2 });
  const relayed = await guest.wait((m) => m.t === 'state' && m.x === 1234.5);
  expect(relayed.y === 456.25 && relayed.anim === 'run' && relayed.shards === 3,
    'position/animation state is relayed to the other player');
  expect(relayed.id === welcome.you, 'the relayed state is attributed to the sender');

  const hostSawOwn = host.inbox.some((m) => m.t === 'state' && m.x === 1234.5);
  expect(!hostSawOwn, 'the sender does not receive an echo of its own state');

  console.log('\nFinishing');
  guest.clear();
  host.send({ t: 'finish', time: 88.42, shards: 11 });
  const finish = await guest.wait('finish');
  expect(Math.abs(finish.time - 88.42) < 0.01, 'finish time is broadcast to the room');
  expect(finish.name === 'Hosta', 'the finish is attributed to the right player');

  console.log('\nLeaving');
  const code = room.code;
  guest.close();
  await settle(150);
  const leftNote = await host.wait('left').catch(() => null);
  expect(Boolean(leftNote), 'the remaining player is told when someone leaves');
  const afterLeave = await host.wait((m) => m.t === 'room' && m.players.length === 1);
  expect(afterLeave.players.length === 1 && afterLeave.host === welcome.you,
    'the room roster updates and host stays with the remaining player');

  // A match already in progress must say so rather than silently dropping the
  // newcomer into the middle of it.
  const mid = new Client('mid');
  await mid.open();
  mid.send({ t: 'hello', v: 1, name: 'Mid' });
  await mid.wait('welcome');
  mid.send({ t: 'join', code, name: 'Mid' });
  const inProgress = await mid.wait('error').catch(() => null);
  expect(Boolean(inProgress) && /already started/i.test(inProgress.message || ''),
    `joining a match in progress is refused with an explanation ("${inProgress && inProgress.message}")`);
  mid.close();

  // Once everybody leaves, the code stops existing at all.
  host.close();
  await settle(200);
  const late = new Client('late');
  await late.open();
  late.send({ t: 'hello', v: 1, name: 'Late' });
  await late.wait('welcome');
  late.send({ t: 'join', code, name: 'Late' });
  const gone = await late.wait('error').catch(() => null);
  expect(Boolean(gone) && new RegExp(code).test(gone.message || ''),
    `an empty room is reaped and its code stops working ("${gone && gone.message}")`);
  late.close();
} catch (error) {
  fail(`threw: ${error.message}`);
  console.error(error);
}
await settle(150);

/* -------------------------------------------------------------------------- */
/*  Same-origin proxy                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The site server proxies /multiplayer to the room server, so the page, the
 * API and the game socket share one origin. Re-run the core handshake through
 * it — a proxy that mangles the upgrade handshake looks identical to a server
 * that is down.
 */
console.log('\nSame-origin proxy');
{
  const SITE_PORT = PORT + 1;
  const site = spawn(process.execPath, [join(ROOT, 'server', 'site-server.js')], {
    env: { ...process.env, PORT: String(SITE_PORT), HOST: '127.0.0.1', MP_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let siteLog = '';
  site.stdout.on('data', (d) => { siteLog += d; });
  site.stderr.on('data', (d) => { siteLog += d; });

  try {
    const target = `ws://127.0.0.1:${SITE_PORT}/multiplayer`;
    let ready = false;
    for (let i = 0; i < 50 && !ready; i += 1) {
      try {
        const probe = new WebSocket(target);
        await new Promise((res, rej) => {
          probe.addEventListener('open', res, { once: true });
          probe.addEventListener('error', rej, { once: true });
          setTimeout(() => rej(new Error('probe timeout')), 400);
        });
        probe.close();
        ready = true;
      } catch { await settle(120); }
    }
    if (!ready) throw new Error(`proxy never accepted a connection\n${siteLog}`);

    const a = new Client('proxy-a');
    const b = new Client('proxy-b');
    for (const c of [a, b]) {
      c.attach(new WebSocket(target));
      await new Promise((res, rej) => {
        c.socket.addEventListener('open', res, { once: true });
        c.socket.addEventListener('error', rej, { once: true });
      });
    }
    expect(true, 'two clients complete the WebSocket upgrade through the proxy');

    for (const c of [a, b]) {
      c.socket.addEventListener('error', () => { c.errored = true; });
      c.socket.addEventListener('close', (ev) => { c.closed = `${ev.code}`; });
    }
    a.send({ t: 'hello', v: 1, name: 'A' });
    b.send({ t: 'hello', v: 1, name: 'B' });
    try {
      await Promise.all([a.wait('welcome'), b.wait('welcome')]);
    } catch (error) {
      throw new Error(`${error.message} | a: errored=${a.errored} closed=${a.closed} inbox=${JSON.stringify(a.inbox)}` +
        ` | b: errored=${b.errored} closed=${b.closed} inbox=${JSON.stringify(b.inbox)}` +
        ` | site: ${siteLog.slice(-400)}`);
    }
    expect(true, 'hello/welcome round-trips through the proxy');

    a.send({ t: 'create', name: 'A', level: 'first-light' });
    const room = await a.wait('room');
    b.send({ t: 'join', code: room.code, name: 'B' });
    const two = await b.wait((m) => m.t === 'room' && m.players.length === 2);
    expect(two.players.length === 2, `a room created and joined through the proxy (${room.code})`);

    a.send({ t: 'start' });
    const [sa, sb] = await Promise.all([a.wait('start'), b.wait('start')]);
    expect(sa.level === 'first-light' && sb.at === sa.at, 'match start is broadcast through the proxy');

    b.clear();
    a.send({ t: 'state', x: 512, y: 256, vx: 100, vy: 0, facing: -1, anim: 'fall', shards: 1, hearts: 3 });
    const relayed = await b.wait((m) => m.t === 'state' && m.x === 512);
    expect(relayed.anim === 'fall', 'position updates survive the proxy');

    const t0 = Date.now();
    a.send({ t: 'ping', ts: t0 });
    await a.wait('pong');
    expect(Date.now() - t0 < 1500, `ping/pong through the proxy in ${Date.now() - t0}ms`);

    a.close(); b.close();
  } catch (error) {
    fail(`proxy threw: ${error.message}`);
  } finally {
    site.kill();
    await settle(150);
  }
}

server.kill();
await settle(150);

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures) process.exit(1);

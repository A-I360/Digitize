#!/usr/bin/env node
/**
 * Aether Drift — online multiplayer server.
 *
 * A small, dependency-light room server for the race mode. It is deliberately
 * authoritative about the things that matter (who is in the room, who is the
 * host, when a match starts, who finished) and deliberately dumb about
 * everything else: each client simulates its own player and broadcasts
 * position, so the server never has to run the physics.
 *
 * Run it:
 *     cd server && npm install && npm run multiplayer
 *     # or: PORT=8787 node multiplayer-server.js
 *
 * Then point the client at it in js/site/config.js:
 *     MULTIPLAYER.serverUrl = 'ws://localhost:8787'
 *
 * There is no persistence, no authentication and no secrets. Rooms live in
 * memory and disappear when the process stops.
 */

import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PROTOCOL_VERSION = 1;

const MAX_PLAYERS_PER_ROOM = 4;
const ROOM_TTL_MS = 1000 * 60 * 60 * 2; // empty rooms are reaped after 2h
const HEARTBEAT_MS = 30_000;

/** code → room */
const rooms = new Map();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

function makeCode() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = '';
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function makeId() {
  return randomBytes(6).toString('hex');
}

function publicRoom(room) {
  return {
    code: room.code,
    host: room.host,
    phase: room.phase,
    level: room.level,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, skin: p.skin, ready: p.ready, finished: p.finished, time: p.time,
    })),
  };
}

function createRoom(level) {
  const code = makeCode();
  if (!code) return null;
  const room = {
    code,
    host: null,
    phase: 'lobby', // lobby | playing | finished
    level: level || 'first-light',
    players: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function broadcast(room, payload, exceptId = null) {
  const data = JSON.stringify(payload);
  for (const p of room.players) {
    if (p.id === exceptId) continue;
    if (p.socket.readyState === 1) p.socket.send(data);
  }
}

function send(socket, payload) {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}

const wss = new WebSocketServer({ port: PORT, host: HOST });

wss.on('listening', () => {
  console.log(`[aether] multiplayer server listening on ws://${HOST}:${PORT}`);
});

wss.on('connection', (socket) => {
  const conn = {
    id: null,
    name: 'Guest',
    skin: 0,
    room: null,
    ready: false,
    finished: false,
    time: null,
    socket,
    alive: true,
  };

  socket.on('pong', () => { conn.alive = true; });

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    conn.room && (conn.room.lastActivity = Date.now());
    handle(conn, msg);
  });

  socket.on('close', () => {
    const room = conn.room;
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== conn.id);
    room.lastActivity = Date.now();
    if (room.players.length === 0) {
      rooms.delete(room.code);
      console.log(`[aether] room ${room.code} closed (empty)`);
      return;
    }
    // Hand the host role on if the host left.
    if (room.host === conn.id) room.host = room.players[0].id;
    broadcast(room, { t: 'left', id: conn.id });
    broadcast(room, { t: 'room', ...publicRoom(room) });
  });

  socket.on('error', () => { /* logged by ws; nothing else to do */ });

  function handle(c, m) {
    switch (m.t) {
      case 'hello': {
        if ((m.v ?? 0) !== PROTOCOL_VERSION) {
          send(socket, { t: 'error', message: 'This server speaks a different protocol version. Refresh the game page.' });
          socket.close();
          return;
        }
        c.id = makeId();
        c.name = String(m.name || 'Guest').slice(0, 14);
        send(socket, { t: 'welcome', you: c.id });
        break;
      }

      case 'create': {
        if (!c.id) return;
        const room = createRoom(m.level);
        if (!room) {
          send(socket, { t: 'error', message: 'Could not allocate a room. Try again.' });
          return;
        }
        c.name = String(m.name || c.name).slice(0, 14);
        c.room = room;
        c.ready = true;
        room.host = c.id;
        room.level = m.level || room.level;
        room.players.push(c);
        console.log(`[aether] room ${room.code} created by ${c.name}`);
        send(socket, { t: 'room', ...publicRoom(room) });
        break;
      }

      case 'join': {
        if (!c.id) return;
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const room = rooms.get(code);
        if (!room) {
          send(socket, { t: 'error', message: `No room with the code ${code || '(empty)'}. Check the code and try again.` });
          return;
        }
        if (room.phase !== 'lobby') {
          send(socket, { t: 'error', message: 'That match has already started.' });
          return;
        }
        if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
          send(socket, { t: 'error', message: `That room is full (${MAX_PLAYERS_PER_ROOM} players).` });
          return;
        }
        c.name = String(m.name || c.name).slice(0, 14);
        c.room = room;
        room.players.push(c);
        console.log(`[aether] ${c.name} joined ${room.code} (${room.players.length} players)`);
        broadcast(room, { t: 'room', ...publicRoom(room) });
        break;
      }

      case 'ready': {
        const room = c.room;
        if (!room) return;
        c.ready = !c.ready;
        broadcast(room, { t: 'room', ...publicRoom(room) });
        break;
      }

      case 'start': {
        const room = c.room;
        if (!room) return;
        if (room.host !== c.id) {
          send(socket, { t: 'error', message: 'Only the host can start the match.' });
          return;
        }
        if (room.players.length < 2) {
          // Solo start is allowed so a host can practise, but say so clearly.
          console.log(`[aether] room ${room.code} starting with ${room.players.length} player(s)`);
        }
        room.phase = 'playing';
        room.players.forEach((p) => { p.finished = false; p.time = null; });
        const at = Date.now() + 2500; // small countdown window on the clients
        broadcast(room, { t: 'start', level: room.level, at, serverTime: Date.now() });
        broadcast(room, { t: 'room', ...publicRoom(room) });
        console.log(`[aether] match started in ${room.code} on ${room.level}`);
        break;
      }

      case 'state': {
        const room = c.room;
        if (!room || room.phase !== 'playing') return;
        // Relay to everyone else; the sender already knows its own state.
        broadcast(room, {
          t: 'state',
          id: c.id,
          name: c.name,
          skin: Number.isFinite(m.skin) ? m.skin : c.skin,
          x: Number(m.x) || 0,
          y: Number(m.y) || 0,
          vx: Number(m.vx) || 0,
          vy: Number(m.vy) || 0,
          facing: m.facing === -1 ? -1 : 1,
          anim: typeof m.anim === 'string' ? m.anim.slice(0, 12) : 'idle',
          shards: Number(m.shards) || 0,
          hearts: Number(m.hearts) || 0,
          finished: Boolean(m.finished),
        }, c.id);
        break;
      }

      case 'finish': {
        const room = c.room;
        if (!room || c.finished) return;
        c.finished = true;
        c.time = Number(m.time) || 0;
        broadcast(room, { t: 'finish', id: c.id, name: c.name, time: c.time, shards: Number(m.shards) || 0 });
        broadcast(room, { t: 'room', ...publicRoom(room) });
        console.log(`[aether] ${c.name} finished ${room.level} in ${c.time.toFixed(2)}s`);
        break;
      }

      case 'leave': {
        const room = c.room;
        if (room) {
          room.players = room.players.filter((p) => p.id !== c.id);
          if (room.players.length === 0) rooms.delete(room.code);
          else {
            if (room.host === c.id) room.host = room.players[0].id;
            broadcast(room, { t: 'left', id: c.id });
            broadcast(room, { t: 'room', ...publicRoom(room) });
          }
          c.room = null;
        }
        break;
      }

      case 'ping': {
        send(socket, { t: 'pong', ts: m.ts ?? Date.now() });
        break;
      }

      default:
        break;
    }
  }
});

/* Heartbeat: drop sockets that stopped answering. */
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    client.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(code);
      console.log(`[aether] reaped idle room ${code}`);
    }
  }
}, HEARTBEAT_MS);

function shutdown() {
  clearInterval(heartbeat);
  console.log('\n[aether] shutting down');
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

# Servers

Two small Node servers, both optional. The website itself is static — you only need these
for **contact-form delivery** and **online multiplayer**.

```bash
npm --prefix server install    # multiplayer needs `ws`; the site server needs nothing
```

## `site-server.js` — static files + contact

Zero dependencies.

```bash
node server/site-server.js
# PORT=3000 HOST=127.0.0.1 node server/site-server.js
```

Serves the repository root with correct MIME types, path-traversal protection, a 404 page
for unknown paths, and `no-cache` on HTML so edits appear immediately.

### `POST /api/contact`

Accepts JSON, validates it, and appends each enquiry to `server/data/enquiries.jsonl`
(gitignored).

```jsonc
// request
{ "name": "Ada", "email": "ada@example.com", "message": "…",
  "projectType": "Web app", "budget": "₦1.5m – ₦3m",
  "elapsed": 9000, "website": "" }

// 200
{ "ok": true, "message": "Thanks Ada — your enquiry is with us." }

// 422 — per-field errors the form renders next to each input
{ "ok": false, "message": "Please check the highlighted fields.",
  "errors": { "email": "Please enter a valid email address." } }
```

Protections, all adjustable at the top of `handleContact()`:

- **Honeypot** — a `website` field that must be empty
- **Minimum time** — submissions faster than 2 s are rejected
- **Rate limit** — 5 per IP per minute
- **Size cap** — request bodies over 32 kB are dropped

`website` and `elapsed` are sent by `js/site/pages/contact.js`; if you write your own
client, send them and the server-side checks work for you too.

To forward enquiries somewhere real, edit `handleContact()` — send an email, post to a
CRM, push to Slack. The log file is a development convenience, not a destination.

### `GET /api/health`

`{ "ok": true, service: "synq-site", time: "…" }` — useful for uptime checks.

### WebSocket proxy

`ws://<host>/multiplayer` is forwarded raw to the room server (`127.0.0.1:8787` by
default). Override with `MP_HOST`, `MP_PORT`, `MP_PATH`.

This exists so the page, the API and the game socket share **one origin**. An `https://`
page is not allowed to open an insecure `ws://` connection, and preview tunnels and
corporate proxies usually expose a single port. Nothing is inspected or rewritten apart
from the `Host` header.

## `multiplayer-server.js` — game rooms

```bash
npm --prefix server run multiplayer
# PORT=8787 node server/multiplayer-server.js
```

Rooms live in memory; there is no database, no auth and no persistence. Restarting drops
every room. Empty rooms are reaped after two hours; dead sockets after one heartbeat.

### Wire protocol

JSON messages, `PROTOCOL_VERSION = 1`. A client that announces a different version is
refused with an error rather than silently mis-read.

| Client → server | | Server → client |
|---|---|---|
| `hello {v, name}` | handshake | `welcome {you}` · `error {message}` |
| `create {name, level}` | host a room | `room {code, host, phase, level, players[]}` |
| `join {code, name}` | join by code | `room {…}` · `error {message}` |
| `ready` | toggle readiness | `room {…}` |
| `start` | host only | `start {level, at, serverTime}` · `error` |
| `state {x,y,vx,vy,facing,anim,shards,hearts,finished}` | ~20 Hz | `state {…, id, name, skin}` |
| `finish {time, shards}` | cross the portal | `finish {id, name, time, shards}` |
| `leave` | | `left {id}` · `room {…}` |
| `ping {ts}` | | `pong {ts}` |

`start.at` is an absolute server timestamp in the future, so every client begins on the
same countdown regardless of its clock.

### Design notes

The server is authoritative about the **lobby** — who is in it, who is host, when the
match starts, who finished. It is deliberately *not* authoritative about physics: each
client simulates its own player and broadcasts position, which keeps the server free of
game logic and makes a room cheap to run.

The trade-off is that a client can lie about where it is. For a friendly race that is
fine. If you need cheat prevention, the fix is to move `world.js` onto the server and
replay inputs — the protocol above already carries everything required for that except
`input`, which `net.js` can send.

Error messages are written to be shown to players verbatim (“No room with the code
ABC123. Check the code and try again.”). Please keep them that way.

## Deploying

Both are plain Node processes with no build step. Run them behind a reverse proxy that
terminates TLS and forwards `Upgrade` headers (needed for the WebSocket):

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
}
```

For a purely static deploy, use a managed form service for contact and point
`MULTIPLAYER.serverUrl` at the room server's own `wss://` address. See
[SETUP.md](../SETUP.md).

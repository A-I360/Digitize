/**
 * Aether Drift — online multiplayer transport.
 *
 * A thin, dependency-free WebSocket client. It owns nothing but the socket:
 * the game reads connection state from `status` and never assumes a session is
 * live unless the server said so.
 *
 * Wire protocol (JSON):
 *   → hello { v, name }            ← welcome { you }
 *   → create { name, level }       ← room { code, host, players, phase }
 *   → join { code, name }          ← room { ... }
 *   → ready                        ← room { ... }
 *   → start                        ← start { level, at }
 *   → state { x, y, vx, vy, facing, anim, shards, hearts, finished }
 *   → finish { time, shards }      ← finish { id, time, shards }
 *   → leave                        ← left { id }, error { message }
 *   → ping { ts }                  ← pong { ts }
 *
 * The bundled server implementing this lives in server/multiplayer-server.js.
 */

const PROTOCOL_VERSION = 1;

export const NET_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  IN_ROOM: 'in-room',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
  CLOSED: 'closed',
};

/**
 * Turns the configured `serverUrl` into an absolute WebSocket URL.
 *
 *   'wss://example.com/mp' → unchanged
 *   '/multiplayer'         → ws(s)://<this origin>/multiplayer
 *   ':8787'                → ws(s)://<this hostname>:8787
 *
 * The relative forms matter because a static file host, a local dev server and
 * a preview tunnel all live on different origins, and an https page is not
 * allowed to open an insecure ws:// connection to itself.
 */
export function resolveServerUrl(serverUrl) {
  if (!serverUrl) return null;
  const raw = String(serverUrl).trim();
  if (/^wss?:\/\//i.test(raw)) return raw;
  if (typeof location === 'undefined') return raw;

  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (raw.startsWith('/')) return `${scheme}//${location.host}${raw}`;
  if (raw.startsWith(':')) return `${scheme}//${location.hostname}${raw}`;
  return raw;
}

export class MultiplayerClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.status = NET_STATUS.IDLE;
    this.you = null;
    this.room = null;
    this.latency = null;
    this.lastError = null;
    this.listeners = new Map();
    this.pingTimer = 0;
    this.reconnectTimer = 0;
    this.shouldReconnect = false;
    this.remoteStates = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  setStatus(status, detail) {
    this.status = status;
    this.emit('status', { status, detail, error: this.lastError });
  }

  /** Resolves once the socket is open; rejects with a readable message. */
  connect(timeoutMs = 6000) {
    if (!this.url) {
      this.lastError = 'No multiplayer server is configured.';
      this.setStatus(NET_STATUS.ERROR, this.lastError);
      return Promise.reject(new Error(this.lastError));
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN)) return Promise.resolve();

    this.shouldReconnect = true;
    this.setStatus(NET_STATUS.CONNECTING);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.lastError = 'The multiplayer server did not respond in time.';
        this.setStatus(NET_STATUS.ERROR, this.lastError);
        try { this.ws?.close(); } catch { /* already gone */ }
        reject(new Error(this.lastError));
      }, timeoutMs);

      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (error) {
        clearTimeout(timer);
        this.lastError = `Could not open a connection: ${error.message}`;
        this.setStatus(NET_STATUS.ERROR, this.lastError);
        reject(new Error(this.lastError));
        return;
      }
      this.ws = ws;

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        settled = true;
        this.setStatus(NET_STATUS.CONNECTED);
        this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.pendingName || 'Player' });
        this.startPing();
        resolve();
      });

      ws.addEventListener('message', (event) => this.handleMessage(event.data));

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        if (settled) { this.handleDrop(); return; }
        settled = true;
        this.lastError = 'Could not reach the multiplayer server.';
        this.setStatus(NET_STATUS.ERROR, this.lastError);
        reject(new Error(this.lastError));
      });

      ws.addEventListener('close', () => {
        clearTimeout(timer);
        this.stopPing();
        if (settled) this.handleDrop();
        else {
          settled = true;
          this.lastError = 'The multiplayer server closed the connection.';
          reject(new Error(this.lastError));
        }
      });
    });
  }

  handleDrop() {
    this.room = null;
    this.stopPing();
    if (!this.shouldReconnect) {
      this.setStatus(NET_STATUS.CLOSED);
      return;
    }
    this.setStatus(NET_STATUS.RECONNECTING);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect(5000)
        .then(() => {
          if (this.pendingRoom) {
            this.send(this.pendingRoom.host
              ? { t: 'create', name: this.pendingName, level: this.pendingLevel }
              : { t: 'join', code: this.pendingRoom.code, name: this.pendingName });
          }
        })
        .catch(() => this.setStatus(NET_STATUS.ERROR, this.lastError));
    }, 1500);
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'ping', ts: Date.now() });
    }, 3000);
  }

  stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }

  handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {
      case 'welcome':
        this.you = msg.you;
        this.emit('welcome', msg);
        break;
      case 'room':
        this.room = msg;
        this.setStatus(NET_STATUS.IN_ROOM);
        this.emit('room', msg);
        break;
      case 'start':
        this.emit('start', msg);
        break;
      case 'state':
        if (msg.id !== this.you) this.remoteStates.set(msg.id, msg);
        this.emit('peer', msg);
        break;
      case 'finish':
        this.emit('finish', msg);
        break;
      case 'left':
        this.remoteStates.delete(msg.id);
        this.emit('left', msg);
        break;
      case 'pong':
        this.latency = Date.now() - msg.ts;
        break;
      case 'error':
        this.lastError = msg.message || 'The multiplayer server rejected that request.';
        this.emit('serverError', this.lastError);
        break;
      default:
        break;
    }
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /* ---- Public actions --------------------------------------------------- */

  async hostRoom({ name, level }) {
    this.pendingName = name;
    this.pendingLevel = level;
    this.pendingRoom = { host: true };
    await this.connect();
    this.send({ t: 'create', name, level });
  }

  async joinRoom({ code, name }) {
    this.pendingName = name;
    this.pendingRoom = { code: code.toUpperCase().replace(/[^A-Z0-9]/g, '') };
    await this.connect();
    this.send({ t: 'join', code: this.pendingRoom.code, name });
  }

  setReady() { this.send({ t: 'ready' }); }
  requestStart() { this.send({ t: 'start' }); }
  sendState(state) { this.send({ t: 'state', ...state }); }
  sendFinish(payload) { this.send({ t: 'finish', ...payload }); }
  sendInput(input) { this.send({ t: 'input', ...input }); }

  leave() {
    this.shouldReconnect = false;
    this.pendingRoom = null;
    this.send({ t: 'leave' });
    this.stopPing();
    clearTimeout(this.reconnectTimer);
    try { this.ws?.close(); } catch { /* nothing to do */ }
    this.ws = null;
    this.room = null;
    this.remoteStates.clear();
    this.setStatus(NET_STATUS.IDLE);
  }

  get isLive() {
    return this.status === NET_STATUS.IN_ROOM || this.status === NET_STATUS.CONNECTED;
  }
}

/** Human-readable label for the HUD badge. */
export function statusLabel(status, latency) {
  const ping = latency ? ` · ${latency}ms` : '';
  switch (status) {
    case NET_STATUS.CONNECTED: return { ok: true, text: `Online${ping}` };
    case NET_STATUS.IN_ROOM: return { ok: true, text: `In room${ping}` };
    case NET_STATUS.CONNECTING: return { ok: false, text: 'Connecting…' };
    case NET_STATUS.RECONNECTING: return { ok: false, text: 'Reconnecting…' };
    case NET_STATUS.ERROR: return { ok: false, text: 'Offline' };
    case NET_STATUS.CLOSED: return { ok: false, text: 'Disconnected' };
    default: return { ok: false, text: 'Not connected' };
  }
}

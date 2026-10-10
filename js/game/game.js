/**
 * Aether Drift — game controller.
 *
 * Owns the loop, the mode, level progression and the bridge between the
 * simulation (world.js), the renderer (render.js), input and audio. It is
 * deliberately UI-agnostic: the page (main.js) drives it through these methods
 * and listens to callbacks.
 *
 * Loop: fixed-timestep physics (see WORLD.FIXED_STEP) with an accumulator and
 * interpolated rendering, so movement is identical at 60 Hz, 120 Hz or during
 * a frame spike.
 */

import { LEVELS, LEVELS_BY_ID } from './levels.js';
import { createWorld, createPlayer, stepWorld, resetWorldProgress, syncRender } from './world.js';
import { WorldRenderer, Camera } from './render.js';
import { GameAudio } from './audio.js';
import { Keyboard, TouchPad, PlayerInput, SCHEMES, EMPTY_INPUT } from './input.js';
import { WORLD, PLAYER, VISUAL, SKINS } from './constants.js';
import { MultiplayerClient, statusLabel } from './net.js';
import { clamp, prefersReducedMotion, deviceTier } from './utils.js';

export const MODE = { SOLO: 'solo', LOCAL: 'local', ONLINE: 'online' };
export const STATE = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETE: 'complete',
  ENDED: 'ended',
};

const STATE_HZ_SEND = 20;

export class Game {
  constructor({ canvas, serverUrl = null, callbacks = {} }) {
    this.canvas = canvas;
    this.renderer = new WorldRenderer(canvas);
    this.camera = new Camera();
    this.audio = new GameAudio();
    this.keyboard = new Keyboard(window);
    this.touch = new TouchPad(document.querySelector('[data-touch-root]'));
    this.cb = callbacks;

    this.state = STATE.IDLE;
    this.mode = MODE.SOLO;
    this.levelIndex = 0;
    this.world = null;
    this.players = [];
    this.ghosts = new Map();       // online: remote player render state
    this.accumulator = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.time = 0;
    this.levelTime = 0;
    this.nickname = 'Player';
    this.skinIndex = 0;
    this.reducedMotion = prefersReducedMotion();
    this.quality = deviceTier();
    this.serverUrl = serverUrl;
    this.net = null;
    this.netSendTimer = 0;
    this.results = null;

    this.renderer.setQuality(this.quality);
    this.onResize = () => this.resize();
    this.onVisibility = () => {
      if (document.hidden && this.state === STATE.RUNNING) this.pause();
    };

    window.addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  /* ---- Setup ----------------------------------------------------------- */

  resize() {
    this.renderer.resize();
  }

  destroy() {
    this.stop();
    this.keyboard.destroy();
    this.touch.destroy();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.audio.dispose();
    this.net?.leave();
  }

  setNickname(name) {
    this.nickname = (name || 'Player').slice(0, 14);
  }

  setSkin(index) {
    this.skinIndex = clamp(index, 0, SKINS.length - 1);
  }

  /**
   * Starts a run.
   * @param {string} mode      MODE.SOLO | MODE.LOCAL | MODE.ONLINE
   * @param {object} options   { levelId, levelIndex, roomCode, nickname, skinIndex }
   */
  async start(mode, options = {}) {
    this.mode = mode;
    this.levelIndex = options.levelIndex ?? Math.max(0, LEVELS.findIndex((l) => l.id === options.levelId));
    if (options.nickname) this.setNickname(options.nickname);
    if (options.skinIndex !== undefined) this.setSkin(options.skinIndex);

    this.audio.unlock();
    this.keyboard.enabled = true;

    if (mode === MODE.ONLINE) {
      const started = await this.startOnline(options);
      if (!started) return false;
      // Online matches begin in the lobby: the host presses Start and the
      // server broadcasts a `start` message, which calls beginOnlineMatch().
      this.state = STATE.PAUSED;
      this.emitState();
      this.loopIdle();
      return true;
    }

    this.loadLevel(this.levelIndex);
    this.state = STATE.RUNNING;
    this.emitState();
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.loop();
    return true;
  }

  /** Called from the page once the server broadcasts the match start. */
  beginOnlineMatch() {
    cancelAnimationFrame(this.raf);
    this.state = STATE.RUNNING;
    this.keyboard.enabled = true;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.emitState();
    this.loop();
  }

  loadLevel(index) {
    this.levelIndex = clamp(index, 0, LEVELS.length - 1);
    const def = LEVELS[this.levelIndex];
    this.world = createWorld(def);
    this.renderer.setWorld(this.world);
    this.audio.setBiome(def.biome);
    this.levelTime = 0;
    this.results = null;

    const count = this.mode === MODE.LOCAL ? 2 : 1;
    this.players = Array.from({ length: count }, (_, i) => {
      const player = createPlayer({
        id: `local-${i}`,
        name: i === 0 ? this.nickname : 'Player 2',
        skinIndex: i === 0 ? this.skinIndex : (this.skinIndex + 1) % SKINS.length,
        world: this.world,
      });
      player.renderX = player.x;
      player.renderY = player.y;
      player.scarf.forEach((s) => { s.x = s.px = player.x + player.w / 2; s.y = s.py = player.y + 6; });
      player.input = i === 0
        ? new PlayerInput(SCHEMES.p1, { keyboard: this.keyboard, touch: this.touch })
        : new PlayerInput(SCHEMES.p2, { keyboard: this.keyboard });
      // Stagger spawns slightly so the two do not stand exactly on top of each other.
      if (i === 1) { player.x -= 22; player.spawnX -= 22; }
      return player;
    });

    this.ghosts.clear();
    this.camera.snapTo(this.players[0], this.world, this.renderer.viewW, this.renderer.viewH);
    this.cb.onLevel?.(def, this.levelIndex);
  }

  /* ---- Online ----------------------------------------------------------- */

  async startOnline(options) {
    if (!this.serverUrl) {
      this.cb.onError?.(
        'Online play needs a multiplayer server, and none is configured for this deployment. ' +
        'Local two-player works right now — see SETUP.md to switch online play on.'
      );
      return false;
    }

    if (!this.net) {
      this.net = new MultiplayerClient(this.serverUrl);
      this.net.on('room', (room) => this.cb.onRoom?.(room));
      this.net.on('serverError', (message) => this.cb.onError?.(message));
      this.net.on('start', (msg) => {
        const idx = Math.max(0, LEVELS.findIndex((l) => l.id === msg.level));
        this.loadLevel(idx);
        this.cb.onRoomStart?.(msg);
      });
      this.net.on('peer', (msg) => this.applyGhost(msg));
      this.net.on('left', (msg) => this.ghosts.delete(msg.id));
      this.net.on('finish', (msg) => this.cb.onPeerFinish?.(msg));
      this.net.on('status', () => this.emitState());
    }

    try {
      if (options.roomCode) await this.net.joinRoom({ code: options.roomCode, name: this.nickname });
      else await this.net.hostRoom({ name: this.nickname, level: LEVELS[this.levelIndex].id });
    } catch (error) {
      this.cb.onError?.(error.message || 'Could not reach the multiplayer server.');
      this.cb.onRoom?.(null);
      return false;
    }

    // Build the level so the lobby renders behind the overlay, then wait for
    // the host's start signal.
    this.loadLevel(this.levelIndex);
    return true;
  }

  /** Called from the lobby once the room is full enough to play. */
  requestOnlineStart() {
    this.net?.requestStart();
  }

  applyGhost(msg) {
    const skinIndex = Number.isFinite(msg.skin) ? msg.skin : 2;
    const existing = this.ghosts.get(msg.id) || {
      id: msg.id, name: msg.name || 'Guest',
      skinIndex,
      // Ghosts are drawn by exactly the same code as local players, so they
      // need a resolved skin, not just an index into one.
      skin: SKINS[skinIndex] || SKINS[0],
      w: PLAYER.WIDTH, h: PLAYER.HEIGHT, facing: 1, anim: { state: 'idle', time: 0, run: 0, land: 0 },
      scarf: Array.from({ length: 7 }, () => ({ x: msg.x, y: msg.y, px: msg.x, py: msg.y })),
      x: msg.x, y: msg.y, renderX: msg.x, renderY: msg.y,
      targetX: msg.x, targetY: msg.y, vx: 0, vy: 0, shards: 0, hearts: 3,
      finished: false, dead: false, invuln: 0, hurtFlash: 0, remote: true,
    };
    existing.targetX = msg.x;
    existing.targetY = msg.y;
    existing.vx = msg.vx ?? 0;
    existing.vy = msg.vy ?? 0;
    existing.facing = msg.facing ?? 1;
    existing.shards = msg.shards ?? existing.shards;
    existing.hearts = msg.hearts ?? existing.hearts;
    existing.finished = Boolean(msg.finished);
    existing.anim.state = msg.anim || 'idle';
    if (Number.isFinite(msg.skin)) {
      existing.skinIndex = msg.skin;
      existing.skin = SKINS[msg.skin] || existing.skin;
    }
    existing.anim.time += 1 / 60;
    if (existing.anim.state === 'run') existing.anim.run += 0.2;
    existing.name = msg.name || existing.name;
    this.ghosts.set(msg.id, existing);
  }

  /* ---- Loop ------------------------------------------------------------- */

  loop() {
    cancelAnimationFrame(this.raf);
    const frame = (now) => {
      if (this.state !== STATE.RUNNING) return;
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.step(dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Renders (but does not simulate) while waiting in an online lobby. */
  loopIdle() {
    cancelAnimationFrame(this.raf);
    const frame = (now) => {
      if (this.state === STATE.RUNNING) return;
      const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
      this.lastFrame = now;
      this.render(dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  step(dt) {
    this.levelTime += dt;
    this.accumulator += dt;

    let steps = 0;
    const actors = this.players.map((player) => ({
      player,
      input: player.input ? player.input.read() : EMPTY_INPUT,
    }));

    while (this.accumulator >= WORLD.FIXED_STEP && steps < WORLD.MAX_STEPS) {
      stepWorld(this.world, WORLD.FIXED_STEP, actors);
      this.accumulator -= WORLD.FIXED_STEP;
      steps += 1;
    }
    if (steps >= WORLD.MAX_STEPS) this.accumulator = 0; // give up on catching up

    this.drainEvents();

    const alpha = this.accumulator / WORLD.FIXED_STEP;
    for (const p of this.players) syncRender(p, alpha);
    for (const g of this.ghosts.values()) {
      // Exponential smoothing removes network jitter without visible snapping.
      const k = 1 - Math.exp(-14 * dt);
      g.renderX += (g.targetX - g.renderX) * k;
      g.renderY += (g.targetY - g.renderY) * k;
      g.x = g.renderX;
      g.y = g.renderY;
    }

    this.keyboard.endFrame();
    this.touch.endFrame();

    if (this.mode === MODE.ONLINE) this.sendNetworkState(dt);

    this.render(dt);
    this.checkCompletion();
  }

  render(dt) {
    const targets = this.mode === MODE.LOCAL ? this.players : [this.players[0]];
    if (this.world) {
      this.camera.update(targets, this.world, this.renderer.viewW, this.renderer.viewH, dt);
    }
    const drawPlayers = [...this.players, ...this.ghosts.values()];
    this.renderer.draw({
      camera: this.camera,
      players: drawPlayers,
      alpha: 0,
      dt,
      showHud: this.state === STATE.RUNNING || this.state === STATE.PAUSED || this.state === STATE.COMPLETE,
      hud: this.hudData(),
    });
  }

  sendNetworkState(dt) {
    if (!this.net?.isLive) return;
    this.netSendTimer -= dt;
    if (this.netSendTimer > 0) return;
    this.netSendTimer = 1 / STATE_HZ_SEND;
    const p = this.players[0];
    this.net.sendState({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      vx: Math.round(p.vx),
      vy: Math.round(p.vy),
      facing: p.facing,
      anim: p.anim.state,
      shards: p.shards,
      hearts: p.hearts,
      finished: p.finished,
      name: this.nickname,
      skin: this.skinIndex,
    });
  }

  drainEvents() {
    const events = this.world.events;
    if (!events.length) return;
    for (const e of events) {
      switch (e.type) {
        case 'jump': this.audio.play('jump'); break;
        case 'land': if (e.impact > 0.18) this.audio.play('land'); break;
        case 'step': this.audio.play('step'); break;
        case 'shard': this.audio.play('shard', { index: e.index }); break;
        case 'hurt': this.audio.play('hurt'); this.cb.onHurt?.(e.player); break;
        case 'death': this.audio.play('death'); this.cb.onDeath?.(e.player); break;
        case 'stomp': this.audio.play('stomp'); break;
        case 'pad': this.audio.play('pad'); break;
        case 'checkpoint': this.audio.play('checkpoint'); this.cb.onCheckpoint?.(e.player); break;
        case 'goal': this.audio.play('goal'); this.cb.onPlayerFinish?.(e.player, this.levelTime); break;
        default: break;
      }
      if (this.reducedMotion && e.type === 'land') this.world.shake = 0;
    }
    events.length = 0;
  }

  hudData() {
    const p = this.players[0];
    if (!p) return null;
    const net = this.net;
    return {
      hearts: p.hearts,
      shards: p.shards,
      totalShards: this.world.totalShards,
      time: this.levelTime,
      par: this.world.par,
      levelName: this.world.name,
      levelSub: this.world.subtitle,
      players: this.mode === MODE.SOLO ? null : [
        ...this.players.map((pl) => ({ name: pl.name, color: pl.skin.scarf, shards: pl.shards })),
        ...[...this.ghosts.values()].map((g) => ({ name: g.name, color: SKINS[g.skinIndex]?.scarf || '#fff', shards: g.shards })),
      ],
      connection: this.mode === MODE.ONLINE && net ? statusLabel(net.status, net.latency) : null,
    };
  }

  /* ---- Completion -------------------------------------------------------- */

  checkCompletion() {
    if (this.state !== STATE.RUNNING) return;
    const done = this.mode === MODE.LOCAL
      ? this.players.every((p) => p.finished)
      : this.players[0].finished;
    if (!done) return;

    this.state = STATE.COMPLETE;
    this.results = {
      levelId: this.world.id,
      levelName: this.world.name,
      time: this.levelTime,
      par: this.world.par,
      shards: this.players[0].shards,
      totalShards: this.world.totalShards,
      hasNext: this.levelIndex < LEVELS.length - 1,
      mode: this.mode,
    };
    if (this.mode === MODE.ONLINE) {
      this.net?.sendFinish({ time: this.results.time, shards: this.results.shards });
    }
    this.emitState();
    this.cb.onComplete?.(this.results);
  }

  /* ---- Controls ---------------------------------------------------------- */

  pause() {
    if (this.state !== STATE.RUNNING) return;
    this.state = STATE.PAUSED;
    cancelAnimationFrame(this.raf);
    this.keyboard.enabled = false;
    this.emitState();
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.RUNNING;
    this.keyboard.enabled = true;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.emitState();
    this.loop();
  }

  togglePause() {
    if (this.state === STATE.RUNNING) this.pause();
    else if (this.state === STATE.PAUSED) this.resume();
  }

  restart() {
    resetWorldProgress(this.world);
    this.levelTime = 0;
    this.loadLevel(this.levelIndex);
    this.state = STATE.RUNNING;
    this.keyboard.enabled = true;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.emitState();
    this.loop();
  }

  nextLevel() {
    if (this.levelIndex >= LEVELS.length - 1) {
      this.state = STATE.ENDED;
      this.emitState();
      this.cb.onRunComplete?.(this.results);
      return;
    }
    this.loadLevel(this.levelIndex + 1);
    this.state = STATE.RUNNING;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.emitState();
    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.state = STATE.IDLE;
    this.keyboard.enabled = false;
    this.emitState();
  }

  emitState() {
    this.cb.onState?.({
      state: this.state,
      mode: this.mode,
      level: LEVELS[this.levelIndex],
      levelIndex: this.levelIndex,
      net: this.net ? { status: this.net.status, room: this.net.room, you: this.net.you } : null,
    });
  }

  /* ---- Static data used by the page UI ----------------------------------- */

  static get levels() { return LEVELS; }
  static levelById(id) { return LEVELS_BY_ID[id]; }
}

export { LEVELS, VISUAL };

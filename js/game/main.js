/**
 * Aether Drift — page controller.
 *
 * @public — exported so tests can construct it against a DOM of their own;
 * the module also self-boots once when it is loaded on the game page.
 *
 * Wires the DOM overlays (title, modes, lobby, pause, settings, results) to the
 * Game instance. All game logic lives in the modules under js/game/; this file
 * only handles presentation, persistence of settings and the online flow.
 *
 * Deep links supported:
 *   game.html?level=cloudspire      opens straight into a level
 *   game.html?room=ABC123           opens the join flow with a code prefilled
 *   game.html?mode=local            opens the local two-player setup
 */

import { Game, MODE, STATE, LEVELS } from './game.js';
import { MULTIPLAYER } from '../site/config.js';
import { $, $$, esc, escAttr } from '../site/lib/dom.js';
import { store } from '../site/lib/storage.js';

const TINTS = {
  dawn: 'linear-gradient(120deg, #f0a06a, #c96a7a)',
  sky: 'linear-gradient(120deg, #2f8fd0, #8fd4e8)',
  aurora: 'linear-gradient(120deg, #7c5cff, #8affe0)',
};

const SETTINGS_KEY = 'game-settings';

const DEFAULT_SETTINGS = {
  sfx: true,
  sfxVolume: 70,
  music: false,
  musicVolume: 35,
  quality: 'auto',
  touch: null, // null = decide from the device
};

/**
 * Screens that own the whole panel. If the game pauses while one of them is
 * up, the pause overlay must not steal it.
 */
const OVERRIDES_PAUSE = new Set(['settings', 'lobby', 'setup', 'complete', 'run-complete', 'credits']);

export class GamePage {
  constructor() {
    // Capture our document once. Everything below queries through this.q(),
    // so the controller keeps working against the page it was built for.
    this.doc = document;
    this.stage = this.q('[data-game-stage]');
    this.canvas = this.q('[data-game-canvas]');
    this.overlays = new Map();
    this.qa('[data-overlay]').forEach((el) => this.overlays.set(el.dataset.overlay, el));
    this.toast = this.q('[data-toast]');
    this.hudButtons = this.q('[data-hud-buttons]');
    this.touchRoot = this.q('[data-touch-root]');
    this.pendingMode = null;
    this.toastTimer = 0;

    this.settings = { ...DEFAULT_SETTINGS, ...(store.get(SETTINGS_KEY, {}) || {}) };

    this.game = new Game({
      canvas: this.canvas,
      serverUrl: MULTIPLAYER.serverUrl,
      callbacks: {
        onState: (s) => this.onGameState(s),
        onComplete: (r) => this.onComplete(r),
        onRunComplete: () => this.show('run-complete'),
        onError: (message) => this.showToast(message, 'error', 7000),
        onRoom: (room) => this.onRoomUpdate(room),
        onRoomStart: () => this.onMatchStart(),
        onPeerFinish: (msg) => this.showToast(`${msg.name || 'Your opponent'} finished in ${msg.time?.toFixed(1)}s`, 'info', 4000),
      },
    });

    this.bindActions();
    this.buildLevelCards();
    this.applySettings();
    this.writeServerNotice();
    this.handleDeepLink();
    if (!this.deepLinked) this.show('title');
  }

  /**
   * Queries this page's own document rather than the global one. Equivalent in
   * production (there is one document) but it means the controller cannot be
   * confused by another document becoming current — which is exactly what the
   * tests do when they run two game pages side by side.
   */
/**
 * Screens that own the whole panel. If the game pauses while one of them is
 * up, the pause overlay must not steal it.
 */
  q(sel) { return $(sel, this.doc); }
  qa(sel) { return $$(sel, this.doc); }

  /* ---- Overlays --------------------------------------------------------- */

  show(name) {
    this.overlays.forEach((el, key) => { el.hidden = key !== name; });
    this.current = name;
    // Keep keyboard focus inside the visible overlay.
    const focusable = this.overlays.get(name)?.querySelector('button, input, select, a');
    if (name !== 'none') focusable?.focus?.({ preventScroll: true });
  }

  hideAll() {
    this.overlays.forEach((el) => { el.hidden = true; });
    this.current = null;
  }

  showToast(message, kind = 'info', duration = 4200) {
    if (!this.toast) return;
    this.toast.textContent = message;
    this.toast.className = `game-toast is-visible${kind === 'info' ? '' : ` game-toast--${kind}`}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('is-visible'), duration);
  }

  /* ---- Settings --------------------------------------------------------- */

  applySettings() {
    const s = this.settings;
    this.game.audio.setSfxEnabled(s.sfx);
    this.game.audio.setSfxVolume(s.sfxVolume / 100);
    this.game.audio.setMusicEnabled(s.music);
    this.game.audio.setMusicVolume(s.musicVolume / 100);
    this.game.quality = s.quality === 'auto' ? this.game.quality : s.quality;
    this.game.renderer.setQuality(s.quality === 'auto' ? this.game.quality : s.quality);

    const wantsTouch = s.touch === null
      ? window.matchMedia('(pointer: coarse)').matches
      : Boolean(s.touch);
    this.touchRoot?.classList.toggle('is-visible', wantsTouch);
    this.touchRoot?.setAttribute('aria-hidden', String(!wantsTouch));

    this.qa('[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = Boolean(s[key]);
      else if (input.type === 'range') input.value = String(s[key]);
      else input.value = String(s[key]);
    });
  }

  saveSettings() {
    store.set(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  /* ---- Level cards ------------------------------------------------------- */

  buildLevelCards() {
    const grid = this.q('[data-level-grid]');
    if (!grid) return;
    grid.innerHTML = LEVELS.map((level, i) => `
      <button class="level-card" type="button" data-level="${escAttr(level.id)}" style="--level-tint:${TINTS[level.biome] || TINTS.dawn}">
        <span class="level-card__num">STAGE ${String(i + 1).padStart(2, '0')}</span>
        <span class="level-card__name">${esc(level.name)}</span>
        <span class="level-card__sub">${esc(level.subtitle)}</span>
        <span class="level-card__meta">PAR ${level.par}s</span>
      </button>`).join('');

    grid.addEventListener('click', (event) => {
      const card = event.target.closest('[data-level]');
      if (!card) return;
      this.startSolo(card.dataset.level);
    });
  }

  /* ---- Actions ------------------------------------------------------------ */

  bindActions() {
    document.addEventListener('click', (event) => {
      const el = event.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;
      this.game.audio.unlock();
      this.game.audio.play(action === 'play-solo' || action === 'play-local' ? 'uiBig' : 'ui');
      this.run(action);
    });

    this.qa('[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      input.addEventListener('change', () => {
        this.settings[key] = input.type === 'checkbox'
          ? input.checked
          : input.type === 'range' ? Number(input.value) : input.value;
        this.applySettings();
        this.saveSettings();
        this.game.audio.play('ui');
      });
    });

    // Keyboard shortcuts that are not game movement keys.
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLElement &&
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
        if (this.game.state === STATE.RUNNING) { event.preventDefault(); this.run('pause'); }
        else if (this.game.state === STATE.PAUSED && this.current === 'pause') {
          event.preventDefault();
          this.run('resume');
        }
      }
    });

    window.addEventListener('resize', () => {
      if (this.game.state === STATE.PAUSED || this.game.state === STATE.IDLE) this.game.render(0);
    });
  }

  async run(action) {
    switch (action) {
      case 'play-solo':
        this.startSolo(LEVELS[0].id);
        break;
      case 'open-modes':
        this.show('modes');
        break;
      case 'open-levels':
        this.show('levels');
        break;
      case 'open-settings':
        this.show('settings');
        break;
      case 'close-settings':
        this.show(this.game.state === STATE.PAUSED ? 'pause' : 'title');
        break;
      case 'open-credits':
        this.show('credits');
        break;
      case 'back-title':
        this.game.stop();
        this.show('title');
        this.hudButtons.hidden = true;
        break;
      case 'back-modes':
        this.show('modes');
        break;
      case 'play-local':
        this.startLocal();
        break;
      case 'host-online':
        this.openSetup('host');
        break;
      case 'join-online':
        this.openSetup('join');
        break;
      case 'confirm-setup':
        await this.confirmSetup();
        break;
      case 'start-match':
        this.game.requestOnlineStart();
        break;
      case 'leave-room':
        this.game.net?.leave();
        this.game.stop();
        this.show('modes');
        this.hudButtons.hidden = true;
        break;
      case 'pause':
        this.game.pause();
        this.show('pause');
        break;
      case 'resume':
        this.hideAll();
        this.game.resume();
        break;
      case 'restart':
        this.hideAll();
        this.game.restart();
        break;
      case 'next-level':
        this.hideAll();
        this.game.nextLevel();
        break;
      case 'quit-to-title':
        this.game.stop();
        this.game.net?.leave();
        this.show('title');
        this.hudButtons.hidden = true;
        break;
      case 'sound':
        this.settings.sfx = !this.settings.sfx;
        this.applySettings();
        this.saveSettings();
        this.showToast(this.settings.sfx ? 'Sound on' : 'Sound muted', 'info', 1800);
        break;
      case 'fullscreen':
        this.toggleFullscreen();
        break;
      default:
        break;
    }
  }

  /* ---- Starting play ------------------------------------------------------ */

  async startSolo(levelId) {
    this.hideAll();
    this.hudButtons.hidden = false;
    const ok = await this.game.start(MODE.SOLO, {
      levelId,
      nickname: this.settings.nickname || 'Player',
    });
    if (!ok) this.show('title');
    this.blurActive();
  }

  async startLocal() {
    this.hideAll();
    this.hudButtons.hidden = false;
    this.showToast('Player one: A / D / Space · Player two: J / L / I', 'info', 5200);
    const ok = await this.game.start(MODE.LOCAL, { levelIndex: 0 });
    if (!ok) this.show('title');
    this.blurActive();
  }

  openSetup(kind) {
    this.pendingMode = kind;
    const heading = this.q('[data-setup-heading]');
    const title = this.q('[data-setup-title]');
    const codeRow = this.q('[data-code-row]');
    const codeInput = this.q('[data-room-code]');
    if (heading) heading.textContent = kind === 'host' ? 'Create a room' : 'Join a room';
    if (title) title.textContent = kind === 'host' ? 'Host an online race' : 'Join an online race';
    if (codeRow) codeRow.hidden = kind !== 'join';
    if (codeInput && kind === 'join') codeInput.value = '';
    this.show('setup');
  }

  async confirmSetup() {
    const nickname = this.q('[data-nickname]')?.value?.trim() || 'Player';
    const skinIndex = Number(this.q('[data-skin]')?.value || 0);
    this.settings.nickname = nickname;
    this.saveSettings();

    if (this.pendingMode === 'host') {
      this.show('lobby');
      this.renderPlayerList([]);
      const ok = await this.game.start(MODE.ONLINE, { nickname, skinIndex, levelIndex: 0 });
      if (!ok) { this.show('modes'); return; }
    } else {
      const code = (this.q('[data-room-code]')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) {
        this.showToast('Enter the six-character room code you were given.', 'warn', 4000);
        return;
      }
      this.show('lobby');
      this.renderPlayerList([]);
      const ok = await this.game.start(MODE.ONLINE, { nickname, skinIndex, roomCode: code });
      if (!ok) { this.show('setup'); return; }
    }
    this.blurActive();
  }

  /* ---- Online -------------------------------------------------------------- */

  onRoomUpdate(room) {
    const out = this.q('[data-room-code-out]');
    const status = this.q('[data-lobby-status]');
    const startBtn = this.doc.querySelector('[data-action="start-match"]');
    const net = this.game.net;

    if (!room) {
      if (out) out.textContent = '------';
      this.renderPlayerList([]);
      if (status) status.textContent = net?.lastError || 'Not connected.';
      if (startBtn) startBtn.disabled = true;
      return;
    }

    if (out) out.textContent = room.code || '------';
    this.renderPlayerList(room.players || [], net?.you);
    const count = (room.players || []).length;
    const isHost = room.host === net?.you;

    if (status) {
      status.textContent = isHost
        ? `You are the host. ${count} player${count === 1 ? '' : 's'} in the room — press Start when you are both ready.`
        : `Waiting for the host to start the match. ${count} player${count === 1 ? '' : 's'} connected.`;
    }
    if (startBtn) {
      startBtn.disabled = !isHost;
      startBtn.textContent = isHost ? 'Start match' : 'Waiting for host';
    }
  }

  renderPlayerList(players, you) {
    const list = this.q('[data-player-list]');
    if (!list) return;
    const colors = ['#00d4ff', '#ff5c7a', '#1dbb88', '#7c5cff'];
    list.innerHTML = players.length
      ? players.map((p, i) => `
          <div class="player-chip">
            <span class="player-chip__dot" style="background:${colors[(p.skin ?? i) % colors.length]}"></span>
            <span>${esc(p.name || 'Guest')}</span>
            ${p.id === you ? '<span class="player-chip__you">YOU</span>' : ''}
          </div>`).join('')
      : '<div class="player-chip"><span style="color:#7f95bd">Connecting…</span></div>';
  }

  onMatchStart() {
    this.hideAll();
    this.hudButtons.hidden = false;
    this.game.beginOnlineMatch();
    this.showToast('Match started — reach the portal first.', 'info', 3200);
  }

  writeServerNotice() {
    const box = this.doc.querySelector('[data-server-notice]');
    const text = this.doc.querySelector('[data-server-notice-text]');
    if (!box || !text) return;

    if (MULTIPLAYER.serverUrl) {
      text.innerHTML = `Online play connects to <code>${esc(MULTIPLAYER.serverUrl)}</code>
        (the bundled site server proxies that path to the room server). If no room server is
        running the game says so plainly and offers local two-player instead — it never
        shows a room that does not exist.`;
      box.hidden = false;
    } else {
      text.innerHTML = `<strong>Online play is not connected in this deployment.</strong>
        Local two-player works right now with no setup. To switch online play on, run the bundled
        WebSocket server (<code>node server/multiplayer-server.js</code>) and set
        <code>MULTIPLAYER.serverUrl</code> in <code>js/site/config.js</code>. Until then the game
        reports the real state instead of pretending to be online.`;
      box.hidden = false;
    }

    this.qa('[data-online-hint]').forEach((el) => {
      el.textContent = MULTIPLAYER.serverUrl ? 'available' : 'needs server';
    });
    const note = this.doc.querySelector('[data-online-note]');
    if (note) {
      note.textContent = MULTIPLAYER.serverUrl
        ? 'Online races sync positions over WebSockets. Latency is shown in the HUD.'
        : 'Online rooms need the multiplayer server. Local two-player on one device always works.';
    }
  }

  /* ---- Game state ---------------------------------------------------------- */

  onGameState(state) {
    if (state.state === STATE.RUNNING) {
      this.hudButtons.hidden = false;
      if (this.current !== 'lobby') this.hideAll();
    }
    // Anything that pauses the game — not just the Escape key — has to show
    // the pause screen. Without this, switching tabs froze the game mid-run
    // with no overlay and no visible way back into it.
    if (state.state === STATE.PAUSED && !OVERRIDES_PAUSE.has(this.current)) {
      this.show('pause');
    }
    if (state.state === STATE.ENDED) {
      this.show('run-complete');
    }
  }

  onComplete(results) {
    const time = this.q('[data-complete-time]');
    const shards = this.q('[data-complete-shards]');
    const note = this.q('[data-complete-note]');
    const title = this.q('[data-complete-title]');
    const next = this.doc.querySelector('[data-action="next-level"]');
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s * 100) % 100)).padStart(2, '0')}`;

    if (time) time.textContent = fmt(results.time);
    if (shards) shards.textContent = `${results.shards}/${results.totalShards}`;
    if (title) title.textContent = results.time <= results.par ? 'Under par. Nicely done.' : 'Stage cleared.';
    if (note) {
      note.textContent = results.hasNext
        ? `${results.levelName} complete in ${fmt(results.time)} (par ${fmt(results.par)}).`
        : `Final stage complete in ${fmt(results.time)}. That is the whole run.`;
    }
    if (next) {
      next.hidden = !results.hasNext;
      next.textContent = results.hasNext ? 'Next level' : 'Play again';
    }
    this.show('complete');
  }

  /* ---- Helpers -------------------------------------------------------------- */

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.stage?.requestFullscreen?.().catch(() => {
        this.showToast('Fullscreen was blocked by the browser.', 'warn', 3000);
      });
    } else {
      document.exitFullscreen?.();
    }
  }

  /** Buttons must not keep focus, or Space would re-trigger them in-game. */
  blurActive() {
    if (this.doc.activeElement instanceof HTMLElement) this.doc.activeElement.blur();
  }

  handleDeepLink() {
    const params = new URLSearchParams(location.search);
    const level = params.get('level');
    const room = params.get('room');
    const mode = params.get('mode');
    this.deepLinked = Boolean(level || room || mode);

    if (level && LEVELS.some((l) => l.id === level)) {
      this.startSolo(level);
      return;
    }
    if (room) {
      this.openSetup('join');
      const input = this.q('[data-room-code]');
      if (input) input.value = room.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return;
    }
    if (mode === 'local') this.startLocal();
  }
}

function boot() {
  if (!$('[data-game-canvas]')) return; // not the game page
  if (window.SYNQ_GAME) return;         // already booted
  try {
    window.SYNQ_GAME = new GamePage();
  } catch (error) {
    console.error('[aether-drift] failed to start', error);
    const toast = $('[data-toast]');
    if (toast) {
      toast.textContent = 'The game could not start in this browser. The rest of the site works normally.';
      toast.className = 'game-toast is-visible game-toast--error';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

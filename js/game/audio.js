/**
 * Aether Drift — audio.
 *
 * Every sound and the whole soundtrack is synthesised with the Web Audio API.
 * There are no audio files to download, nothing to license, and nothing to
 * 404. The context is created lazily on the first user gesture so browsers
 * never block it.
 */

import { clamp } from './utils.js';

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (semitones) => 440 * Math.pow(2, (semitones - 69) / 12);

/** Pentatonic scale degrees used by the arpeggio, per biome mood. */
const SCALES = {
  dawn: [0, 3, 5, 7, 10, 12, 15],
  sky: [0, 2, 4, 7, 9, 12, 14],
  aurora: [0, 2, 3, 7, 8, 12, 15],
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.sfxVolume = 0.7;
    this.musicVolume = 0.35;
    this.sfxEnabled = true;
    this.musicEnabled = false;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.scale = SCALES.dawn;
    this.root = 57; // A3
    this.started = false;
    this.noiseBuffer = null;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxEnabled ? this.sfxVolume : 0;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // A short shared noise buffer for percussion, wind and impacts.
    const len = Math.floor(this.ctx.sampleRate * 0.7);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    this.started = true;
    if (this.musicEnabled) this.startMusic();
  }

  get ready() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  setSfxEnabled(on) {
    this.sfxEnabled = on;
    if (this.sfxBus) this.sfxBus.gain.value = on ? this.sfxVolume : 0;
  }

  setSfxVolume(v) {
    this.sfxVolume = clamp(v, 0, 1);
    if (this.sfxBus && this.sfxEnabled) this.sfxBus.gain.value = this.sfxVolume;
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  setMusicVolume(v) {
    this.musicVolume = clamp(v, 0, 1);
    if (this.musicBus && this.musicEnabled) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.5, this.ctx.currentTime, 0.2);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Synthesis primitives                                              */
  /* ------------------------------------------------------------------ */

  tone({ freq = 440, duration = 0.18, type = 'sine', gain = 0.2, attack = 0.005,
         release = null, sweep = null, bus = null, detune = 0, delay = 0 } = {}) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + duration);

    const rel = release ?? duration;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + rel);

    osc.connect(env).connect(bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + duration + rel + 0.05);
  }

  noise({ duration = 0.14, gain = 0.16, filter = 1400, q = 0.8, sweep = null,
          type = 'lowpass', delay = 0 } = {}) {
    if (!this.ready || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const biq = this.ctx.createBiquadFilter();
    biq.type = type;
    biq.frequency.setValueAtTime(filter, t0);
    biq.Q.value = q;
    if (sweep) biq.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t0 + duration);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(biq).connect(env).connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  /* ------------------------------------------------------------------ */
  /*  Effects                                                           */
  /* ------------------------------------------------------------------ */

  play(name, options = {}) {
    if (!this.ready || !this.sfxEnabled) return;
    switch (name) {
      case 'jump':
        this.tone({ freq: 330, sweep: 620, duration: 0.12, type: 'triangle', gain: 0.16 });
        this.noise({ duration: 0.06, gain: 0.05, filter: 2400, sweep: 900 });
        break;
      case 'land':
        this.noise({ duration: 0.1, gain: 0.13, filter: 800, sweep: 220 });
        this.tone({ freq: 120, sweep: 70, duration: 0.09, type: 'sine', gain: 0.1 });
        break;
      case 'step':
        this.noise({ duration: 0.045, gain: 0.045, filter: 1800, sweep: 900 });
        break;
      case 'shard': {
        const base = 72 + (options.index ?? 0) % 5;
        this.tone({ freq: midi(base + 12), duration: 0.16, type: 'sine', gain: 0.14 });
        this.tone({ freq: midi(base + 19), duration: 0.22, type: 'sine', gain: 0.1, delay: 0.04 });
        break;
      }
      case 'hurt':
        this.tone({ freq: 200, sweep: 70, duration: 0.28, type: 'sawtooth', gain: 0.16 });
        this.noise({ duration: 0.22, gain: 0.14, filter: 900, sweep: 160 });
        break;
      case 'stomp':
        this.tone({ freq: 180, sweep: 420, duration: 0.1, type: 'square', gain: 0.11 });
        this.noise({ duration: 0.08, gain: 0.1, filter: 1200 });
        break;
      case 'pad':
        this.tone({ freq: 240, sweep: 900, duration: 0.26, type: 'triangle', gain: 0.16 });
        this.tone({ freq: 480, sweep: 1400, duration: 0.2, type: 'sine', gain: 0.08, delay: 0.03 });
        break;
      case 'checkpoint':
        [0, 4, 7].forEach((n, i) =>
          this.tone({ freq: midi(69 + n), duration: 0.5, type: 'sine', gain: 0.1, delay: i * 0.07 }));
        break;
      case 'goal':
        [0, 4, 7, 12, 16].forEach((n, i) =>
          this.tone({ freq: midi(65 + n), duration: 0.7, type: 'triangle', gain: 0.12, delay: i * 0.09 }));
        this.noise({ duration: 0.5, gain: 0.06, filter: 3000, sweep: 800, delay: 0.02 });
        break;
      case 'death':
        this.tone({ freq: 300, sweep: 60, duration: 0.6, type: 'sawtooth', gain: 0.14 });
        break;
      case 'ui':
        this.tone({ freq: 660, duration: 0.06, type: 'square', gain: 0.05 });
        break;
      case 'uiBig':
        this.tone({ freq: 440, sweep: 880, duration: 0.14, type: 'triangle', gain: 0.09 });
        break;
      case 'join':
        [0, 5, 9].forEach((n, i) =>
          this.tone({ freq: midi(64 + n), duration: 0.3, type: 'sine', gain: 0.1, delay: i * 0.06 }));
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Music — a slow generative loop, scheduled a bar at a time         */
  /* ------------------------------------------------------------------ */

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.5, this.ctx.currentTime, 0.6);
    this.musicStep = 0;
    this.musicTimer = setInterval(() => this.tickMusic(), 460);
    this.tickMusic();
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    }
  }

  setBiome(biome) {
    this.scale = SCALES[biome] || SCALES.dawn;
    this.root = biome === 'aurora' ? 53 : biome === 'sky' ? 60 : 57;
  }

  tickMusic() {
    if (!this.ready || !this.musicEnabled) return;
    const step = this.musicStep;
    const degree = this.scale[(step * 3) % this.scale.length];
    const octave = step % 8 < 4 ? 0 : 12;

    // Sustained pad on the downbeat of every other bar.
    if (step % 8 === 0) {
      this.tone({
        freq: midi(this.root + this.scale[0] - 12),
        duration: 2.6, type: 'sine', gain: 0.1, attack: 0.5, release: 1.2, bus: this.musicBus,
      });
      this.tone({
        freq: midi(this.root + this.scale[2] - 12),
        duration: 2.6, type: 'sine', gain: 0.06, attack: 0.7, release: 1.2,
        bus: this.musicBus, detune: 6,
      });
    }

    // Arpeggio.
    if (step % 2 === 0) {
      this.tone({
        freq: midi(this.root + degree + octave),
        duration: 0.42, type: 'triangle', gain: 0.07, attack: 0.02, release: 0.4,
        bus: this.musicBus,
      });
    }

    // Soft pulse.
    if (step % 4 === 2) {
      this.tone({
        freq: midi(this.root - 24), duration: 0.16, type: 'sine', gain: 0.09,
        bus: this.musicBus,
      });
    }

    this.musicStep = (step + 1) % 32;
  }

  dispose() {
    this.stopMusic();
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}

/**
 * Aether Drift — rendering.
 *
 * All art is drawn procedurally from the biome palette: nothing is loaded, so
 * there are no asset requests, no licensing questions and no missing-image
 * states. Parallax layers are baked once into offscreen canvases and then
 * blitted, which keeps the per-frame cost flat regardless of level size.
 */

import { TILE, BIOMES, VISUAL, PLAYER } from './constants.js';
import { T_SOLID, T_ONEWAY, T_HAZARD, tileAt } from './world.js';
import { clamp, damp, makeRng, hashString, roundRect, TAU, formatTime } from './utils.js';

/* -------------------------------------------------------------------------- */
/*  Camera                                                                     */
/* -------------------------------------------------------------------------- */

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.lookAhead = 0;
    this.shakeX = 0; this.shakeY = 0;
  }

  snapTo(target, world, viewW, viewH) {
    this.update([target], world, viewW, viewH, 1, true);
  }

  /** `targets` is one player in solo, or every local player in co-op. */
  update(targets, world, viewW, viewH, dt, instant = false) {
    const alive = targets.filter(Boolean);
    if (!alive.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of alive) {
      minX = Math.min(minX, t.renderX ?? t.x);
      maxX = Math.max(maxX, (t.renderX ?? t.x) + t.w);
      minY = Math.min(minY, t.renderY ?? t.y);
      maxY = Math.max(maxY, (t.renderY ?? t.y) + t.h);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = maxX - minX;
    const spanY = maxY - minY;

    // Zoom out far enough to keep every player comfortably in frame.
    const fit = Math.min(
      viewW / (spanX + VISUAL_SAFE_PAD * 2),
      viewH / (spanY + VISUAL_SAFE_PAD * 1.6)
    );
    this.targetZoom = clamp(fit, 0.55, 1.05);
    this.zoom = instant ? this.targetZoom : damp(this.zoom, this.targetZoom, 3.2, dt);

    const viewWorldW = viewW / this.zoom;
    const viewWorldH = viewH / this.zoom;

    const desiredX = cx - viewWorldW / 2;
    // Bias the frame slightly downward so the player sits above centre and
    // more of the level ahead is visible.
    const desiredY = cy - viewWorldH / 2 + 30;

    if (instant) {
      this.x = desiredX;
      this.y = desiredY;
    } else {
      this.x = damp(this.x, desiredX, 7.5, dt);
      this.y = damp(this.y, desiredY, 6, dt);
    }

    this.x = world.widthPx <= viewWorldW
      ? (world.widthPx - viewWorldW) / 2
      : clamp(this.x, 0, world.widthPx - viewWorldW);
    this.y = world.heightPx <= viewWorldH
      ? (world.heightPx - viewWorldH) / 2
      : clamp(this.y, -40, world.heightPx - viewWorldH);

    const shake = world.shake || 0;
    this.shakeX = shake ? (Math.random() - 0.5) * shake : 0;
    this.shakeY = shake ? (Math.random() - 0.5) * shake : 0;
  }

  apply(ctx) {
    ctx.translate(this.shakeX, this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  get viewLeft() { return this.x; }
}

const VISUAL_SAFE_PAD = 120;

/* -------------------------------------------------------------------------- */
/*  Parallax background                                                        */
/* -------------------------------------------------------------------------- */

function buildLayer(seed, w, h, color, kind, accent) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.fillStyle = color;

  if (kind === 'mountains') {
    g.beginPath();
    g.moveTo(0, h);
    let x = 0;
    let y = h * (0.45 + rng() * 0.2);
    while (x < w) {
      const peakW = 90 + rng() * 220;
      const peakH = h * (0.22 + rng() * 0.4);
      g.lineTo(x + peakW / 2, y - peakH);
      g.lineTo(x + peakW, y + (rng() - 0.5) * h * 0.12);
      x += peakW;
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  } else if (kind === 'spires') {
    for (let i = 0; i < Math.floor(w / 150); i += 1) {
      const sx = rng() * w;
      const sw = 22 + rng() * 44;
      const sh = h * (0.28 + rng() * 0.55);
      g.beginPath();
      g.moveTo(sx, h);
      g.lineTo(sx + sw / 2, h - sh);
      g.lineTo(sx + sw, h);
      g.closePath();
      g.fill();
    }
  } else if (kind === 'arches') {
    for (let i = 0; i < Math.floor(w / 260); i += 1) {
      const sx = rng() * w;
      const sw = 120 + rng() * 160;
      const sh = h * (0.3 + rng() * 0.4);
      g.beginPath();
      g.moveTo(sx, h);
      g.lineTo(sx, h - sh * 0.55);
      g.quadraticCurveTo(sx + sw / 2, h - sh * 1.35, sx + sw, h - sh * 0.55);
      g.lineTo(sx + sw, h);
      g.closePath();
      g.fill();
    }
  }

  // A faint rim light on the upper edges sells the depth.
  g.globalCompositeOperation = 'source-atop';
  const rim = g.createLinearGradient(0, 0, 0, h);
  rim.addColorStop(0, accent);
  rim.addColorStop(0.35, 'rgba(255,255,255,0)');
  g.fillStyle = rim;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  return c;
}

const LAYER_SPECS = [
  { factor: 0.12, kind: 'mountains', alpha: 0.55, y: 0.16, colorIndex: 0 },
  { factor: 0.26, kind: 'mountains', alpha: 0.7, y: 0.3, colorIndex: 1 },
  { factor: 0.46, kind: 'spires', alpha: 0.85, y: 0.44, colorIndex: 2 },
  { factor: 0.68, kind: 'arches', alpha: 0.9, y: 0.6, colorIndex: 2 },
];

/* -------------------------------------------------------------------------- */
/*  Renderer                                                                   */
/* -------------------------------------------------------------------------- */

export class WorldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.viewW = 960;
    this.viewH = 540;
    this.world = null;
    this.layers = [];
    this.ambient = [];
    this.skyGradient = null;
    this.skyKey = '';
    this.quality = 1;
    this.time = 0;
  }

  setQuality(tier) {
    this.quality = tier === 'low' ? 0.45 : tier === 'mid' ? 0.75 : 1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.round(rect.width));
    const cssH = Math.max(200, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.viewW = cssW;
    this.viewH = cssH;
    this.skyKey = '';
    if (this.world) this.buildBackground();
  }

  setWorld(world) {
    this.world = world;
    this.buildBackground();
  }

  buildBackground() {
    const world = this.world;
    if (!world) return;
    const biome = BIOMES[world.biome] || BIOMES.dawn;
    const seed = hashString(world.id);
    const h = Math.max(220, Math.round(this.viewH * 0.95));
    this.layers = LAYER_SPECS.map((spec, i) => {
      const stripW = Math.max(1400, Math.round(this.viewW * 1.6));
      return {
        ...spec,
        canvas: buildLayer(seed + i * 977, stripW, h,
          biome.layers[Math.min(spec.colorIndex, biome.layers.length - 1)],
          spec.kind, 'rgba(255,255,255,0.09)'),
      };
    });

    const rng = makeRng(seed + 31);
    const count = Math.round(VISUAL.AMBIENT_PARTICLES * this.quality);
    this.ambient = Array.from({ length: count }, () => ({
      x: rng() * this.viewW,
      y: rng() * this.viewH,
      r: 0.7 + rng() * 1.9,
      speed: 6 + rng() * 26,
      drift: (rng() - 0.5) * 18,
      alpha: 0.16 + rng() * 0.4,
      phase: rng() * TAU,
    }));
  }

  /* ---- Frame ---------------------------------------------------------- */

  draw(state) {
    const { camera, players, alpha, dt, showHud, hud } = state;
    const ctx = this.ctx;
    const world = this.world;
    if (!world) return;

    this.time += dt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    this.drawSky(ctx);
    this.drawParallax(ctx, camera);
    this.drawWeather(ctx, camera);

    ctx.save();
    camera.apply(ctx);
    const view = {
      x0: camera.x - 40,
      x1: camera.x + this.viewW / camera.zoom + 40,
      y0: camera.y - 40,
      y1: camera.y + this.viewH / camera.zoom + 60,
    };
    this.drawTiles(ctx, view);
    this.drawPads(ctx);
    this.drawMovers(ctx);
    this.drawGoal(ctx);
    this.drawCheckpoints(ctx);
    this.drawShards(ctx);
    this.drawEnemies(ctx);
    this.drawParticles(ctx);
    for (const p of players) this.drawPlayer(ctx, p);
    this.drawLighting(ctx, players);
    ctx.restore();

    this.drawAmbient(ctx);
    this.drawVignette(ctx);
    if (showHud) this.drawHud(ctx, hud);
  }

  /* ---- Background ------------------------------------------------------ */

  drawSky(ctx) {
    const biome = BIOMES[this.world.biome] || BIOMES.dawn;
    const key = `${this.world.biome}:${this.viewW}x${this.viewH}`;
    if (this.skyKey !== key) {
      const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
      biome.sky.forEach((c, i) => g.addColorStop(i / (biome.sky.length - 1), c));
      this.skyGradient = g;
      this.skyKey = key;
    }
    ctx.fillStyle = this.skyGradient;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Celestial body with a soft halo.
    const s = biome.sun;
    const cx = this.viewW * s.x;
    const cy = this.viewH * s.y;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, s.r * 4.2);
    halo.addColorStop(0, withAlpha(s.glow, 0.4));
    halo.addColorStop(0.35, withAlpha(s.glow, 0.12));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.beginPath();
    ctx.arc(cx, cy, s.r * 0.42, 0, TAU);
    ctx.fillStyle = withAlpha(s.color, 0.92);
    ctx.fill();
  }

  drawParallax(ctx, camera) {
    for (const layer of this.layers) {
      const w = layer.canvas.width;
      const h = layer.canvas.height;
      const y = this.viewH - h + (this.viewH * layer.y) * 0.18;
      let offset = -(camera.x * layer.factor) % w;
      if (offset > 0) offset -= w;
      ctx.globalAlpha = layer.alpha;
      for (let x = offset; x < this.viewW; x += w) {
        ctx.drawImage(layer.canvas, x, y, w, h);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawWeather(ctx, camera) {
    const biome = BIOMES[this.world.biome] || BIOMES.dawn;
    const t = this.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (biome.weather === 'aurora') {
      for (let i = 0; i < 3; i += 1) {
        const y = this.viewH * (0.12 + i * 0.09);
        const shift = -(camera.x * 0.06) + t * (8 + i * 5);
        ctx.beginPath();
        for (let x = 0; x <= this.viewW; x += 12) {
          const yy = y
            + Math.sin((x + shift) * 0.006 + i) * 26
            + Math.sin((x + shift) * 0.013 + i * 2) * 12;
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.strokeStyle = i % 2 ? 'rgba(124,92,255,0.20)' : 'rgba(138,255,224,0.16)';
        ctx.lineWidth = 26 + i * 10;
        ctx.filter = 'blur(14px)';
        ctx.stroke();
        ctx.filter = 'none';
      }
    } else if (biome.weather === 'clouds') {
      const shift = -(camera.x * 0.1);
      for (let i = 0; i < 5; i += 1) {
        const x = ((shift + i * 420 + t * 9) % (this.viewW + 600)) - 300;
        const y = this.viewH * (0.16 + (i % 3) * 0.13);
        const g = ctx.createRadialGradient(x, y, 0, x, y, 150);
        g.addColorStop(0, 'rgba(255,255,255,0.13)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, 190, 52, 0, 0, TAU);
        ctx.fill();
      }
    } else {
      const shift = -(camera.x * 0.08);
      ctx.fillStyle = 'rgba(255,214,170,0.5)';
      for (let i = 0; i < 26; i += 1) {
        const x = ((shift * 1.4 + i * 97 + Math.sin(t * 0.6 + i) * 40) % (this.viewW + 80)) - 40;
        const y = (i * 53 + t * 26 + Math.cos(t + i) * 30) % this.viewH;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.ellipse(x, y, 3.4, 1.8, Math.sin(t + i) * 0.8, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---- World ----------------------------------------------------------- */

  drawTiles(ctx, view) {
    const world = this.world;
    const biome = BIOMES[world.biome] || BIOMES.dawn;
    const x0 = Math.max(0, Math.floor(view.x0 / TILE));
    const x1 = Math.min(world.w - 1, Math.ceil(view.x1 / TILE));
    const y0 = Math.max(0, Math.floor(view.y0 / TILE));
    const y1 = Math.min(world.h - 1, Math.ceil(view.y1 / TILE));

    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        const t = tileAt(world, tx, ty);
        if (t === 0) continue;
        const px = tx * TILE;
        const py = ty * TILE;

        if (t === T_HAZARD) { this.drawSpikes(ctx, px, py, biome); continue; }

        if (t === T_ONEWAY) {
          ctx.fillStyle = biome.ground.edge;
          roundRect(ctx, px, py, TILE, 9, 3);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          ctx.fillRect(px + 2, py + 1, TILE - 4, 2);
          continue;
        }

        // Solid: skip tiles fully enclosed by other solids.
        const openAbove = tileAt(world, tx, ty - 1) !== T_SOLID;
        const openLeft = tileAt(world, tx - 1, ty) !== T_SOLID;
        const openRight = tileAt(world, tx + 1, ty) !== T_SOLID;

        const g = ctx.createLinearGradient(px, py, px, py + TILE);
        g.addColorStop(0, biome.ground.body);
        g.addColorStop(1, shade(biome.ground.body, -0.28));
        ctx.fillStyle = g;
        ctx.fillRect(px, py, TILE, TILE);

        if (openAbove) {
          ctx.fillStyle = biome.ground.top;
          ctx.fillRect(px, py, TILE, 7);
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.fillRect(px, py, TILE, 2);
          // Tufts / crystals on exposed tops.
          const n = ((tx * 37 + ty * 11) % 5);
          ctx.strokeStyle = withAlpha(biome.crystal, 0.5);
          ctx.lineWidth = 1.4;
          for (let i = 0; i < n; i += 1) {
            const gx = px + 5 + ((tx * 13 + i * 7) % (TILE - 10));
            ctx.beginPath();
            ctx.moveTo(gx, py + 1);
            ctx.lineTo(gx + (i % 2 ? 2 : -2), py - 5 - (i % 3) * 2);
            ctx.stroke();
          }
        }
        if (openLeft) { ctx.fillStyle = withAlpha(biome.ground.edge, 0.5); ctx.fillRect(px, py, 2, TILE); }
        if (openRight) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(px + TILE - 2, py, 2, TILE); }
      }
    }
  }

  drawSpikes(ctx, px, py, biome) {
    ctx.save();
    ctx.fillStyle = '#c9d4e6';
    ctx.strokeStyle = withAlpha(biome.accent, 0.8);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i += 1) {
      const bx = px + i * (TILE / 3);
      ctx.beginPath();
      ctx.moveTo(bx, py + TILE);
      ctx.lineTo(bx + TILE / 6, py + 6);
      ctx.lineTo(bx + TILE / 3, py + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMovers(ctx) {
    const world = this.world;
    for (const m of world.movers) {
      const g = ctx.createLinearGradient(m.x, m.y, m.x, m.y + m.h);
      g.addColorStop(0, '#3c4a6b');
      g.addColorStop(1, '#1b2338');
      ctx.fillStyle = g;
      roundRect(ctx, m.x, m.y, m.w, m.h, 5);
      ctx.fill();
      ctx.fillStyle = withAlpha(world.biome ? (BIOMES[world.biome] || BIOMES.dawn).crystal : '#8affe0', 0.85);
      ctx.fillRect(m.x + 3, m.y + 1, m.w - 6, 2.5);
      // Motion rail hint
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.axis === 'x') {
        ctx.moveTo(m.originX + 8, m.y + m.h / 2);
        ctx.lineTo(m.originX + m.dist + m.w - 8, m.y + m.h / 2);
      } else {
        ctx.moveTo(m.x + m.w / 2, m.originY);
        ctx.lineTo(m.x + m.w / 2, m.originY + m.dist);
      }
      ctx.stroke();
    }
  }

  drawPads(ctx) {
    for (const pad of this.world.pads) {
      const charge = clamp(pad.charge, 0, 1);
      const px = pad.x + pad.w / 2;
      const py = pad.y + pad.h / 2;
      ctx.save();
      ctx.strokeStyle = '#8affe0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= 14; i += 1) {
        const t = i / 14;
        const x = pad.x + 5 + t * (pad.w - 10);
        const y = py + 4 - Math.sin(t * Math.PI * 3) * (3 + charge * 4);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const g = ctx.createRadialGradient(px, py, 0, px, py, 26 + charge * 20);
      g.addColorStop(0, `rgba(138,255,224,${0.28 + charge * 0.4})`);
      g.addColorStop(1, 'rgba(138,255,224,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, 30 + charge * 20, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawShards(ctx) {
    for (const s of this.world.shards) {
      if (s.taken) continue;
      const bob = Math.sin(this.time * 2.4 + s.phase) * 3;
      const spin = this.time * 2 + s.phase;
      const y = s.y + bob;
      ctx.save();
      ctx.translate(s.x, y);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
      g.addColorStop(0, 'rgba(255,230,163,0.5)');
      g.addColorStop(1, 'rgba(255,230,163,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();

      ctx.rotate(spin);
      ctx.fillStyle = '#ffe6a3';
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(6, 0); ctx.lineTo(0, 9); ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(6, 0); ctx.lineTo(0, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawCheckpoints(ctx) {
    for (const c of this.world.checkpoints) {
      const x = c.x + TILE / 2;
      const baseY = c.y + TILE;
      ctx.save();
      ctx.strokeStyle = '#6b7a99';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, baseY - 46);
      ctx.stroke();

      const flameY = baseY - 48 + (c.active ? Math.sin(this.time * 4) * 1.6 : 0);
      if (c.active) {
        const g = ctx.createRadialGradient(x, flameY, 0, x, flameY, 34);
        g.addColorStop(0, 'rgba(138,255,224,0.55)');
        g.addColorStop(1, 'rgba(138,255,224,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, flameY, 34, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = c.active ? '#8affe0' : '#3d4a63';
      ctx.beginPath();
      ctx.arc(x, flameY, 6.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawGoal(ctx) {
    const goal = this.world.goal;
    if (!goal) return;
    const cx = goal.x + goal.w / 2;
    const cy = goal.y + goal.h / 2;
    ctx.save();
    for (let i = 0; i < 4; i += 1) {
      const t = (this.time * 0.7 + i * 0.25) % 1;
      const r = 12 + t * 44;
      ctx.strokeStyle = `rgba(138,255,224,${(1 - t) * 0.55})`;
      ctx.lineWidth = 3 - t * 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.6, r, 0, 0, TAU);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    g.addColorStop(0, 'rgba(138,255,224,0.5)');
    g.addColorStop(0.5, 'rgba(11,95,255,0.22)');
    g.addColorStop(1, 'rgba(11,95,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 60, 0, TAU); ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 8, 22, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawEnemies(ctx) {
    for (const e of this.world.enemies) {
      if (e.dead) continue;
      if (e.type === 'walker') {
        const wob = Math.sin(e.anim * 8) * 1.8;
        ctx.save();
        ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(0, e.h / 2 + 2, e.w * 0.42, 3.5, 0, 0, TAU); ctx.fill();
        const g = ctx.createLinearGradient(0, -e.h / 2, 0, e.h / 2);
        g.addColorStop(0, '#7a4d6b');
        g.addColorStop(1, '#3d2233');
        ctx.fillStyle = g;
        roundRect(ctx, -e.w / 2, -e.h / 2 + wob, e.w, e.h - wob, 9);
        ctx.fill();
        // eyes
        ctx.fillStyle = '#ffd27a';
        const dir = e.vx > 0 ? 1 : -1;
        ctx.beginPath(); ctx.arc(dir * 4 - 3, -2 + wob, 2.1, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(dir * 4 + 4, -2 + wob, 2.1, 0, TAU); ctx.fill();
        // feet
        ctx.strokeStyle = '#2b1725';
        ctx.lineWidth = 2.4;
        for (let i = -1; i <= 1; i += 2) {
          ctx.beginPath();
          ctx.moveTo(i * 6, e.h / 2 - 2);
          ctx.lineTo(i * 6 + Math.sin(e.anim * 12 + i) * 4, e.h / 2 + 3);
          ctx.stroke();
        }
        ctx.restore();
      } else if (e.type === 'drone') {
        const cx = e.x + e.w / 2;
        const cy = e.y + e.h / 2;
        ctx.save();
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
        g.addColorStop(0, 'rgba(255,158,196,0.55)');
        g.addColorStop(1, 'rgba(255,158,196,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, 26, 0, TAU); ctx.fill();

        ctx.fillStyle = '#ff9ec4';
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 15, 5, e.anim * 2, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = '#3a1024';
        ctx.beginPath(); ctx.arc(cx, cy - 1, 3.4, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
  }

  drawParticles(ctx) {
    for (const p of this.world.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1) * p.alpha;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.8), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- Player ---------------------------------------------------------- */

  drawPlayer(ctx, p) {
    if (p.dead) return;
    const x = p.renderX ?? p.x;
    const y = p.renderY ?? p.y;
    const cx = x + p.w / 2;
    const skin = p.skin;
    const state = p.anim.state;
    const t = p.anim.time;

    ctx.save();
    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(cx, y + p.h + 2, p.w * 0.5, 3.6, 0, 0, TAU);
    ctx.fill();

    // Scarf trail
    ctx.strokeStyle = withAlpha(skin.scarf, p.invuln > 0 && Math.floor(p.invuln * 14) % 2 ? 0.25 : 0.9);
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - p.facing * 5, y + 7);
    p.scarf.forEach((n) => ctx.lineTo(n.x, n.y));
    ctx.stroke();

    // Squash & stretch
    let sx = 1;
    let sy = 1;
    if (state === 'jump') { sx = 0.86; sy = 1.16; }
    else if (state === 'fall') { sx = 0.94; sy = 1.08; }
    else if (p.anim.land > 0) {
      const k = p.anim.land / 0.22;
      sx = 1 + k * 0.24; sy = 1 - k * 0.22;
    } else if (state === 'run') {
      const b = Math.sin(p.anim.run * 2) * 0.03;
      sx = 1 - b; sy = 1 + b;
    }

    ctx.translate(cx, y + p.h);
    ctx.scale(p.facing * sx, sy);
    ctx.translate(-p.w / 2, -p.h);

    const bodyW = p.w;
    const bodyH = p.h;

    // Cloak
    ctx.fillStyle = skin.cloak;
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.5, 2);
    ctx.quadraticCurveTo(bodyW + 5, bodyH * 0.5, bodyW * 0.86, bodyH);
    ctx.lineTo(bodyW * 0.14, bodyH);
    ctx.quadraticCurveTo(-5, bodyH * 0.5, bodyW * 0.5, 2);
    ctx.fill();

    // Body
    ctx.fillStyle = skin.body;
    roundRect(ctx, bodyW * 0.16, bodyH * 0.3, bodyW * 0.68, bodyH * 0.62, 6);
    ctx.fill();

    // Legs
    ctx.strokeStyle = skin.body;
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    const legPhase = state === 'run' ? Math.sin(p.anim.run * 2.2) : state === 'jump' ? -0.5 : 0;
    for (const side of [-1, 1]) {
      const swing = side * legPhase * 5;
      ctx.beginPath();
      ctx.moveTo(bodyW * 0.5 + side * 3, bodyH * 0.82);
      ctx.lineTo(bodyW * 0.5 + side * 3 + swing, bodyH - (state === 'run' ? Math.max(0, -legPhase * side * 3) : 0));
      ctx.stroke();
    }

    // Head + hood
    ctx.fillStyle = skin.body;
    ctx.beginPath(); ctx.arc(bodyW * 0.52, bodyH * 0.24, 7.6, 0, TAU); ctx.fill();
    ctx.fillStyle = skin.cloak;
    ctx.beginPath();
    ctx.arc(bodyW * 0.52, bodyH * 0.24, 8.4, Math.PI * 1.05, Math.PI * 2.25);
    ctx.fill();

    // Visor + eyes
    ctx.fillStyle = 'rgba(6,10,22,0.9)';
    roundRect(ctx, bodyW * 0.4, bodyH * 0.2, bodyW * 0.42, 5.4, 2.6);
    ctx.fill();
    ctx.fillStyle = skin.trim;
    ctx.beginPath(); ctx.arc(bodyW * 0.66, bodyH * 0.235, 1.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(bodyW * 0.5, bodyH * 0.235, 1.4, 0, TAU); ctx.fill();

    // Lantern
    const lanternY = bodyH * 0.55;
    ctx.fillStyle = skin.lantern;
    ctx.beginPath(); ctx.arc(bodyW * 0.05, lanternY, 3.4, 0, TAU); ctx.fill();
    ctx.restore();

    // Hurt flash
    if (p.hurtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.6, p.hurtFlash * 1.6);
      ctx.fillStyle = '#ff5c7a';
      roundRect(ctx, x - 2, y - 2, p.w + 4, p.h + 4, 8);
      ctx.fill();
      ctx.restore();
    }
  }

  drawLighting(ctx, players) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of players) {
      if (p.dead) continue;
      const cx = (p.renderX ?? p.x) + p.w / 2;
      const cy = (p.renderY ?? p.y) + p.h / 2;
      const r = 132;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, withAlpha(p.skin.lantern, 0.22));
      g.addColorStop(0.4, withAlpha(p.skin.lantern, 0.08));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ---- Post ------------------------------------------------------------- */

  drawAmbient(ctx) {
    const dt = 1 / 60;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (const a of this.ambient) {
      a.y -= a.speed * dt * 0.6;
      a.x += Math.sin(this.time * 0.5 + a.phase) * a.drift * dt;
      if (a.y < -6) { a.y = this.viewH + 6; a.x = Math.random() * this.viewW; }
      if (a.x < -6) a.x = this.viewW + 6;
      if (a.x > this.viewW + 6) a.x = -6;
      ctx.globalAlpha = a.alpha * 0.5;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.34,
      this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(3,6,16,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const biome = BIOMES[this.world.biome] || BIOMES.dawn;
    ctx.fillStyle = biome.fog;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  /* ---- HUD -------------------------------------------------------------- */

  drawHud(ctx, hud) {
    if (!hud) return;
    const pad = 16;
    ctx.save();
    ctx.font = '700 13px Manrope, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // Panel behind the stats
    ctx.fillStyle = 'rgba(6,12,26,0.42)';
    roundRect(ctx, pad - 6, pad - 6, 210, 78, 12);
    ctx.fill();

    // Hearts
    for (let i = 0; i < PLAYER.MAX_HEARTS; i += 1) {
      const filled = i < hud.hearts;
      const hx = pad + 6 + i * 20;
      const hy = pad + 10;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.scale(0.9, 0.9);
      ctx.fillStyle = filled ? '#ff5c7a' : 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.bezierCurveTo(-9, -4, -5, -11, 0, -6);
      ctx.bezierCurveTo(5, -11, 9, -4, 0, 4);
      ctx.fill();
      ctx.restore();
    }

    // Shards
    ctx.fillStyle = '#ffe6a3';
    ctx.beginPath();
    ctx.moveTo(pad + 6 + 8, pad + 34);
    ctx.lineTo(pad + 6 + 13, pad + 41);
    ctx.lineTo(pad + 6 + 8, pad + 48);
    ctx.lineTo(pad + 6 + 3, pad + 41);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#eaf1ff';
    ctx.fillText(`${hud.shards} / ${hud.totalShards}`, pad + 28, pad + 42);

    // Timer
    ctx.fillStyle = '#eaf1ff';
    ctx.font = '700 15px "DM Mono", monospace';
    ctx.fillText(formatTime(hud.time), pad + 6, pad + 62);
    ctx.font = '500 10px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(234,241,255,0.6)';
    ctx.fillText(`PAR ${formatTime(hud.par)}`, pad + 92, pad + 62);

    // Level name, top-right
    ctx.textAlign = 'right';
    ctx.font = '800 13px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#eaf1ff';
    ctx.fillText(hud.levelName, this.viewW - pad, pad + 8);
    ctx.font = '500 10px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(234,241,255,0.62)';
    ctx.fillText(hud.levelSub.toUpperCase(), this.viewW - pad, pad + 25);
    if (hud.players) {
      hud.players.forEach((pl, i) => {
        ctx.fillStyle = pl.color;
        ctx.fillText(`${pl.name}${pl.shards !== undefined ? ` · ${pl.shards}` : ''}`,
          this.viewW - pad, pad + 46 + i * 16);
      });
    }

    // Connection badge
    if (hud.connection) {
      const badge = hud.connection;
      ctx.font = '600 10px "DM Mono", monospace';
      const w = ctx.measureText(badge.text).width + 24;
      ctx.fillStyle = badge.ok ? 'rgba(29,187,136,0.18)' : 'rgba(229,72,77,0.2)';
      roundRect(ctx, this.viewW - pad - w, this.viewH - pad - 22, w, 22, 11);
      ctx.fill();
      ctx.fillStyle = badge.ok ? '#8affe0' : '#ff9ec4';
      ctx.beginPath();
      ctx.arc(this.viewW - pad - w + 12, this.viewH - pad - 11, 4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = badge.ok ? '#cfffe9' : '#ffd7e4';
      ctx.fillText(badge.text, this.viewW - pad - 8, this.viewH - pad - 10);
    }

    ctx.restore();
  }
}

/* -------------------------------------------------------------------------- */
/*  Colour helpers                                                             */
/* -------------------------------------------------------------------------- */

function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shade(hex, amount) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const parts = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16);
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.round(clamp(out, 0, 255));
  });
  return `rgb(${parts.join(', ')})`;
}

export { withAlpha, shade };

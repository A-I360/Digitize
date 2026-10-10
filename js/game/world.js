/**
 * Aether Drift — simulation.
 *
 * Pure-ish game state: level parsing, collision, movement, enemies, triggers
 * and particles. It knows nothing about canvases, DOM or sound — everything
 * observable is reported through the `events` array the caller drains each
 * step, which keeps rendering and audio completely decoupled.
 */

import { PHYSICS, PLAYER, ENEMY, WORLD, VISUAL, TILE, SKINS } from './constants.js';
import { approach, clamp, makeRng, hashString, aabb } from './utils.js';

export const T_EMPTY = 0;
export const T_SOLID = 1;
export const T_ONEWAY = 2;
export const T_HAZARD = 3;

const CHAR_TO_TILE = { '.': T_EMPTY, '#': T_SOLID, '=': T_ONEWAY, '^': T_HAZARD,
                       'o': T_EMPTY, 'C': T_EMPTY, 'P': T_EMPTY, 'G': T_EMPTY };

/* -------------------------------------------------------------------------- */
/*  Level parsing                                                             */
/* -------------------------------------------------------------------------- */

export function createWorld(def) {
  const w = def.width;
  const h = def.height;
  const tiles = new Uint8Array(w * h);
  const shards = [];
  const checkpoints = [];
  let spawn = { x: TILE * 2, y: TILE * 2 };
  let goal = null;

  for (let y = 0; y < h; y += 1) {
    const row = def.rows[y] || '';
    for (let x = 0; x < w; x += 1) {
      const ch = row[x] || '.';
      tiles[y * w + x] = CHAR_TO_TILE[ch] ?? T_EMPTY;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      if (ch === 'o') shards.push({ x: cx, y: cy, taken: false, phase: Math.random() * Math.PI * 2 });
      if (ch === 'C') checkpoints.push({ x: x * TILE, y: y * TILE, active: false, tx: x, ty: y });
      if (ch === 'P') spawn = { x: cx, y: cy };
      if (ch === 'G') goal = { x: x * TILE - 6, y: y * TILE - 34, w: 44, h: 66 };
    }
  }

  const movers = [];
  const pads = [];
  const enemies = [];

  (def.entities || []).forEach((e) => {
    if (e.t === 'mover') {
      movers.push({
        x: e.x * TILE, y: e.y * TILE,
        w: (e.w || 2) * TILE, h: 16,
        axis: e.axis === 'y' ? 'y' : 'x',
        dist: (e.dist || 4) * TILE,
        speed: e.speed || 60,
        originX: e.x * TILE, originY: e.y * TILE,
        t: 0, dx: 0, dy: 0, phase: (e.x * 0.37 + e.y * 0.11) % 1,
      });
    } else if (e.t === 'pad') {
      pads.push({ x: e.x * TILE, y: e.y * TILE + 12, w: TILE, h: 20,
                  power: e.power || 1, charge: 0 });
    } else if (e.t === 'walker') {
      enemies.push({ type: 'walker', x: e.x * TILE, y: e.y * TILE,
                     w: ENEMY.WALKER_W, h: ENEMY.WALKER_H,
                     vx: -(e.speed || 50), vy: 0, dead: false, anim: Math.random() * 6 });
    } else if (e.t === 'drone') {
      enemies.push({ type: 'drone', x: e.x * TILE, y: e.y * TILE,
                     w: ENEMY.DRONE_W, h: ENEMY.DRONE_H,
                     originX: e.x * TILE, originY: e.y * TILE,
                     radius: (e.radius || 4) * TILE, speed: e.speed || 1,
                     vx: 0, vy: 0, dead: false, anim: Math.random() * 6 });
    }
  });

  return {
    def,
    id: def.id,
    biome: def.biome,
    name: def.name,
    subtitle: def.subtitle,
    hint: def.hint,
    par: def.par,
    w, h,
    widthPx: w * TILE,
    heightPx: h * TILE,
    tiles,
    shards,
    checkpoints,
    movers,
    pads,
    enemies,
    goal: goal || { x: (w - 4) * TILE, y: (h - 6) * TILE, w: 44, h: 66 },
    spawn,
    particles: [],
    events: [],
    shake: 0,
    rng: makeRng(hashString(def.id)),
    totalShards: shards.length,
    deathPlane: h * TILE + TILE * 4,
  };
}

export function tileAt(world, tx, ty) {
  if (tx < 0 || tx >= world.w || ty < 0 || ty >= world.h) return ty >= world.h ? T_EMPTY : T_SOLID;
  return world.tiles[ty * world.w + tx];
}

const isBlocking = (t) => t === T_SOLID;

/* -------------------------------------------------------------------------- */
/*  Players                                                                   */
/* -------------------------------------------------------------------------- */

export function createPlayer({ id, name, skinIndex = 0, remote = false, world }) {
  return {
    id,
    name,
    remote,
    skin: SKINS[skinIndex % SKINS.length],
    skinIndex,
    x: world.spawn.x - PLAYER.WIDTH / 2,
    y: world.spawn.y - PLAYER.HEIGHT,
    prevX: 0, prevY: 0,
    renderX: 0, renderY: 0,
    vx: 0,
    vy: 0,
    w: PLAYER.WIDTH,
    h: PLAYER.HEIGHT,
    onGround: false,
    wasOnGround: false,
    coyote: 0,
    buffer: 0,
    jumpsLeft: PHYSICS.MAX_JUMPS,
    jumpHeld: false,
    jumpCut: false,
    facing: 1,
    hearts: PLAYER.MAX_HEARTS,
    invuln: 0,
    dead: false,
    deadTimer: 0,
    finished: false,
    finishTime: 0,
    shards: 0,
    spawnX: world.spawn.x - PLAYER.WIDTH / 2,
    spawnY: world.spawn.y - PLAYER.HEIGHT,
    riding: null,
    anim: { state: 'idle', time: 0, run: 0, land: 0 },
    scarf: Array.from({ length: 7 }, () => ({ x: 0, y: 0, px: 0, py: 0 })),
    stepTimer: 0,
    hurtFlash: 0,
  };
}

export function respawnPlayer(player, world) {
  player.x = player.spawnX;
  player.y = player.spawnY;
  player.vx = 0;
  player.vy = 0;
  player.dead = false;
  player.deadTimer = 0;
  player.invuln = PLAYER.INVULN_TIME;
  player.jumpsLeft = PHYSICS.MAX_JUMPS;
  player.riding = null;
  player.renderX = player.x;
  player.renderY = player.y;
  player.scarf.forEach((s) => { s.x = s.px = player.x + player.w / 2; s.y = s.py = player.y + 6; });
  player.anim.state = 'idle';
}

function emit(world, type, data) {
  world.events.push({ type, ...data });
}

/* -------------------------------------------------------------------------- */
/*  Collision                                                                 */
/* -------------------------------------------------------------------------- */

function forEachOverlappingTile(body, fn) {
  const x0 = Math.floor(body.x / TILE);
  const x1 = Math.floor((body.x + body.w - 0.001) / TILE);
  const y0 = Math.floor(body.y / TILE);
  const y1 = Math.floor((body.y + body.h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) fn(tx, ty);
  }
}

/**
 * Axis-separated swept AABB against the tile grid.
 *
 * Substepped so a fast fall can never tunnel through a one-tile floor, and
 * resolving against the *nearest* blocking tile only — applying every
 * overlapping tile in turn would let a far tile push the body back into the
 * near one.
 */
function firstBlockingX(world, body, dir) {
  const y0 = Math.floor((body.y + 1) / TILE);
  const y1 = Math.floor((body.y + body.h - 1) / TILE);
  const x0 = Math.floor(body.x / TILE);
  const x1 = Math.floor((body.x + body.w - 0.001) / TILE);
  let found = null;
  for (let tx = x0; tx <= x1; tx += 1) {
    for (let ty = y0; ty <= y1; ty += 1) {
      if (tileAt(world, tx, ty) !== T_SOLID) continue;
      if (dir > 0 && (found === null || tx < found)) found = tx;
      if (dir < 0 && (found === null || tx > found)) found = tx;
    }
  }
  return found;
}

function firstBlockingY(world, body, dir, prevBottom, dropThrough) {
  const x0 = Math.floor((body.x + 1) / TILE);
  const x1 = Math.floor((body.x + body.w - 1) / TILE);
  const y0 = Math.floor(body.y / TILE);
  const y1 = Math.floor((body.y + body.h - 0.001) / TILE);

  if (dir > 0) {
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        const t = tileAt(world, tx, ty);
        if (t === T_ONEWAY) {
          if (!dropThrough && prevBottom <= ty * TILE + 1) return ty;
          continue;
        }
        if (t === T_SOLID) return ty;
      }
    }
    return null;
  }

  for (let ty = y1; ty >= y0; ty -= 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (tileAt(world, tx, ty) === T_SOLID) return ty;
    }
  }
  return null;
}

function moveBody(world, body, dx, dy, opts = {}) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE * 0.5)));
  const sx = dx / steps;
  const sy = dy / steps;
  let hitX = false;
  let hitY = false;
  let hitFloor = false;
  let landedOn = null;

  for (let i = 0; i < steps; i += 1) {
    /* --- X ------------------------------------------------------------- */
    if (sx !== 0) {
      body.x += sx;
      const tx = firstBlockingX(world, body, sx);
      if (tx !== null) {
        body.x = sx > 0 ? tx * TILE - body.w : (tx + 1) * TILE;
        body.vx = 0;
        hitX = true;
      }
    }

    /* --- Y ------------------------------------------------------------- */
    if (sy !== 0) {
      const prevBottom = body.y + body.h;
      body.y += sy;
      const ty = firstBlockingY(world, body, sy, prevBottom, opts.dropThrough);
      if (ty !== null) {
        if (sy > 0) {
          body.y = ty * TILE - body.h;
          landedOn = { kind: 'tile', tx: -1, ty };
          hitFloor = true;
        } else {
          body.y = (ty + 1) * TILE;
        }
        body.vy = 0;
        hitY = true;
      }
    }
  }
  return { hitX, hitY, hitFloor, landedOn };
}

function overlapsMover(body, m) {
  return aabb(body, { x: m.x, y: m.y, w: m.w, h: m.h });
}

/** Collides a body against moving platforms (treated as solid on all sides). */
function collideMovers(world, body, dy) {
  let landedOn = null;
  for (const m of world.movers) {
    if (landedOn) break;
    if (!overlapsMover(body, m)) continue;
    const prevBottom = body.y + body.h - dy;
    const prevTop = body.y - dy;
    // Landing on top.
    if (dy >= 0 && prevBottom <= m.y + Math.max(4, Math.abs(dy) + 2)) {
      body.y = m.y - body.h;
      body.vy = 0;
      landedOn = m;
    } else if (dy < 0 && prevTop >= m.y + m.h - Math.max(4, Math.abs(dy) + 2)) {
      body.y = m.y + m.h;
      body.vy = 0;
    } else {
      // Side contact: push out along the shorter axis.
      const fromLeft = body.x + body.w / 2 < m.x + m.w / 2;
      body.x = fromLeft ? m.x - body.w : m.x + m.w;
      body.vx = 0;
    }
  }
  return landedOn;
}

/* -------------------------------------------------------------------------- */
/*  Player update                                                             */
/* -------------------------------------------------------------------------- */

function updatePlayer(world, p, input, dt) {
  p.prevX = p.x;
  p.prevY = p.y;
  if (p.invuln > 0) p.invuln -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;

  if (p.dead) {
    p.deadTimer -= dt;
    p.vy += PHYSICS.GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.deadTimer <= 0) respawnPlayer(p, world);
    return;
  }
  if (p.finished) {
    p.vx = approach(p.vx, 0, PHYSICS.FRICTION_GROUND, dt);
    p.vy = Math.min(PHYSICS.MAX_FALL, p.vy + PHYSICS.GRAVITY * dt);
    moveBody(world, p, p.vx * dt, p.vy * dt);
    return;
  }

  /* ---- Jump buffering + coyote time ------------------------------------ */
  if (input.jumpPressed) p.buffer = PHYSICS.JUMP_BUFFER;
  if (p.buffer > 0) p.buffer -= dt;
  if (p.onGround) p.coyote = PHYSICS.COYOTE_TIME;
  else if (p.coyote > 0) p.coyote -= dt;

  /* ---- Horizontal movement -------------------------------------------- */
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const target = dir * PHYSICS.RUN_SPEED;
  const accel = p.onGround ? PHYSICS.ACCEL_GROUND : PHYSICS.ACCEL_AIR;
  const friction = p.onGround ? PHYSICS.FRICTION_GROUND : PHYSICS.FRICTION_AIR;

  if (dir !== 0) {
    p.vx = approach(p.vx, target, accel, dt);
    p.facing = dir;
  } else {
    p.vx = approach(p.vx, 0, friction, dt);
  }

  /* ---- Jump ------------------------------------------------------------ */
  if (p.buffer > 0 && (p.onGround || p.coyote > 0) && p.jumpsLeft > 0) {
    p.vy = PHYSICS.JUMP_VELOCITY;
    p.jumpsLeft -= 1;
    p.buffer = 0;
    p.coyote = 0;
    p.onGround = false;
    p.jumpCut = false;
    p.riding = null;
    emit(world, 'jump', { player: p });
    spawnParticles(world, p.x + p.w / 2, p.y + p.h, 8, {
      color: p.skin.scarf, speed: 90, life: 0.4, gravity: 380, size: 3,
    });
  }

  // Variable jump height: releasing early clips the upward velocity once.
  if (!input.jumpHeld && p.vy < 0 && !p.jumpCut) {
    p.vy = Math.max(p.vy * PHYSICS.JUMP_CUT, PHYSICS.JUMP_CUT_MIN);
    p.jumpCut = true;
  }
  if (p.vy >= 0) p.jumpCut = false;

  /* ---- Gravity --------------------------------------------------------- */
  const rising = p.vy < 0;
  let g = PHYSICS.GRAVITY;
  if (rising && Math.abs(p.vy) < PHYSICS.APEX_THRESHOLD) g = PHYSICS.GRAVITY_APEX;
  if (!rising) g *= PHYSICS.FALL_GRAVITY_MULT;
  p.vy = Math.min(PHYSICS.MAX_FALL, p.vy + g * dt);

  /* ---- Integrate + collide -------------------------------------------- */
  const dx = p.vx * dt;
  const dy = p.vy * dt;
  const result = moveBody(world, p, dx, dy, { dropThrough: input.down && p.onGround });
  const moverLanding = collideMovers(world, p, dy);

  p.wasOnGround = p.onGround;
  // Only a downward contact (or a moving platform) counts as grounding —
  // bumping a ceiling must never refill the jump.
  p.onGround = Boolean(result.hitFloor) || Boolean(moverLanding) || standingOn(world, p);
  p.riding = moverLanding || (p.onGround ? p.riding : null);

  if (result.hitX) p.vx = 0;

  if (p.onGround) {
    p.jumpsLeft = PHYSICS.MAX_JUMPS;
    if (!p.wasOnGround) {
      const impact = Math.min(1, Math.abs(p.vy || 300) / 700);
      emit(world, 'land', { player: p, impact });
      spawnParticles(world, p.x + p.w / 2, p.y + p.h, Math.round(6 + impact * VISUAL.DUST_ON_LAND), {
        color: '#ffffff', speed: 60 + impact * 120, life: 0.45, gravity: 420, size: 3.2, alpha: 0.45,
      });
      p.anim.land = 0.22;
      if (impact > 0.55) world.shake = Math.min(9, world.shake + impact * 6);
    }
  }

  /* ---- Animation state ------------------------------------------------- */
  const speed = Math.abs(p.vx);
  const nextState = !p.onGround
    ? (p.vy < -30 ? 'jump' : 'fall')
    : speed > 24 ? 'run' : 'idle';
  if (nextState !== p.anim.state) p.anim.time = 0;
  p.anim.state = nextState;
  p.anim.time += dt;
  if (p.anim.state === 'run') p.anim.run += (speed / PHYSICS.RUN_SPEED) * dt * 9;
  if (p.anim.land > 0) p.anim.land -= dt;

  // Footsteps
  p.stepTimer -= dt;
  if (p.onGround && speed > 40 && p.stepTimer <= 0) {
    p.stepTimer = 0.28;
    emit(world, 'step', { player: p });
  }

  /* ---- Jump pads -------------------------------------------------------- */
  for (const pad of world.pads) {
    if (!aabb(p, pad)) continue;
    if (p.vy < -50) continue;
    p.vy = PLAYER.PAD_VELOCITY * pad.power;
    p.onGround = false;
    p.jumpCut = false;
    p.jumpsLeft = PHYSICS.MAX_JUMPS;
    pad.charge = 1;
    emit(world, 'pad', { player: p });
    spawnParticles(world, pad.x + pad.w / 2, pad.y + pad.h / 2, 20, {
      color: '#8affe0', speed: 260, life: 0.55, gravity: -60, size: 3.6,
    });
  }

  /* ---- Shards ----------------------------------------------------------- */
  for (const s of world.shards) {
    if (s.taken) continue;
    if (Math.abs(s.x - (p.x + p.w / 2)) > 20 || Math.abs(s.y - (p.y + p.h / 2)) > 22) continue;
    s.taken = true;
    p.shards += WORLD.SHARD_VALUE;
    emit(world, 'shard', { player: p, index: p.shards });
    spawnParticles(world, s.x, s.y, VISUAL.SPARK_ON_SHARD, {
      color: '#ffe6a3', speed: 150, life: 0.6, gravity: 120, size: 3,
    });
  }

  /* ---- Checkpoints ------------------------------------------------------ */
  for (const c of world.checkpoints) {
    if (c.active) continue;
    if (!aabb(p, { x: c.x, y: c.y - TILE, w: TILE, h: TILE * 2 })) continue;
    c.active = true;
    p.spawnX = c.x + (TILE - p.w) / 2;
    p.spawnY = c.y - p.h;
    emit(world, 'checkpoint', { player: p });
    spawnParticles(world, c.x + TILE / 2, c.y, 18, {
      color: '#8affe0', speed: 170, life: 0.7, gravity: -30, size: 3,
    });
  }

  /* ---- Enemies ---------------------------------------------------------- */
  for (const e of world.enemies) {
    if (e.dead) continue;
    if (!aabb(p, e)) continue;
    const stomping = p.vy > 60 && (p.y + p.h) - e.y < e.h * 0.7;
    if (stomping) {
      e.dead = true;
      p.vy = PLAYER.STOMP_BOUNCE;
      p.jumpsLeft = PHYSICS.MAX_JUMPS;
      p.jumpCut = false;
      emit(world, 'stomp', { player: p, enemy: e });
      spawnParticles(world, e.x + e.w / 2, e.y + e.h / 2, 16, {
        color: e.type === 'drone' ? '#ff9ec4' : '#ffd27a', speed: 190, life: 0.5, gravity: 260, size: 3.4,
      });
    } else if (p.invuln <= 0) {
      hurtPlayer(world, p, e.x + e.w / 2 < p.x + p.w / 2 ? 1 : -1);
    }
  }

  /* ---- Hazards (spike tiles) -------------------------------------------- */
  const hazard = touchingHazard(world, p);
  if (hazard && p.invuln <= 0) hurtPlayer(world, p, 0, true);

  /* ---- Fall out of the world -------------------------------------------- */
  if (p.y > world.deathPlane) hurtPlayer(world, p, 0, true, true);

  /* ---- Goal -------------------------------------------------------------- */
  if (!p.finished && world.goal && aabb(p, world.goal)) {
    p.finished = true;
    emit(world, 'goal', { player: p });
    spawnParticles(world, world.goal.x + world.goal.w / 2, world.goal.y + world.goal.h / 2, 34, {
      color: '#8affe0', speed: 240, life: 0.9, gravity: -40, size: 4,
    });
  }

  updateScarf(p, dt);
}

function updateScarf(p, dt) {
  const anchorX = p.x + p.w / 2 - p.facing * 5;
  const anchorY = p.y + 7;
  let px = anchorX;
  let py = anchorY;
  for (const node of p.scarf) {
    const nx = node.x + (node.x - node.px) * 0.72;
    const ny = node.y + (node.y - node.py) * 0.72;
    node.px = node.x;
    node.py = node.y;
    // Constrain each node to its neighbour with a simple verlet-ish follow.
    const dx = px - nx;
    const dy = py - ny;
    const d = Math.hypot(dx, dy) || 1;
    const seg = 6.2;
    node.x = px - (dx / d) * seg;
    node.y = py - (dy / d) * seg;
    px = node.x;
    py = node.y;
    void dt;
  }
}

function standingOn(world, p) {
  const feet = p.y + p.h + 1;
  const x0 = Math.floor((p.x + 2) / TILE);
  const x1 = Math.floor((p.x + p.w - 2) / TILE);
  const ty = Math.floor(feet / TILE);
  for (let tx = x0; tx <= x1; tx += 1) {
    const t = tileAt(world, tx, ty);
    if (t === T_SOLID || t === T_ONEWAY) return true;
  }
  for (const m of world.movers) {
    if (Math.abs(m.y - feet) < 3 && p.x + p.w > m.x + 2 && p.x < m.x + m.w - 2) return true;
  }
  return false;
}

function touchingHazard(world, p) {
  const x0 = Math.floor((p.x + 3) / TILE);
  const x1 = Math.floor((p.x + p.w - 3) / TILE);
  const y0 = Math.floor((p.y + 3) / TILE);
  const y1 = Math.floor((p.y + p.h - 2) / TILE);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (tileAt(world, tx, ty) === T_HAZARD) return true;
    }
  }
  return false;
}

export function hurtPlayer(world, p, knockDir = 0, fromHazard = false, fell = false) {
  if (p.invuln > 0 || p.dead || p.finished) return;
  p.hearts -= 1;
  p.invuln = PLAYER.INVULN_TIME;
  p.hurtFlash = 0.35;
  world.shake = Math.min(11, world.shake + 6);
  p.vx = knockDir * PLAYER.HURT_KNOCKBACK;
  p.vy = fromHazard && !fell ? -280 : -180;

  spawnParticles(world, p.x + p.w / 2, p.y + p.h / 2, VISUAL.BURST_ON_HURT, {
    color: p.skin.scarf, speed: 210, life: 0.6, gravity: 400, size: 3.4,
  });

  if (p.hearts <= 0) {
    p.dead = true;
    p.deadTimer = PLAYER.RESPAWN_DELAY;
    p.hearts = PLAYER.MAX_HEARTS;
    p.vx = 0;
    p.vy = -220;
    emit(world, 'death', { player: p });
  } else {
    emit(world, 'hurt', { player: p });
  }
}

/* -------------------------------------------------------------------------- */
/*  Enemies & movers                                                          */
/* -------------------------------------------------------------------------- */

function updateEnemies(world, dt) {
  for (const e of world.enemies) {
    if (e.dead) continue;
    e.anim += dt;

    if (e.type === 'walker') {
      e.vy = Math.min(PHYSICS.MAX_FALL, e.vy + PHYSICS.GRAVITY * dt);
      const before = e.x;
      moveBody(world, e, e.vx * dt, e.vy * dt);
      collideMovers(world, e, e.vy * dt);

      // Turn at walls.
      if (Math.abs(e.x - before) < Math.abs(e.vx * dt) * 0.4) e.vx *= -1;

      // Turn at ledges: look one tile ahead and down.
      const aheadTx = Math.floor((e.x + (e.vx > 0 ? e.w + 4 : -4)) / TILE);
      const belowTy = Math.floor((e.y + e.h + 6) / TILE);
      const t = tileAt(world, aheadTx, belowTy);
      if (t !== T_SOLID && t !== T_ONEWAY) e.vx *= -1;
    } else if (e.type === 'drone') {
      const t = e.anim * e.speed;
      const targetX = e.originX + Math.cos(t) * e.radius;
      const targetY = e.originY + Math.sin(t * 1.7) * (TILE * ENEMY.DRONE_BOB);
      e.vx = (targetX - e.x) / Math.max(dt, 0.001);
      e.x = targetX;
      e.y = targetY;
    }
  }
}

function updateMovers(world, dt) {
  for (const m of world.movers) {
    m.t += dt;
    const span = m.dist || 1;
    // Triangle wave keeps the motion smooth and the turnaround gentle.
    const cycle = (m.t * m.speed) / span;
    const tri = Math.abs(((cycle % 2) + 2) % 2 - 1) * 2 - 1; // -1..1
    const nx = m.axis === 'x' ? m.originX + tri * span : m.originX;
    const ny = m.axis === 'y' ? m.originY + tri * span : m.originY;
    m.dx = nx - m.x;
    m.dy = ny - m.y;
    m.x = nx;
    m.y = ny;
  }
}

/* -------------------------------------------------------------------------- */
/*  Particles                                                                 */
/* -------------------------------------------------------------------------- */

export function spawnParticles(world, x, y, count, opts = {}) {
  const {
    color = '#ffffff', speed = 120, life = 0.5, gravity = 300,
    size = 3, alpha = 0.85, spread = Math.PI * 2, dir = 0,
  } = opts;
  const budget = Math.min(count, VISUAL.MAX_PARTICLES - world.particles.length);
  for (let i = 0; i < budget; i += 1) {
    const a = dir + (Math.random() - 0.5) * spread;
    const s = speed * (0.35 + Math.random() * 0.9);
    world.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: life * (0.6 + Math.random() * 0.7),
      maxLife: life,
      gravity,
      size: size * (0.6 + Math.random() * 0.8),
      color,
      alpha,
    });
  }
}

function updateParticles(world, dt) {
  const list = world.particles;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) { list.splice(i, 1); continue; }
    p.vy += p.gravity * dt;
    p.vx *= 1 - 1.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

/* -------------------------------------------------------------------------- */
/*  World step                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Advances the simulation by `dt` seconds.
 * `players` is an array of { player, input } pairs. Remote players pass an
 * input object produced from network state rather than from local devices.
 */
export function stepWorld(world, dt, actors) {
  updateMovers(world, dt);

  // Carry riders before their own movement so they never lag the platform.
  for (const { player } of actors) {
    if (player.riding) {
      player.x += player.riding.dx;
      player.y += player.riding.dy;
    }
  }

  for (const { player, input } of actors) updatePlayer(world, player, input, dt);

  updateEnemies(world, dt);
  updateParticles(world, dt);

  for (const pad of world.pads) if (pad.charge > 0) pad.charge -= dt * 2;
  if (world.shake > 0) world.shake = Math.max(0, world.shake - VISUAL.SHAKE_DECAY * dt);
}

/** Interpolated render position — removes fixed-step judder. */
export function syncRender(player, alpha) {
  player.renderX = player.prevX + (player.x - player.prevX) * alpha;
  player.renderY = player.prevY + (player.y - player.prevY) * alpha;
}

export function resetWorldProgress(world) {
  world.shards.forEach((s) => { s.taken = false; });
  world.checkpoints.forEach((c) => { c.active = false; });
  world.enemies.forEach((e) => { e.dead = false; e.vy = 0; e.anim = Math.random() * 6; });
  world.particles.length = 0;
  world.shake = 0;
  world.events.length = 0;
  world.movers.forEach((m) => { m.t = 0; m.x = m.originX; m.y = m.originY; m.dx = 0; m.dy = 0; });
}

export { updatePlayer, clamp };

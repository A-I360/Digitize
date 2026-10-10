/**
 * Headless play-through test.
 *
 * Drives the real simulation (js/game/world.js) with a heuristic bot and
 * asserts that every shipped level is completable: the bot must reach the goal
 * without getting wedged or falling into an unrecoverable loop.
 *
 * This is the closest thing to "someone played it" that is possible without a
 * browser, and it catches the failures that actually matter — impassable gaps,
 * walls you can jump straight into, spikes you cannot clear, pits with no
 * platform across them, and geometry the player can become stuck in.
 *
 * The bot is deliberately dumb (no path-finding, no lookahead search). If it
 * can finish a level, a human can.
 */

import { LEVELS, TILE } from '../js/game/levels.js';
import { createWorld, createPlayer, stepWorld, syncRender, tileAt } from '../js/game/world.js';
import { WORLD, PHYSICS } from '../js/game/constants.js';

const STEP = WORLD.FIXED_STEP;
const MAX_SECONDS = 300;
const STUCK_SECONDS = 18;

const isSolid = (world, tx, ty) => {
  const t = tileAt(world, tx, ty);
  return t === 1 /* solid */ || t === 2 /* one-way */;
};

/** Everything the bot can see, in tile units. */
function sensors(world, p) {
  const footTy = Math.floor((p.y + p.h + 2) / TILE);
  const headTy = Math.floor((p.y + 4) / TILE);
  const bodyTy = Math.floor((p.y + p.h / 2) / TILE);
  const frontTx = Math.floor((p.x + p.w + 4) / TILE);

  // A hole is only a hole if it goes deeper than a step-down.
  const holeAhead = [0, 1, 2, 3].every((d) => !isSolid(world, frontTx, footTy + d));
  const wallAhead = isSolid(world, frontTx, bodyTy) || isSolid(world, frontTx, headTy);
  let hazardAhead = false;
  for (let d = 0; d <= 2 && !hazardAhead; d += 1) {
    if (tileAt(world, frontTx + d, footTy) === 3 || tileAt(world, frontTx + d, footTy - 1) === 3) {
      hazardAhead = true;
    }
  }

  // Nearest live enemy ahead of us on roughly our own level.
  let enemy = null;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x;
    if (dx <= 0 || dx > 130) continue;
    if (Math.abs(e.y - p.y) > 80) continue;
    if (!enemy || dx < enemy.dx) enemy = { dx, ref: e };
  }

  // Nearest platform we could board, in the direction of travel.
  let platform = null;
  for (const m of world.movers) {
    const gap = m.x - (p.x + p.w);
    const dy = p.y + p.h - m.y; // > 0 → the platform is above our feet
    if (m.x + m.w <= p.x + 4) continue; // behind us
    if (gap > 5 * TILE || dy > 3 * TILE || dy < -3 * TILE) continue;
    if (!platform || gap < platform.gap) platform = { gap, dy, ref: m };
  }

  return { footTy, headTy, bodyTy, frontTx, holeAhead, wallAhead, hazardAhead, enemy, platform };
}

/**
 * Decide what to do this frame.
 * Returns dir (−1/0/1) and, when a jump is wanted, how long to hold it.
 */
function decide(world, p, s, memory) {
  /* --- Riding a moving platform ---------------------------------------- */
  if (p.riding) {
    const m = p.riding;
    const reachedEnd = m.axis === 'y'
      ? m.y <= m.originY - m.dist + 8
      : m.x >= m.originX + m.dist - 12;
    if (!reachedEnd) return { dir: 0, jump: 0 };
    // Leap off the far end — assume there is more level over there.
    return { dir: 1, jump: 0.62 };
  }

  /* --- Enemies: jump over them before they reach us --------------------- */
  // Jumping at ~50px of separation clears a walker comfortably; the player is
  // already 60px up by the time contact would happen.
  if (s.enemy && p.onGround && s.enemy.dx > 20 && s.enemy.dx < 62) {
    return { dir: 1, jump: 0.62 };
  }
  if (s.enemy && p.onGround && s.enemy.dx <= 20) {
    return { dir: -1, jump: 0 }; // too close to jump safely — back off and retry
  }

  /* --- Boarding a moving platform -------------------------------------- */
  if (s.platform && p.onGround && s.holeAhead) {
    const { gap, dy } = s.platform;
    if (gap > -0.5 * TILE && gap < 3.2 * TILE && dy > -1.2 * TILE && dy < 2.8 * TILE) {
      return { dir: 1, jump: 0.62 };
    }
    if (dy < -1.2 * TILE) return { dir: 1, jump: 0 }; // it is below us — drop onto it
    return { dir: 0, jump: 0 };                       // wait for it to come to us
  }

  /* --- Ordinary terrain ------------------------------------------------- */
  if (p.onGround && s.wallAhead) return { dir: 1, jump: 0.62 };
  if (p.onGround && s.hazardAhead) return { dir: 1, jump: 0.62 };
  if (p.onGround && s.holeAhead) return { dir: 1, jump: 0.62 };

  // Recovery: shuffle backwards, then push forward again.
  if (memory.stuckFor > 3) {
    const cycle = Math.floor(memory.stuckFor * 2) % 4;
    if (cycle === 0) return { dir: -1, jump: 0 };
    if (cycle === 1) return { dir: 1, jump: 0.62 };
  }

  return { dir: 1, jump: 0 };
}

function play(level) {
  const world = createWorld(level);
  const player = createPlayer({ id: 'bot', name: 'Bot', world });
  player.renderX = player.x;
  player.renderY = player.y;

  const memory = { stuckFor: 0, holdTimer: 0, lastJump: false };
  const trace = process.env.TRACE === level.id || process.env.TRACE === '1';
  const samples = [];
  let bestX = player.x;
  let deaths = 0;
  let time = 0;
  let jumpHeld = false;

  while (time < MAX_SECONDS) {
    const s = sensors(world, player);
    const { dir, jump } = decide(world, player, s, memory);

    // Edge-triggered jump. `lastJump` is cleared the moment we land so a
    // standing "I want to jump" signal still produces repeated jumps.
    let jumpPressed = false;
    if (jump > 0 && !memory.lastJump) {
      jumpPressed = true;
      memory.holdTimer = jump;
    }
    memory.lastJump = jump > 0;
    if (player.onGround && !player.wasOnGround) memory.lastJump = false;
    if (memory.holdTimer > 0) { memory.holdTimer -= STEP; jumpHeld = true; } else { jumpHeld = false; }

    const input = { left: dir < 0, right: dir > 0, jumpHeld, jumpPressed, down: false };
    const wasDead = player.dead;

    stepWorld(world, STEP, [{ player, input }]);
    syncRender(player, 0);
    world.events.length = 0;
    time += STEP;

    if (!wasDead && player.dead) deaths += 1;
    if (trace && Math.round(time * 100) % 25 === 0) {
      samples.push(`${time.toFixed(2)} x=${(player.x / TILE).toFixed(1)} y=${(player.y / TILE).toFixed(1)} ` +
        `dir=${dir} J=${jump.toFixed(2)} onG=${player.onGround ? 1 : 0} ride=${player.riding ? (player.riding.axis + Math.round(player.riding.x / TILE)) : '-'} ` +
        `hole=${s.holeAhead ? 1 : 0} wall=${s.wallAhead ? 1 : 0} haz=${s.hazardAhead ? 1 : 0} en=${s.enemy ? s.enemy.dx.toFixed(0) : '-'} ` +
        `plat=${s.platform ? `${s.platform.gap.toFixed(0)}/${s.platform.dy.toFixed(0)}` : '-'} h=${player.hearts} d=${deaths}`);
    }

    if (player.finished) {
      if (trace) console.log(samples.slice(-40).join('\n'));
      return { ok: true, time, deaths, shards: player.shards, total: world.totalShards };
    }

    // Progress watchdog. Respawning moves the player backwards, so treat a
    // large backward jump as a fresh attempt rather than as being stuck.
    if (player.x < bestX - 64 || player.x > bestX + 1) {
      bestX = player.x;
      memory.stuckFor = 0;
    } else {
      memory.stuckFor += STEP;
      if (memory.stuckFor > STUCK_SECONDS) {
        return {
          ok: false,
          reason: `stuck at x=${(player.x / TILE).toFixed(1)} y=${(player.y / TILE).toFixed(1)} tiles after ${time.toFixed(0)}s (${deaths} deaths)`,
          time, deaths,
        };
      }
    }
  }

  if (trace) console.log(samples.slice(-120).join('\n'));
  return {
    ok: false,
    reason: `no finish in ${MAX_SECONDS}s — reached x=${(bestX / TILE).toFixed(1)}/${world.w} tiles (${deaths} deaths)`,
    time, deaths,
  };
}

/* -------------------------------------------------------------------------- */

let failures = 0;
console.log('Aether Drift — headless play-through\n');

for (const level of LEVELS) {
  const result = play(level);
  const label = `${level.name}`.padEnd(14);
  if (result.ok) {
    console.log(`  PASS  ${label} finished in ${result.time.toFixed(1)}s · ` +
                `shards ${result.shards}/${result.total} · deaths ${result.deaths} · par ${level.par}s`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label} ${result.reason}`);
  }
}

const jumpHeight = (PHYSICS.JUMP_VELOCITY ** 2) / (2 * PHYSICS.GRAVITY) / TILE;
const jumpRun = ((2 * Math.abs(PHYSICS.JUMP_VELOCITY)) / PHYSICS.GRAVITY) * PHYSICS.RUN_SPEED / TILE;
console.log(`\n  movement envelope: ${jumpHeight.toFixed(2)} tiles up · ${jumpRun.toFixed(2)} tiles across`);

if (failures) {
  console.error(`\n${failures} level(s) failed.`);
  process.exit(1);
}
console.log('\nAll levels completable.');

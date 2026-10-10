#!/usr/bin/env node
/**
 * Aether Drift — level builder.
 *
 * Levels are authored as ASCII maps in `tools/level-maps/`, with the dynamic
 * bits (enemies, moving platforms, jump pads) declared in `meta.json`. This
 * script parses them, runs a geometric audit against the movement envelope
 * taken from the physics constants, and writes `js/game/levels.js`.
 *
 *   node tools/build-levels.mjs          # build
 *   node tools/build-levels.mjs --check  # audit only, write nothing
 *
 * The audit is a *static* check: it proves every gap is jumpable and every
 * step-up is climbable. It cannot prove a level is fun, or that the timing on
 * a moving platform is fair — `npm run test:levels` drives the real simulation
 * with a bot for that.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PHYSICS, PLAYER, TILE } from '../js/game/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_DIR = join(HERE, 'level-maps');
const OUT = join(HERE, '..', 'js', 'game', 'levels.js');

const meta = JSON.parse(readFileSync(join(MAP_DIR, 'meta.json'), 'utf8'));

/* -------------------------------------------------------------------------- */
/*  Movement envelope — the numbers every design decision is measured against. */
/* -------------------------------------------------------------------------- */

const APEX = PHYSICS.GRAVITY_APEX;
const THRESH = PHYSICS.APEX_THRESHOLD;

/** Peak height of a full jump, in tiles. Two-phase gravity, so integrate. */
function jumpHeightTiles() {
  // Phase 1: gravity until |vy| < THRESH. Phase 2: apex gravity to the top.
  const v0 = Math.abs(PHYSICS.JUMP_VELOCITY);
  const h1 = (v0 ** 2 - THRESH ** 2) / (2 * PHYSICS.GRAVITY);
  const h2 = THRESH ** 2 / (2 * APEX);
  return (h1 + h2) / TILE;
}

const ENVELOPE = {
  up: jumpHeightTiles(),
  across: ((2 * Math.abs(PHYSICS.JUMP_VELOCITY)) / PHYSICS.GRAVITY) * PHYSICS.RUN_SPEED / TILE,
  padUp: (PLAYER.PAD_VELOCITY ** 2) / (2 * PHYSICS.GRAVITY) / TILE,
};

// Leave margin: the bot (and a nervous player) will not hit the theoretical max.
const MAX_GAP = Math.floor(ENVELOPE.across - 1.25);
const MAX_RISE = Math.floor(ENVELOPE.up - 0.6);

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                    */
/* -------------------------------------------------------------------------- */

const SOLID = new Set(['#', '=']);

function parse(id) {
  const def = meta.find((m) => m.id === id);
  const rows = readFileSync(join(MAP_DIR, `${id}.txt`), 'utf8').replace(/\r/g, '').split('\n');
  while (rows.length && rows[rows.length - 1] === '') rows.pop();

  const width = def.width;
  const height = def.height;
  const problems = [];

  if (rows.length !== height) problems.push(`map has ${rows.length} rows, meta says ${height}`);
  rows.forEach((r, y) => {
    if (r.length !== width) problems.push(`row ${y} is ${r.length} columns wide, expected ${width}`);
  });

  return { def, rows, width, height, problems };
}

/* -------------------------------------------------------------------------- */
/*  Audit                                                                      */
/* -------------------------------------------------------------------------- */

/** Every column's topmost standable surface row, or null. */
function surfaces(rows, width, height) {
  const top = new Array(width).fill(null);
  for (let x = 0; x < width; x += 1) {
    for (let y = 1; y < height; y += 1) {
      const ch = rows[y]?.[x] ?? '.';
      if (!SOLID.has(ch)) continue;
      const above = rows[y - 1]?.[x] ?? '.';
      if (above === '^') continue; // a spike-topped tile is not somewhere to stand
      top[x] = y;
      break;
    }
  }
  return top;
}

/** Contiguous runs of columns that share a surface. */
function segments(top) {
  const segs = [];
  let start = null;
  let prevRow = null;
  for (let x = 0; x <= top.length; x += 1) {
    const row = x < top.length ? top[x] : null;
    const continuous = row !== null && prevRow !== null && Math.abs(row - prevRow) <= 3;
    if (row !== null && start === null) { start = x; prevRow = row; continue; }
    if (row !== null && continuous) { prevRow = row; continue; }
    if (start !== null) { segs.push({ x0: start, x1: x - 1, row: prevRow }); start = null; }
    if (row !== null) { start = x; prevRow = row; } else { prevRow = null; }
  }
  return segs;
}

function moverSpans(entities) {
  return (entities || [])
    .filter((e) => e.t === 'mover')
    .map((e) => ({
      minX: e.x - (e.dist || 4),
      maxX: e.x + (e.dist || 4) + (e.w || 2),
      row: e.y,
      axis: e.axis === 'y' ? 'y' : 'x',
    }));
}

function audit(level) {
  const { def, rows, width, height, problems } = level;
  const errors = problems.slice();
  const warnings = [];
  const notes = [];

  const flat = rows.join('');
  const count = (ch) => flat.split(ch).length - 1;
  if (count('P') !== 1) errors.push(`expected exactly 1 spawn (P), found ${count('P')}`);
  if (count('G') !== 1) errors.push(`expected exactly 1 goal (G), found ${count('G')}`);
  for (const ch of flat) {
    if (!'.#=^oCPG'.includes(ch)) { errors.push(`unknown map character ${JSON.stringify(ch)}`); break; }
  }

  const top = surfaces(rows, width, height);
  const segs = segments(top);
  const bridges = moverSpans(def.entities);

  for (let i = 0; i < segs.length - 1; i += 1) {
    const a = segs[i];
    const b = segs[i + 1];
    const gap = b.x0 - a.x1 - 1;
    const rise = a.row - b.row; // > 0 means the next surface is higher
    if (gap <= 0) continue;

    const bridged = bridges.some((m) => m.minX <= a.x1 + 2 && m.maxX >= b.x0 - 1
      && m.row <= a.row + 1 && m.row >= b.row - 1);

    if (bridged) continue;
    if (gap > MAX_GAP) {
      errors.push(`gap of ${gap} tiles between x=${a.x1} and x=${b.x0} exceeds the ${MAX_GAP}-tile jump` +
        (rise > 0 ? ` (and rises ${rise} rows)` : ''));
    } else if (rise > MAX_RISE) {
      errors.push(`step-up of ${rise} rows at x=${b.x0} exceeds the ${MAX_RISE}-row climb`);
    }
  }

  // A spike strip needs somewhere safe to take off from.
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if ((rows[y]?.[x] ?? '.') !== '^') { x += 1; continue; }
      const start = x;
      while (x < width && (rows[y]?.[x] ?? '.') === '^') x += 1;
      let safe = false;
      for (let d = 1; d <= 2 && !safe; d += 1) {
        const t = top[start - d];
        if (t !== null && t === y + 1) safe = true;
      }
      if (!safe) {
        warnings.push(`spike strip x=${start}..${x - 1} (row ${y}) has no safe take-off tile to its left`);
      }
      if (x - start > MAX_GAP) {
        errors.push(`spike strip x=${start}..${x - 1} is ${x - start} tiles wide — wider than a jump`);
      }
    }
  }

  // Collectibles floating in the air are normal (they are jump-through
  // rewards). What is not normal is one so high that nothing can reach it.
  const floorBelow = (x, y) => {
    for (let d = 1; d <= 6; d += 1) {
      const ch = rows[y + d]?.[x] ?? '.';
      if (ch === '#' || ch === '=') return d;
      if (ch === '^') return -d;
    }
    return null;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ch = rows[y]?.[x] ?? '.';
      if (ch !== 'o' && ch !== 'C') continue;
      const d = floorBelow(x, y);
      if (d === null) {
        notes.push(`${ch} at (${x},${y}) has nothing standable within 6 tiles below it`);
      } else if (d < 0 && ch === 'C') {
        errors.push(`checkpoint at (${x},${y}) sits directly above a hazard`);
      } else if (d < 0) {
        // Shards hovering over spikes are deliberate: you grab them mid-jump.
        notes.push(`${ch} at (${x},${y}) hangs over a hazard (±${-d} rows)`);
      } else if (ch === 'C' && d !== 1) {
        warnings.push(`checkpoint at (${x},${y}) is ${d - 1} tiles off the ground`);
      }
    }
  }

  const pads = (def.entities || []).filter((e) => e.t === 'pad');
  for (const p of pads) {
    if ((rows[p.y + 1]?.[p.x] ?? '.') !== '#' && (rows[p.y + 1]?.[p.x] ?? '.') !== '=') {
      errors.push(`jump pad at (${p.x},${p.y}) has no floor beneath it`);
    }
  }
  for (const m of (def.entities || []).filter((e) => e.t === 'mover')) {
    if (m.axis === 'y' && m.y - m.dist < 1) errors.push(`vertical mover at x=${m.x} rises off the top of the map`);
  }

  return { errors, warnings, notes, segs, top };
}

/* -------------------------------------------------------------------------- */
/*  Emit                                                                       */
/* -------------------------------------------------------------------------- */

function emit(level) {
  const { def, rows, width, height } = level;
  const body = rows.map((r) => `  ${JSON.stringify(r)},`).join('\n');
  const entities = def.entities.length
    ? `\n${def.entities.map((e) => `    ${JSON.stringify(e)},`).join('\n')}\n  `
    : '';

  return `/**
 * Aether Drift — level data.
 *
 * GENERATED FILE — do not edit by hand.
 * Maps live in tools/level-maps/*.txt, dynamic objects in tools/level-maps/meta.json.
 * Rebuild with:  node tools/build-levels.mjs
 *
 * Map legend:  # solid   = one-way platform   ^ hazard   o shard
 *              C checkpoint   P spawn   G goal   . empty
 *
 * Movement envelope the maps are audited against:
 *   ${ENVELOPE.up.toFixed(2)} tiles up · ${ENVELOPE.across.toFixed(2)} tiles across · ${ENVELOPE.padUp.toFixed(2)} tiles on a jump pad
 *   (max jumpable gap ${MAX_GAP} tiles, max climbable step-up ${MAX_RISE} rows)
 */

export const LEVELS = [
${meta.map((m) => {
  const lv = m.id === def.id ? level : parse(m.id);
  const rowsOut = lv.rows.map((r) => `    ${JSON.stringify(r)},`).join('\n');
  const ents = m.entities.length ? `\n${m.entities.map((e) => `      ${JSON.stringify(e)},`).join('\n')}\n    ` : '';
  return `  {
    id: ${JSON.stringify(m.id)},
    name: ${JSON.stringify(m.name)},
    subtitle: ${JSON.stringify(m.subtitle)},
    biome: ${JSON.stringify(m.biome)},
    par: ${m.par},
    hint: ${JSON.stringify(m.hint)},
    width: ${lv.width},
    height: ${lv.height},
    rows: [
${rowsOut}
    ],
    entities: [${ents}],
  },`;
}).join('\n')}
];

export const LEVELS_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

export const TOTAL_SHARDS = LEVELS.reduce((n, l) => n + l.rows.join('').split('o').length - 1, 0);

export { TILE } from './constants.js';
`;
}

/* -------------------------------------------------------------------------- */

const checkOnly = process.argv.includes('--check');
let failed = false;
const built = [];

for (const m of meta) {
  const level = parse(m.id);
  const { errors, warnings, notes, segs } = audit(level);
  const shards = level.rows.join('').split('o').length - 1;
  const checkpoints = level.rows.join('').split('C').length - 1;

  console.log(`\n${m.id}  (${level.width}x${level.height}, ${segs.length} surfaces, ` +
              `${shards} shards, ${checkpoints} checkpoints, par ${m.par}s)`);
  for (const w of warnings) console.log(`  warn   ${w}`);
  if (process.argv.includes('--verbose')) for (const n of notes) console.log(`  note   ${n}`);
  for (const e of errors) { console.log(`  ERROR  ${e}`); failed = true; }
  if (!errors.length && !warnings.length) {
    console.log(`  clean${notes.length ? ` (${notes.length} note(s), --verbose)` : ''}`);
  }
  built.push(level);
}

console.log(`\nenvelope: ${ENVELOPE.up.toFixed(2)} tiles up · ${ENVELOPE.across.toFixed(2)} tiles across ` +
            `· ${ENVELOPE.padUp.toFixed(2)} tiles on a pad`);
console.log(`audit limit: gaps <= ${MAX_GAP} tiles, step-ups <= ${MAX_RISE} rows\n`);

if (failed) {
  console.error('Audit failed — levels.js was not written.');
  process.exit(1);
}

if (!checkOnly) {
  const level = built[0];
  writeFileSync(OUT, emit(level), 'utf8');
  console.log(`wrote ${OUT}`);
}

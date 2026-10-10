/**
 * Aether Drift — tunable constants.
 *
 * Everything below is expressed in pixels and seconds (not frames), so the
 * same numbers behave identically at any refresh rate. Movement values are
 * grouped so the feel of the game can be retuned from one place.
 *
 * Derived envelope (with TILE = 32):
 *   jump height   = JUMP_VELOCITY² / (2 · GRAVITY) ≈ 102px ≈ 3.2 tiles
 *   flat jump run = 2 · |JUMP_VELOCITY| / GRAVITY · RUN_SPEED ≈ 166px ≈ 5.2 tiles
 */

export const TILE = 32;

export const PHYSICS = {
  /* Horizontal */
  RUN_SPEED: 268,
  ACCEL_GROUND: 2600,
  ACCEL_AIR: 1750,
  FRICTION_GROUND: 2900,
  FRICTION_AIR: 420,
  /* Vertical */
  GRAVITY: 2000,
  GRAVITY_APEX: 1500, // reduced gravity near the top of the arc — floatier apex
  APEX_THRESHOLD: 70, // |vy| under which apex gravity applies
  MAX_FALL: 980,
  FALL_GRAVITY_MULT: 1.28, // falling is heavier than rising: snappier landings
  /* Jump */
  JUMP_VELOCITY: -640,
  JUMP_CUT: 0.42, // vy multiplier when the button is released early
  JUMP_CUT_MIN: -180,
  COYOTE_TIME: 0.1,
  JUMP_BUFFER: 0.12,
  MAX_JUMPS: 1,
  /* Moving-platform riding */
  RIDE_EPSILON: 6,
};

export const PLAYER = {
  WIDTH: 20,
  HEIGHT: 28,
  MAX_HEARTS: 3,
  INVULN_TIME: 1.25,
  RESPAWN_DELAY: 0.55,
  DEATH_Y_MARGIN: 12, // tiles below the level floor before a fall counts
  HURT_KNOCKBACK: 190,
  STOMP_BOUNCE: -430,
  PAD_VELOCITY: -1215,
  PAD_POWER_SCALE: 0.28, // extra fraction per pad `power` point above 1
};

export const ENEMY = {
  WALKER_W: 26,
  WALKER_H: 22,
  DRONE_W: 24,
  DRONE_H: 24,
  DRONE_BOB: 0.9,
};

export const CAMERA = {
  LERP: 7.5,
  LOOK_AHEAD: 46,
  LOOK_AHEAD_LERP: 3.2,
  DEADZONE_Y: 34,
  MIN_ZOOM: 0.62,
  MAX_ZOOM: 1.25,
  PADDING: 90, // used when fitting two local players into view
};

export const WORLD = {
  SHARD_VALUE: 1,
  FIXED_STEP: 1 / 120, // physics runs at a fixed 120 Hz
  MAX_STEPS: 8, // catch-up cap: prevents a spiral after a long stall
  RESPAWN_FALL_LIMIT: 3, // tiles of overshoot before a fall is fatal
};

export const VISUAL = {
  AMBIENT_PARTICLES: 46,
  DUST_ON_LAND: 12,
  SPARK_ON_SHARD: 14,
  BURST_ON_HURT: 18,
  SHAKE_DECAY: 7,
  MAX_PARTICLES: 320,
};

/** Per-biome palettes. Each biome is a complete, self-consistent world. */
export const BIOMES = {
  dawn: {
    name: 'Dawn Cliffs',
    sky: ['#1b2a5e', '#5b4a94', '#c96a7a', '#f0a06a'],
    sun: { x: 0.74, y: 0.62, r: 78, color: '#ffcf8a', glow: '#ff9d5c' },
    layers: ['#2a3568', '#3a3f74', '#4d4478'],
    ground: { top: '#7d5f4a', body: '#4a3628', edge: '#8d6a4f' },
    accent: '#ffb02e',
    crystal: '#7fe6ff',
    fog: 'rgba(240, 160, 106, 0.14)',
    ambient: 'rgba(255, 214, 170, 0.55)',
    weather: 'petals',
  },
  sky: {
    name: 'Sky Ruins',
    sky: ['#0a2358', '#134a94', '#2f8fd0', '#8fd4e8'],
    sun: { x: 0.24, y: 0.24, r: 62, color: '#ffffff', glow: '#bfe9ff' },
    layers: ['#17306b', '#1f4a8c', '#2e6fae'],
    ground: { top: '#5f7f9e', body: '#2b3f5c', edge: '#7d9cba' },
    accent: '#00d4ff',
    crystal: '#9ef7ff',
    fog: 'rgba(143, 212, 232, 0.16)',
    ambient: 'rgba(190, 232, 255, 0.5)',
    weather: 'clouds',
  },
  aurora: {
    name: 'The Deep Vault',
    sky: ['#050a1a', '#0b1a3a', '#132a5c', '#1d4a6e'],
    sun: { x: 0.5, y: 0.18, r: 44, color: '#cfe9ff', glow: '#7c5cff' },
    layers: ['#0a1430', '#0e1c40', '#152a55'],
    ground: { top: '#3d3f7a', body: '#1a1c3c', edge: '#5a5ea8' },
    accent: '#7c5cff',
    crystal: '#8affe0',
    fog: 'rgba(124, 92, 255, 0.14)',
    ambient: 'rgba(150, 200, 255, 0.45)',
    weather: 'aurora',
  },
};

/** Player skins. Index 0 is the local player; others are used for P2 / remote. */
export const SKINS = [
  { id: 'drift', name: 'Drift', body: '#1b2a5e', cloak: '#2f6bff', trim: '#00d4ff', scarf: '#00d4ff', lantern: '#ffd27a' },
  { id: 'ember', name: 'Ember', body: '#4a1d2e', cloak: '#ff5c7a', trim: '#ffb02e', scarf: '#ff8a5c', lantern: '#8affe0' },
  { id: 'moss', name: 'Moss', body: '#123a2c', cloak: '#1dbb88', trim: '#8affe0', scarf: '#b8ff9e', lantern: '#ffd27a' },
  { id: 'violet', name: 'Violet', body: '#2a1a4a', cloak: '#7c5cff', trim: '#c9b6ff', scarf: '#9ef7ff', lantern: '#ffd27a' },
];

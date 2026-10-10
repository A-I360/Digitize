/**
 * Contrast test.
 *
 * Reads the real design tokens out of styles/tokens.css and checks the colour
 * pairs the site actually renders against the WCAG 2.1 thresholds. It is here
 * because "dark mode looked a bit low-contrast" is exactly the kind of bug
 * that survives every other test in this repo.
 *
 *   node tests/contrast.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'styles', 'tokens.css'), 'utf8');

/** Pulls the custom properties declared in one ruleset. */
function tokensIn(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ruleset for ${selector}`);
  const end = css.indexOf('}', start);
  const block = css.slice(start, end);
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

const light = tokensIn(':root {');
const dark = tokensIn('html.dark {');

const resolve = (value, scope) => {
  let v = value.trim();
  for (let i = 0; i < 5; i += 1) {
    const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
    if (!m) break;
    v = (scope[m[1]] ?? light[m[1]] ?? '').trim();
  }
  return v;
};

const toRgb = (value) => {
  const hex = value.replace('#', '');
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) throw new Error(`not a hex colour: ${value}`);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (value) => {
  const [r, g, b] = toRgb(value);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* [theme, foreground token, background token, minimum ratio, what it is] */
const PAIRS = [
  ['light', '--text', '--bg', 4.5, 'body copy on the page background'],
  ['light', '--text', '--surface', 4.5, 'body copy on a card'],
  ['light', '--text', '--surface-3', 4.5, 'body copy on a recessed panel'],
  ['light', '--text-2', '--bg', 4.5, 'secondary copy on the page background'],
  ['light', '--text-2', '--surface-2', 4.5, 'secondary copy on a raised panel'],
  ['light', '--text-3', '--bg-alt', 3.0, 'muted caption on the alt background'],
  ['light', '--link', '--bg', 4.5, 'a link in body copy'],
  ['light', '--on-accent', '--accent', 4.5, 'a label on a filled primary button'],
  ['light', '--danger', '--surface', 4.5, 'an inline validation error'],
  ['light', '--mint', '--surface', 4.5, 'a success message'],

  ['dark', '--text', '--bg', 4.5, 'body copy on the page background'],
  ['dark', '--text', '--surface', 4.5, 'body copy on a card'],
  ['dark', '--text', '--surface-3', 4.5, 'body copy on a recessed panel'],
  ['dark', '--text-2', '--bg', 4.5, 'secondary copy on the page background'],
  ['dark', '--text-2', '--surface-3', 4.5, 'secondary copy on a recessed panel'],
  ['dark', '--text-3', '--bg-alt', 3.0, 'muted caption on the alt background'],
  ['dark', '--link', '--bg', 4.5, 'a link in body copy'],
  ['dark', '--link', '--surface', 4.5, 'a link on a card'],
  ['dark', '--on-accent', '--accent', 4.5, 'a label on a filled primary button'],
  ['dark', '--danger', '--surface', 4.5, 'an inline validation error'],
  ['dark', '--mint', '--surface', 4.5, 'a success message'],
];

let failures = 0;
let lastTheme = null;

for (const [theme, fg, bg, min, what] of PAIRS) {
  if (theme !== lastTheme) { console.log(`\n${theme}`); lastTheme = theme; }
  const scope = theme === 'dark' ? { ...light, ...dark } : light;
  const fgValue = resolve(scope[fg] ?? '', scope);
  const bgValue = resolve(scope[bg] ?? '', scope);

  let score;
  let note = '';
  try {
    score = ratio(fgValue, bgValue);
  } catch (error) {
    console.log(`  FAIL  ${what}: ${error.message}`);
    failures += 1;
    continue;
  }
  const ok = score >= min;
  if (!ok) { failures += 1; note = `  ← needs ${min}`; }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${score.toFixed(2).padStart(6)}:1  ${what}${note}`);
}

console.log(`\n${PAIRS.length - failures}/${PAIRS.length} colour pairs meet WCAG AA.`);
if (failures) process.exit(1);

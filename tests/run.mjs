#!/usr/bin/env node
/**
 * Runs the whole suite: level audit, level play-throughs, site crawl and the
 * multiplayer room lifecycle. Exits non-zero if anything fails.
 *
 *   npm test
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITE = [
  ['Level audit', 'tools/build-levels.mjs', ['--check']],
  ['Level play-throughs', 'tests/level-playthrough.mjs', []],
  ['Colour contrast', 'tests/contrast.mjs', []],
  ['Site crawl', 'tests/site.mjs', []],
  ['DOM smoke test', 'tests/dom-smoke.mjs', []],
  ['Site UI', 'tests/site-ui.mjs', []],
  ['Game page UI', 'tests/game-ui.mjs', []],
  ['Online lobby (end to end)', 'tests/online-lobby.mjs', []],
  ['Multiplayer rooms', 'tests/multiplayer.mjs', []],
];

function run(name, script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, '..', script), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ name, code, out, err }));
  });
}

console.log('SYNQ — full test suite\n' + '='.repeat(56));

let failed = 0;
for (const [name, script, args] of SUITE) {
  const { code, out, err } = await run(name, script, args);
  const label = code === 0 ? 'OK  ' : 'FAIL';
  console.log(`\n${label}  ${name}`);
  console.log(out.trim().split('\n').map((l) => `      ${l}`).join('\n'));
  if (err.trim()) console.log(err.trim().split('\n').map((l) => `      ${l}`).join('\n'));
  if (code !== 0) failed += 1;
}

console.log('\n' + '='.repeat(56));
if (failed) {
  console.error(`${failed} of ${SUITE.length} suites failed.`);
  process.exit(1);
}
console.log(`All ${SUITE.length} suites passed.`);

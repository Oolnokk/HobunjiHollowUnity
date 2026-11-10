#!/usr/bin/env node
'use strict';

// Regression for visual foot stepping when traversal owns player position but intentionally zeros vx/vy.
// Exercises the real sample function extracted from game.js, not a reimplemented formula.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); // Loads shipped sources for the isolated gait test.
const game = read('docs/game.js'); // The player update loop and the exact real-travel sampler under test.
const index = read('docs/index.html'); // Ensures mobile browsers receive the newly changed game runtime.
const begin = game.indexOf('      function samplePlayerGaitSpeed('); // Start of the live, pure visual-gait sampler.
const end = game.indexOf("\n      window.DevCompanion?.registerStateProvider?.('playerGait'", begin); // End immediately after the sampler, before game globals are accessed.
assert(begin >= 0 && end > begin, 'game must expose the real-distance foot gait sampler');
const samplerSource = game.slice(begin, end); // Evaluates the shipped function without needing to boot the entire game.
const state = { area: null, x: NaN, y: NaN, speed: 0, reportedSpeed: 0, source: 'uninitialized' }; // Same shape as the live per-player sample.
const TILE = 55; // Real tile size, used to check pixel-to-tile speed conversion.
const sample = new Function('playerGaitTravel', 'TILE', samplerSource + '\nreturn samplePlayerGaitSpeed;')(state, TILE); // Injects only the same two free bindings as game.js.
const dt = 1 / 20; // Simulates a valid frame that moves 1/20 of a second.

assert.equal(sample('map_western_slope', 200, 200, dt, 0), 0, 'first frame is grounded and idle');
assert.equal(state.source, 'reset', 'initial area is not compared against stale positions');
assert(Math.abs(sample('map_western_slope', 200 + 4 * TILE * dt, 200, dt, 0) - 4) < 1e-9,
  'raised Western Slope support walking animates at real speed despite zero player velocity');
assert.equal(state.source, 'travel', 'mobile diagnostics identify the physical-travel source');
assert.equal(state.reportedSpeed, 0, 'the moving-support case actually preserved zero gameplay velocity');
assert.equal(sample('map_western_slope', state.x, state.y, dt, 5), 0,
  'a player pushing into solid terrain cannot walk in place just because vx/vy remain nonzero');

assert.equal(sample('map_i_dev_random_ruin', 5000, 4000, dt, 0), 0,
  'entering a ruin does not animate the teleport distance from the Western Slope');
assert(Math.abs(sample('map_i_dev_random_ruin', 5000, 4000 + 3.2 * TILE * dt, dt, 0) - 3.2) < 1e-9,
  'moving across elevated ruin props advances the feet even while native velocity is zero');
assert.equal(sample('map_i_dev_random_ruin', 5000 + 25 * TILE, 4000, dt, 0), 0,
  'checkpoint warps inside the same ruin do not trigger a massive running gait');
assert.equal(state.source, 'teleport', 'diagnostics identify same-area teleports');
assert.equal(sample('map_i_dev_random_ruin', state.x, state.y, 0, 2.5), 2.5,
  'zero elapsed time uses reported velocity and never divides by zero');
const x = state.x; // Current position for the fast-buffed grounded movement case.
assert(Math.abs(sample('map_i_dev_random_ruin', x + 13 * TILE * dt, state.y, dt, 6) - 13) < 1e-9,
  'realized fast movement is not erroneously discarded as a checkpoint teleport');
assert(game.includes('playerLegs?.update(dt, gaitSpeed, legsSuppressed, seatedPose, {'),
  'the main player leg rig receives the measured gait, not the obsolete raw velocity');
assert(game.includes("player._freeJump.phase !== 'supported'"),
  'rope and free-flight modes cannot accidentally walk in midair');
assert(index.includes('<script src="game.js?v=20261109feetTravel1"></script>'),
  'game script cache key must change with the shipped foot gait fix');
console.log('player foot gait from real travel: all checks passed');

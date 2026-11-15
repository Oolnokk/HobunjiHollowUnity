#!/usr/bin/env node
'use strict';

// Run the real normal-walking acceleration block extracted from game.js:
// avoidance must change physical velocity, not player aiming or input intent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const window = { FormatUtils: { clamp: (n, a, b) => Math.max(a, Math.min(b, n)) } };
const context = vm.createContext({ window, Math });
for (const name of ['tile-pathfinding', 'ground-obstacle-avoidance']) {
  vm.runInContext(read('docs/js/' + name + '.js'), context, { filename: name + '.js' });
}
const game = read('docs/game.js');
const start = game.indexOf('        const crawlMotion = window.PlayerCrawl?.isCrawling?.()');
const end = game.indexOf('        // ── Axis-separated collision', start);
assert(start > 0 && end > start, 'walking assistance stays inside ordinary, native acceleration');
const nativeMovement = new Function('window', 'player', 'currentArea', 'TILE', 'playerAutoWalk',
  'inputStrength', 'ix', 'iy', 'targetSpeed', 'dt', 'ACCEL', 'TURN_ACCEL', 'DECEL',
  'footingSpeedMul', 'icePhysics', 'speedMul', 'canPlayerOccupy',
  game.slice(start, end) + '\nreturn { vx: player.vx, vy: player.vy };'); // Executes production walking velocity logic.

const TILE = 64; // Representative real-world tile pixel size for the collision fixture.
const rock = new Set(['6,6']); // One tree/rock-sized obstacle directly east of the walking player.
function free(x, y) {
  if (x < TILE || y < TILE || x >= 13 * TILE || y >= 13 * TILE) return false;
  return [[-10, -10], [10, -10], [-10, 10], [10, 10]]
    .every(([dx, dy]) => !rock.has(Math.floor((x + dx) / TILE) + ',' + Math.floor((y + dy) / TILE)));
}
function step(x, y, dx, dy, opts = {}) {
  const player = { x, y, vx: 0, vy: 0, angle: 0 }; // Isolated velocity source, reset per input mode comparison.
  const result = nativeMovement(window, player, 'field', TILE, !!opts.autoWalk,
    Math.hypot(dx, dy), dx, dy, 238, 1 / 60, 900, 1300, 900,
    1, opts.ice ?? null, 1, free);
  return { ...result, player };
}
const straight = step(3.5 * TILE, 6.5 * TILE, 1, 0);
assert(straight.vx > 0 && Math.abs(straight.vy) < 1e-8,
  'open ground leaves normal acceleration completely unchanged');

const assisted = step(5.1 * TILE, 6.5 * TILE, 1, 0);
assert(assisted.vx > 0 && assisted.vy > 0, 'real player acceleration turns gently around a nearby rock');
assert(Math.atan2(Math.abs(assisted.vy), assisted.vx) <= Math.PI / 7 + 1e-8,
  'the actual accelerated velocity respects the subtle on-foot correction limit');
assert.equal(assisted.player.angle, 0, 'assistance never rotates player aim/facing');
const intent = window.GroundObstacleAvoidance.debugSnapshot().foot;
assert.equal(intent.status, 'detouring', 'Pixel Probe can inspect the active walking detour');

// Ice and explicit auto-walk have independent movement authorities. Their
// native acceleration should not consume stale manual steering waypoints.
const ice = step(5.1 * TILE, 6.5 * TILE, 1, 0, {
  ice: { accelerationFactor: 0.5, turningFactor: 0.5, retention20Hz: 0.95 },
});
assert.equal(ice.vy, 0, 'ice preserves straight native traction movement');
assert.equal(window.GroundObstacleAvoidance.debugSnapshot().foot.status, 'idle',
  'entering ice immediately drops prior manual detour state');
const auto = step(5.1 * TILE, 6.5 * TILE, 1, 0, { autoWalk: true });
assert.equal(auto.vy, 0, 'auto-walk pathing stays separate from manual avoidance');

console.log('player ground obstacle integration checks passed');

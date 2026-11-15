#!/usr/bin/env node
'use strict';

// Exercise the real mounted movement loop, not just the pure steering helper.
// Reuses the same authored mount-state transitions as test-mounted-climb-leap.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const TILE = 64; // World tile scale used by the fake rock and player collision footprints.
const rock = new Set(['6,6']); // The obstacle the mounted carrier must go around without clipping.
const footRadius = 10; // Matches a representative canPlayerOccupy footprint, not a point-only ray.
function free(x, y) {
  if (x < TILE || y < TILE || x >= 14 * TILE || y >= 14 * TILE) return false;
  return [[-footRadius, -footRadius], [footRadius, -footRadius],
    [-footRadius, footRadius], [footRadius, footRadius]]
    .every(([dx, dy]) => !rock.has(Math.floor((x + dx) / TILE) + ',' + Math.floor((y + dy) / TILE)));
}

const player = { x: 3.5 * TILE, y: 6.5 * TILE, angle: 0, vx: 0, vy: 0 }; // Rider state mirrors mount carrier state.
const input = { x: 0, y: 0 }; // Mutable manual movement source consumed by Mounts.updateMountedMovement.
const window = {
  __farmLog() {},
  AudioSystem: {
    footstepAdvance() { return false; }, resetCreatureGait() {},
    playObjectSfx() {}, objectSfxConfig() { return {}; },
    footstepTileAt() { return { type: 'grass' }; },
    footstepSurfaceKey() { return 'grass'; }, playFootstepSfx() {},
  },
  ResourceRings: null,
};
const context = vm.createContext({ window, performance: { now: () => 0 }, Math });
for (const name of ['tile-pathfinding', 'ground-obstacle-avoidance', 'mount-system']) {
  vm.runInContext(read('docs/js/' + name + '.js'), context, { filename: name + '.js' });
}
const deps = {
  player, scene: {}, companionObjects: new Set(),
  getStable: () => [{ id: 'horse1', kind: 'horse' }],
  CREATURE_DB: { horse: { mountSpeed: 340, sprites: { run: ['a', 'b'] } } },
  input, btnCallMount: { classList: { toggle() {}, add() {}, remove() {} } },
  TILE, PLAYER_RADIUS: 12, FACING_LERP: 8, MOVE_SPEED: 238, ACCEL: 900, DECEL: 900,
  MOUSE_IDLE_MS: 2000, isDesktop: true, rnd: () => 0.5,
  clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
  angleDiff: (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b)),
  canPlayerOccupy: free,
  getAlchemySpeedMul: () => 1,
  getKeyboardVector: () => ({ active: false, x: 0, y: 0 }),
  makeCreatureEntity: (kind, x, y, opts) => ({
    kind, x, y, vx: 0, vy: 0, health: 100, facing: 0,
    def: { mountSpeed: 340, sprites: { run: ['a', 'b'] } },
    areaId: 'field', avatarRef: { group: { position: { set() {} } } }, ...opts,
  }),
  despawnCreature() {},
  moveCreatureToward: (entity, x, y) => { entity.x = x; entity.y = y; return true; },
  updateCreatureMesh() {}, updateCreatureAnimFrame() {},
  tileSurfaceYInArea: () => 0, characterGroundShadowSurfaceOffset: () => 0,
  getActiveScene: () => ({ add() {} }),
  getActiveGrid: () => Array.from({ length: 14 }, () => Array.from({ length: 14 }, () => ({ type: 'grass' }))),
  getActiveCols: () => 14, getActiveRows: () => 14,
  _isZoneArea: () => true, _isCavernBuildingArea: () => false,
  showToast() {}, getCurrentArea: () => 'field', getActiveMountId: () => 'horse1',
  getDevGlobalSpeedMul: () => 1,
  getFacingAngle: () => player.angle, setFacingAngle: angle => { player.angle = angle; },
  getMouseLookActive: () => false, setMouseLookActive() {},
  getControllerLookActive: () => false, getControllerLookAngle: () => 0,
  getLastMouseMoveTime: () => 0, getMouseLookAngle: () => 0,
  isShoulderSurfMode: () => false, cameraFacingAngleRad: () => 0,
};
window.Mounts.init(deps);
window.Mounts.toggleMount();
window.Mounts.updateMountRide(0.1);
window.Mounts.updateMountRide(1);
assert.equal(window.Mounts.rideState, 'mounted', 'mount reaches steady ride state');
const mount = window.Mounts.rideEntity;
mount.x = player.x; mount.y = player.y; // Start east of free terrain and west of one obstructing rock.
input.x = 1;
let redirected = false; // Checks the real mount angular response to a route-bearing change.
let clearedRock = false; // Checks forward progress after a lateral path segment.
for (let frame = 0; frame < 360; frame++) {
  window.Mounts.updateMountedMovement(1 / 60);
  assert(free(mount.x, mount.y), 'carrier never overlaps the rock or map boundary');
  assert.equal(player.x, mount.x, 'the player follows the final obstacle-corrected carrier X');
  assert.equal(player.y, mount.y, 'the player follows the final obstacle-corrected carrier Y');
  if (Math.abs(mount.y - 6.5 * TILE) > 12) redirected = true;
  if (mount.x > 9 * TILE) { clearedRock = true; break; }
}
assert(redirected, 'mount visibly steers around the solid rock');
assert(clearedRock, 'held forward input reaches clear tiles beyond the obstacle');

input.x = 0; // On release, route memory must be discarded without fighting normal mount deceleration.
window.Mounts.updateMountedMovement(1 / 60);
assert.equal(window.GroundObstacleAvoidance.debugSnapshot().mounted.status, 'idle',
  'releasing movement immediately clears the cached mounted path');

console.log('mounted ground obstacle integration checks passed');

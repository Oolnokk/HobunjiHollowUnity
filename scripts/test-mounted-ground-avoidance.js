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

input.x = 0; // Releasing the reins now preserves autonomous forward cruise and routing.
const releasedX = mount.x;
window.Mounts.updateMountedMovement(1 / 60);
assert(mount.x > releasedX, 'mount continues traveling forward when directional input is released');
assert.notEqual(window.GroundObstacleAvoidance.debugSnapshot().mounted.status, 'idle',
  'the autonomous route remains active instead of resetting when reins are released');


// Reuse the same live mounted-state fixture for a real town bridge vertical
// integration pass (rather than checking a string/regular expression only).
deps.getCurrentArea = () => 'town'; // Reuse the same carrier while switching only the sampled terrain authority.
player.x = mount.x = 3.5 * TILE;
player.y = mount.y = 6.5 * TILE;
player.physicalFeetY = 0.08;
mount.areaId = 'town';
mount.groundLift = mount.halfHeight = 0.5; // Representative authored creature-root height used by the rider pin.
const position = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }); // Real avatar roots expose this THREE.Vector3 interface.
mount.avatarRef.group.position = position();
deps.updateCreatureMesh = creature => {
  const override = Number(creature.surfaceYOverride?.()); // The real game's creature renderer consumes this exact world floor override.
  const floor = Number.isFinite(override) ? override : 0;
  creature.avatarRef.group.position.set(creature.x / TILE, floor + creature.groundLift, creature.y / TILE);
};
window.HobunjiTownSubtleElevation = { sampleHeightAt() { return 0.08; } }; // Continuous town ground contour, below the bridge treads.
const townSupportQueries = []; // Ensures the mount passes the correct absolute ground and maximum reachable height.
window.HobunjiWalkableElevation = { worldSurfaceTopAt(x, z, ground, area, maxTopY) {
  townSupportQueries.push({ x, z, ground, area, maxTopY });
  const tread = x >= 7 && x < 9 ? 0.62 : x >= 6 && x < 7 ? 0.4 : x >= 5 && x < 6 ? 0.2 : null; // Two reachable stairs and the flat bridge deck.
  return tread !== null && tread <= maxTopY + 0.025 ? Math.max(ground, tread) : ground;
} };
window.HobunjiAnimalSubtleElevation = { totalLiftAt(x, z, area) {
  return area === 'farm' ? 0.31 : 1.4; // A deliberately huge town render-only delta must NEVER lift the physically grounded horse.
} };
const rider = { position: position() }; // Rendered player root, pinned after the horse's creature renderer.
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' != ' + expected);
function checkTownBridge(x, floor) {
  mount.x = x * TILE;
  mount.y = 6.5 * TILE;
  window.Mounts.updateMountRide(1 / 60); // Real mounted creature update executes the authored surface override.
  assert.equal(window.Mounts.pinMountedRiderMesh(rider, 0.7), true);
  near(mount._mountedTownSurfaceY, floor, 'mount footing at x=' + x);
  near(mount.avatarRef.group.position.y, floor + 0.5, 'mount body at x=' + x);
  near(rider.position.y, floor + 0.7, 'rider seated at x=' + x);
  near(player.physicalFeetY, floor, 'rider physical ground at x=' + x);
  near(window.Mounts.renderSync.visualLiftY, 0, 'town mount has no late animal render lift');
}
checkTownBridge(3.5, 0.08);
checkTownBridge(7.5, 0.08); // A deck overhead is NOT a reachable floor to an animal underneath it.
checkTownBridge(5.5, 0.2);  // First physical stair.
checkTownBridge(6.5, 0.4);  // Next stair climbs from previous feet, not from flat water below.
checkTownBridge(7.5, 0.62); // Deck absolute world top — never town terrain + deck top.
checkTownBridge(9.5, 0.08); // Descending off the bridge releases the support.
assert(townSupportQueries.every(q => q.area === 'town' && Math.abs(q.ground - 0.08) < 1e-9),
  'town terrain height is not added again after worldSurfaceTopAt');
// Exercise all EIGHT real 0.25-tile stair treads, not only the reduced two-tread
// illustration above. The creature renderer intentionally smooths XZ/Y at
// different rates; mount alignment must use the visual feet's XZ and not lag
// through the stairs at accelerated riding speed and 24 FPS.
const bridgeRecipe = JSON.parse(read('docs/config/furniture-authored/townStairBridge.json')); // Exact in-game furniture source, including both four-step flights.
const deckTop = bridgeRecipe.parts.find(part => part.name === 'Flat bridge deck (stretchable)'); // Uses authored deck top and expansion of the bridge's middle span.
const walkableBridgeParts = bridgeRecipe.parts.filter(part => part.walkableElevation); // Excludes decorative collision railings from the supporting floor.
assert.equal(walkableBridgeParts.length, 9, 'actual bridge has eight stair treads and one deck');
function authoredBridgeTopAt(x) {
  const localX = x - 9; // The virtual 8-tile bridge runs from world X=5 to X=13.
  let top = null;
  for (const part of walkableBridgeParts) {
    const shift = part.tileSpanRole === 'start' ? -2 : part.tileSpanRole === 'end' ? 2 : 0; // 8-tile span adds two units on each side.
    const width = part.transform.sx + (part === deckTop ? 4 : 0); // Only the middle deck is stretched.
    const center = part.transform.x + shift;
    if (localX < center - width / 2 - 0.0001 || localX > center + width / 2 + 0.0001) continue;
    const topY = 0.08 + part.transform.y + part.transform.sy / 2; // Bridge placement sits at world ground 0.08.
    top = Math.max(top ?? -Infinity, topY);
  }
  return top;
}
window.HobunjiWalkableElevation.worldSurfaceTopAt = (x, z, ground, area, ceiling) => {
  const support = authoredBridgeTopAt(x); // All narrow steps resolve by authored physical top, not their bounding box.
  return support !== null && support <= ceiling + 0.025 ? Math.max(ground, support) : ground;
};
const startX = 4.8; // Outside the first real tread, slightly before the west landing.
mount.x = startX * TILE; mount.y = 6.5 * TILE;
player.x = mount.x; player.y = mount.y; player.physicalFeetY = 0.08;
mount.avatarRef.group.position.set(startX, 0.58, 6.5);
deps.updateCreatureMesh = (creature, dt) => {
  const targetX = creature.x / TILE;
  const override = Number(creature.surfaceYOverride?.()); // Production renderer uses exact floor as the target.
  const targetY = (Number.isFinite(override) ? override : 0) + creature.groundLift;
  const group = creature.avatarRef.group.position;
  group.x += (targetX - group.x) * Math.min(1, dt * 10); // Real creature's smoothed horizontal visual transform.
  group.z += (creature.y / TILE - group.z) * Math.min(1, dt * 10);
  group.y += (targetY - group.y) * Math.min(1, dt * 7); // This would clip into bridge steps without the new exact-contact correction.
};
const dtBridge = 1 / 24; // Known slow-frame condition while boosting.
const boostedTileStep = 340 * 1.42 * dtBridge / TILE; // Boosted speed can skip one authored tread in a single 24 FPS physics step.
let checkedStairFrames = 0; // Proves the new render clamp was exercised at multiple intermediate physical steps.
for (let x = startX + boostedTileStep; x < 13.1; x += boostedTileStep) {
  mount.x = x * TILE;
  player.x = mount.x; // Carrier owns logical XZ during the whole ride.
  window.Mounts.updateMountRide(dtBridge);
  window.Mounts.pinMountedRiderMesh(rider, 0.7);
  const logicalTop = authoredBridgeTopAt(x);
  if (logicalTop !== null) {
    near(mount._mountedTownSurfaceY, logicalTop, 'boosted mount reaches each actual stair/deck top at x=' + x);
    checkedStairFrames++;
  }
  const visibleX = mount.avatarRef.group.position.x;
  const visibleTop = authoredBridgeTopAt(visibleX);
  if (visibleTop !== null) {
    near(mount.avatarRef.group.position.y, visibleTop + 0.5,
      'smoothed animal visual feet cannot sink into the real bridge at x=' + visibleX);
  }
  near(rider.position.y - mount.avatarRef.group.position.y, 0.2,
    'mounted rider remains seated over final visible animal root even on 24 FPS stair crossings');
}
assert(checkedStairFrames >= 12, 'crossed both authored four-stair flights and the full deck at boosted speed');

mount.areaId = 'farm';
assert(Number.isNaN(Number(mount.surfaceYOverride())), 'outside town the creature retains its original surface ownership');
assert.equal(mount._mountedTownSurfaceActive, false, 'farm re-enables the animal visual elevation hook');
mount.avatarRef.group.position.y = 0.5;
window.Mounts.pinMountedRiderMesh(rider, 0.7);
near(rider.position.y, 1.01, 'farm rider mirrors the mount visual lift applied after rider pinning');
near(window.Mounts.renderSync.visualLiftY, 0.31, 'visual lift diagnostics expose farm offset');
const animalElevationSource = read('docs/js/animal-subtle-elevation-bridge.js'); // Guards against a future renderer hook undoing the correct town footing.
assert.match(animalElevationSource, /actor === window\.Mounts\?\.rideEntity && actor\._mountedTownSurfaceActive === true/,
  'town mount must skip the late animal render-only elevation hook');

console.log('mounted ground avoidance, town bridge stairs/deck and rider grounding integration checks passed');

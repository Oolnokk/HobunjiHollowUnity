#!/usr/bin/env node
'use strict';

// Runtime-drives docs/js/mount-system.js in an isolated vm context, taking a
// summoned mount all the way from 'none' through 'mounted', then through a
// full startClimbLeap/updateClimbLeap crossing, to verify the actual state
// machine and position/elevation math end to end (not just source shape).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const TILE = 64;

const player = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
const companionObjects = new Set();

let locks = []; // {token, participants:[{id,channels}]}
let nextToken = 1;
const CharacterActionLocks = {
  acquire(options) {
    const token = `lock-${nextToken++}`;
    const channels = options.channels || ['movement', 'tools', 'actions'];
    const record = { token, participants: (options.participants || []).map(id => ({ id, channels })) };
    locks.push(record);
    return { token, release: () => { locks = locks.filter(l => l.token !== token); } };
  },
  isLocked(participantId, channel) {
    return locks.some(l => l.participants.some(p => p.id === participantId && p.channels.includes(channel)));
  },
};

const objectSfxCalls = [];
const AudioSystem = {
  resetCreatureGait() {},
  playObjectSfx: (cfg) => objectSfxCalls.push(cfg),
  objectSfxConfig: () => ({ climbStep: { url: 'climbstep.mp3' } }),
  footstepAdvance() { return false; },
};

// 20x20 grid: elevTier 0 everywhere except a plateau (elevTier 1, rows 0-9)
// separated from the ground (rows 11-19) by a row of incline tiles (row 10)
// — mirrors mergeZoneTiles' auto-reserved incline wall between elevation
// tiers that ClimbSystem's getWallClimbTarget crosses.
const COLS = 20, ROWS = 20;
function makeGrid() {
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      if (r < 10) row.push({ type: 'grass', elevTier: 1 });
      else if (r === 10) row.push({ type: 'grass', elevTier: 1, incline: true });
      else row.push({ type: 'grass', elevTier: 0 });
    }
    grid.push(row);
  }
  return grid;
}
const grid = makeGrid();
function tileSurfaceYInArea(tile) { return (tile.elevTier || 0) * 3; } // 3 world units per elevation tier, same shape as the real game's per-tier rise.

function makeCreatureEntity(kind, x, y, opts) {
  return {
    kind, x, y, vx: 0, vy: 0, health: 100, maxHealth: 100,
    facing: 0, scaleY: 1, groundLift: 0.5, halfHeight: 0.5,
    areaId: 'wilderness_test',
    avatarRef: { group: { position: { x: 0, y: 0, z: 0 } } },
    def: { mountSpeed: 340 },
    ...opts,
  };
}

const updateCreatureMeshCalls = [];
function updateCreatureMesh(c, dt, aimAngle) {
  // Mirrors game.js's own surfY ternary contract: onBranch/_climbLeap override
  // the raw tile lookup. We don't re-derive the full render pipeline here —
  // just record what a real updateCreatureMesh would need to read.
  const surfY = c.onBranch ? c.branchSurfaceY
    : c._climbLeap ? c._climbLeap.surfaceY
    : tileSurfaceYInArea(grid[Math.floor(c.y / TILE)]?.[Math.floor(c.x / TILE)] || { elevTier: 0 });
  const ty = surfY + (c.groundLift ?? c.halfHeight) * (c.scaleY ?? 1) + (c._banditLungeHopCurrent || 0);
  c.avatarRef.group.position.x = c.x / TILE;
  c.avatarRef.group.position.z = c.y / TILE;
  c.avatarRef.group.position.y = ty;
  updateCreatureMeshCalls.push({ x: c.x, y: c.y, scaleY: c.scaleY, hop: c._banditLungeHopCurrent || 0, surfY, ty });
}

let despawned = null;
const deps = {
  player, scene: {}, companionObjects,
  getStable: () => [{ id: 'stable_test_mount', kind: 'dabinggi-hound' }],
  CREATURE_DB: { 'dabinggi-hound': { mountSpeed: 340 } },
  input: { x: 0, y: 0 },
  btnCallMount: { classList: { toggle() {}, add() {}, remove() {} } },
  TILE, PLAYER_RADIUS: 12, FACING_LERP: 8, MOVE_SPEED: 238, ACCEL: 900, DECEL: 900,
  MOUSE_IDLE_MS: 2000, isDesktop: true,
  rnd: () => 0.5,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  angleDiff: (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; },
  canPlayerOccupy: () => true,
  getAlchemySpeedMul: () => 1,
  getKeyboardVector: () => ({ active: false, x: 0, y: 0 }),
  makeCreatureEntity,
  despawnCreature: (m) => { despawned = m; },
  moveCreatureToward: (entity, tx, ty) => { entity.x = tx; entity.y = ty; return true; }, // instant-snap stand-in; only the resulting state machine progression is under test here
  updateCreatureMesh,
  updateCreatureAnimFrame: () => {},
  tileSurfaceYInArea: (tile) => tileSurfaceYInArea(tile),
  characterGroundShadowSurfaceOffset: () => 0.02,
  getActiveScene: () => ({}),
  getActiveGrid: () => grid,
  getActiveCols: () => COLS,
  getActiveRows: () => ROWS,
  _isZoneArea: () => true,
  _isCavernBuildingArea: () => false,
  showToast: () => {},
  getCurrentArea: () => 'wilderness_test',
  getActiveMountId: () => 'stable_test_mount',
  getDevGlobalSpeedMul: () => 1,
  getFacingAngle: () => player.angle,
  setFacingAngle: (v) => { player.angle = v; },
  getMouseLookActive: () => false,
  setMouseLookActive: () => {},
  getControllerLookActive: () => false,
  getControllerLookAngle: () => 0,
  getLastMouseMoveTime: () => 0,
  getMouseLookAngle: () => 0,
  isShoulderSurfMode: () => false,
  cameraFacingAngleRad: () => 0,
};

const context = {
  console, Math, Number, Object, Array, JSON, Map, Set, Date,
  performance: { now: () => Date.now() },
  window: {},
};
context.window.window = context.window;
context.window.CharacterActionLocks = CharacterActionLocks;
context.window.AudioSystem = AudioSystem;
context.window.__farmLog = () => {};
context.window.ResourceRings = null;
vm.createContext(context);
vm.runInContext(read('docs/js/mount-system.js'), context, { filename: 'mount-system.js' });
context.window.Mounts.init(deps);

// ── Drive the mount all the way to 'mounted' ──────────────────────────
player.x = 5 * TILE; player.y = 15 * TILE; // solid ground, well below the incline row
context.window.Mounts.toggleMount(); // -> rushingIn
assert.equal(context.window.Mounts.rideState, 'rushingIn', 'summon starts the rush-in phase');
context.window.Mounts.updateMountRide(0.1); // moveCreatureToward snaps the mount to the player, closing the arrival check in one tick
assert.equal(context.window.Mounts.rideState, 'mountingUp', 'mount arrives and the rider begins lerping up');
context.window.Mounts.updateMountRide(1); // 1s comfortably clears MOUNT_TRANSITION_S (0.35s)
assert.equal(context.window.Mounts.rideState, 'mounted', 'mount settles into steady riding');
const m = context.window.Mounts.rideEntity;
assert(m, 'a rideEntity exists once mounted');

// ── Face the incline wall and trigger the leap ────────────────────────
m.x = 5 * TILE; m.y = (10.9) * TILE; // one tile of solid ground short of the incline row (row 10), matching getWallClimbTarget's own "start off the incline" requirement
const climb = {
  type: 'wall', dir: { x: 0, y: -1 }, landCol: 5, landRow: 9,
  startElevTier: 0, landElevTier: 1, wallTiles: 1,
};

assert.equal(context.window.CharacterActionLocks.isLocked('player', 'movement'), false, 'player movement is unlocked before the leap');
const started = context.window.Mounts.startClimbLeap(climb);
assert.equal(started, true, 'startClimbLeap accepts a wall climb target while steadily mounted');
assert.equal(context.window.Mounts.rideState, 'climbLeap', 'ride state switches to the scripted leap');
assert.equal(context.window.CharacterActionLocks.isLocked('player', 'movement'), true, 'player movement locks for the duration of the leap, same as any other scripted crossing');
assert.equal(context.window.CharacterActionLocks.isLocked('player', 'actions'), true, 'actions lock too, so climb/dodge cannot be re-triggered mid-leap');

// Reject a second leap while one is already in progress (mountRideState is no longer 'mounted').
assert.equal(context.window.Mounts.startClimbLeap(climb), false, 'a leap cannot be re-triggered while one is already playing');

let sawCrouch = false;
let sawArc = false;
let ticks = 0;
const startX = m.x, startY = m.y;
while (context.window.Mounts.rideState === 'climbLeap' && ticks < 500) {
  context.window.Mounts.updateMountRide(1 / 60);
  if (m.scaleY < 0.95) sawCrouch = true;
  if ((m._banditLungeHopCurrent || 0) > 0.05) sawArc = true;
  // The mount must never be left mid-air with the pre-leap tile's elevation
  // once it has actually started moving away from the start tile.
  ticks++;
}
assert(ticks < 500, 'the leap actually completes within a bounded number of frames instead of hanging');
assert(sawCrouch, 'the windup stage visibly crouches the mount before it leaps, matching Pounce\'s own windup');
assert(sawArc, 'the leap stage adds a rising arc on top of the straight elevation lerp');

assert.equal(context.window.Mounts.rideState, 'mounted', 'ride state returns to steady riding once the leap lands');
assert.equal(m.scaleY, 1, 'the mount is back to its normal scale after landing');
assert.equal(m._banditLungeHopCurrent, 0, 'the arc offset is cleared after landing');
assert.equal(m._climbLeap, null, 'the leap state is cleared after landing');
assert.equal(m.x, (climb.landCol + 0.5) * TILE, 'the mount lands exactly on the landing tile center X, the same tile a dismounted climb would land on');
assert.equal(m.y, (climb.landRow + 0.5) * TILE, 'the mount lands exactly on the landing tile center Y');
assert.equal(player.x, m.x, 'the rider tracks the mount\'s X throughout and after the leap');
assert.equal(player.y, m.y, 'the rider tracks the mount\'s Y throughout and after the leap');
assert.equal(context.window.CharacterActionLocks.isLocked('player', 'movement'), false, 'the movement lock is released once the leap completes');
assert(objectSfxCalls.some(cfg => cfg?.url === 'climbstep.mp3'), 'landing plays the same climb-step cue a dismounted climb uses');
assert(m.x !== startX || m.y !== startY, 'the mount actually traveled from the base of the wall to the top');

// ── pinMountedRiderMesh must keep working (not just the movement/mesh path) while climbLeap is active ──
m.x = 5 * TILE; m.y = 9.9 * TILE;
const climbBack = { type: 'wall', dir: { x: 0, y: 1 }, landCol: 5, landRow: 11, startElevTier: 1, landElevTier: 0, wallTiles: 1 };
context.window.Mounts.startClimbLeap(climbBack);
context.window.Mounts.updateMountRide(1 / 60);
assert.equal(context.window.Mounts.rideState, 'climbLeap', 'a second, downward leap starts cleanly after the first one finished');
const riderMesh = { position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
const pinned = context.window.Mounts.pinMountedRiderMesh(riderMesh, 0.2);
assert.equal(pinned, true, 'the rider mesh still pins to the mount carrier mid-leap, not just in steady mounted state');
assert.equal(riderMesh.position.x, m.avatarRef.group.position.x, 'the pinned rider tracks the mount carrier X mid-leap');
assert.equal(riderMesh.position.z, m.avatarRef.group.position.z, 'the pinned rider tracks the mount carrier Z mid-leap');

// Let the downward leap finish and confirm it lands on the lower tile.
ticks = 0;
while (context.window.Mounts.rideState === 'climbLeap' && ticks < 500) { context.window.Mounts.updateMountRide(1 / 60); ticks++; }
assert.equal(m.x, (climbBack.landCol + 0.5) * TILE, 'the downward leap also lands exactly on its landing tile center X');
assert.equal(m.y, (climbBack.landRow + 0.5) * TILE, 'the downward leap also lands exactly on its landing tile center Y');

assert.equal(despawned, null, 'nothing about the leap itself despawns the mount');

console.log('mounted climb leap checks passed');

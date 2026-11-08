#!/usr/bin/env node
'use strict';

// Cliff climbing: fast jump-down descents, cancel-by-moving-backward drops,
// map-boundary escarpments that can't be climbed/entered/spawned on, and
// hostiles that climb after the player and get shot off the face.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const TILE = 64;
const context = { window: {}, Date, performance: { now: () => 0 }, queueMicrotask };
context.window.window = context.window;
vm.runInNewContext(fs.readFileSync('docs/js/map-boundary-guard.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/climb-system.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/creature-cliff-climb.js', 'utf8'), context);
const { ClimbSystem, CreatureCliffClimb, MapBoundaryGuard } = context.window;

// ground(0) | wall | wall | plateau(1) | plateau(1) | boundary wall | boundary top
function makeGrid() {
  return [[
    { type: 'grass', elevTier: 0 },
    { type: 'grass', elevTier: 0, incline: true },
    { type: 'grass', elevTier: 0, incline: true },
    { type: 'grass', elevTier: 1 },
    { type: 'grass', elevTier: 1 },
    { type: 'grass', elevTier: 1, incline: true, mapBoundary: true },
    { type: 'grass', elevTier: 3, mapBoundary: true },
  ]];
}
let grid = makeGrid();
let moveInput = { x: 0, y: 0 };
const player = { x: TILE * 0.5, y: TILE * 0.5, angle: 0, climbing: false, vx: 0, vy: 0, health: 10 };
const facingCardinal = angle => Math.cos(angle) >= 0 ? { x: 1, y: 0, name: 'east' } : { x: -1, y: 0, name: 'west' };
ClimbSystem.init({
  _isZoneArea: () => true,
  getCurrentArea: () => 'zone',
  player,
  facingCardinal,
  getActiveGrid: () => grid,
  getActiveCols: () => grid[0].length,
  getActiveRows: () => 1,
  TILE,
  isSolid: () => false,
  tileSurfaceYInArea: tile => (tile.elevTier || 0) * 2,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  getMountRideState: () => 'none',
  showToast() {},
  setFacingAngle() {}, setTargetAimAngle() {}, setLastMoveAngle() {},
  getMovementInput: () => moveInput,
});
function runClimb(maxS = 5, step = 1 / 60) {
  for (let t = 0; t < maxS && player.climbing; t += step) ClimbSystem.updateClimb(step);
}

// --- Ascent, then cancel by moving backward -------------------------------
let target = ClimbSystem.getClimbTarget();
assert.equal(target?.type, 'wall', 'facing the plateau wall offers a climb');
assert.equal(target.descending, false, 'ground -> plateau is an ascent');
assert.equal(ClimbSystem.startClimb(target), true);
assert.equal(player.climbHopCount, 3, 'ascent keeps the staggered hop climb');
for (let i = 0; i < 20; i++) ClimbSystem.updateClimb(1 / 60);
assert(player.climbSurfaceY > 0, 'partway up the face');
moveInput = { x: -1, y: 0 }; // Away from the wall.
for (let i = 0; i < 12; i++) ClimbSystem.updateClimb(1 / 60);
assert.equal(ClimbSystem.debug.lastJumpMode, 'cancel-drop', 'holding backward lets go of the wall');
moveInput = { x: 0, y: 0 };
runClimb();
assert.equal(player.climbing, false, 'the drop finishes');
assert.equal(player.x, TILE * 0.5, 'dropped back to the start tile');
assert.equal(player.climbSurfaceY, 0, 'landed on the ground it climbed from');

// A brief backward tap (under the hold time) doesn't cancel.
target = ClimbSystem.getClimbTarget();
ClimbSystem.startClimb(target);
for (let i = 0; i < 10; i++) ClimbSystem.updateClimb(1 / 60);
moveInput = { x: -1, y: 0 };
ClimbSystem.updateClimb(1 / 60);
moveInput = { x: 0, y: 0 };
runClimb();
assert.equal(player.x, TILE * 3.5, 'a tap backward does not cancel; the climb completes onto the plateau');
assert.equal(player.climbSurfaceY, 2);

// --- Descent is a fast jump + roll ----------------------------------------
player.x = TILE * 3.5; player.angle = Math.PI; player.dodging = false;
target = ClimbSystem.getClimbTarget();
assert.equal(target?.type, 'wall');
assert.equal(target.descending, true, 'plateau -> ground is a descent');
ClimbSystem.startClimb(target);
assert.equal(player.climbHopCount, 1, 'descent is a single leap');
let elapsed = 0;
while (player.climbing && elapsed < 5) { ClimbSystem.updateClimb(1 / 60); elapsed += 1 / 60; }
assert(elapsed < 0.5, `jump-down is much faster than the hop climb (${elapsed.toFixed(2)}s)`);
assert.equal(player.dodging, true, 'landing rolls forward');
assert(player.dodgeDirX < 0, 'the roll continues in the jump direction');
moveInput = { x: 1, y: 0 };
assert.equal(player.climbing, false);
moveInput = { x: 0, y: 0 };

// --- Dodge releases a climb rather than spending a defensive sidestep ----
const deliberateFalls = []; // Captures FallSystem arrivals to verify manual releases keep deliberate landing costs.
context.window.FallSystem = {
  dropTiers: height => height / 2,
  land: (_entity, fall) => deliberateFalls.push(fall),
  resetGrip() {},
};
const handholdRoute = { // Mimics the two holds required for an exterior cliff face and its safe base.
  id: 'dodge-release-test',
  normal: { x: 1, z: 0 },
  tangent: { x: 0, z: 1 },
  upperNode: 1,
  nodes: [{ id: 0, x: 0.5, z: 0.5, y: 0 }, { id: 1, x: 1.5, z: 0.5, y: 2 }],
};
player.x = TILE * 0.5; player.y = TILE * 0.5; player.angle = 0; player.dodging = false;
assert.equal(ClimbSystem.startClimb({ type: 'cliffRoute', route: handholdRoute, entry: 1 }), true);
assert.equal(ClimbSystem.cliffDodge(), true, 'dodge is consumed as a release while hanging on a handhold');
assert.equal(player._cliffRouteSession, null, 'releasing leaves the handhold route immediately');
assert.equal(ClimbSystem.debug.lastJumpMode, 'fall-released', 'release uses the existing controlled fall');
assert.equal(player._climbFall?.deliberate, true, 'intentional release is distinct from accidentally losing grip');
assert.equal(player.dodging, false, 'release never begins a combat dodge');
runClimb();
assert.equal(player.x, TILE * 0.5, 'handhold release lands at the safe route base');
assert.equal(player.climbing, false, 'release finishes with grounded movement');
assert.equal(deliberateFalls.length, 1, 'the shared fall-landing logic receives the release');
assert.equal(deliberateFalls[0].source, 'climb released');
assert.equal(ClimbSystem.cliffDodge(), false, 'the same button is not swallowed after landing');

// Authored ruin walls use ClimbSurfaces rather than player.climbing and must also detach.
let wallReleases = 0; // Counts calls to the ClimbSurfaces release handler.
let wallFallRequested = false; // Confirms Dodge requests physical falling rather than Jump's existing detach.
context.window.ClimbSurfaces = {
  release: options => {
    if (!player.onClimbSurface) return false;
    player.onClimbSurface = null;
    wallFallRequested = options?.fall === true;
    wallReleases++;
    return true;
  },
};
player.onClimbSurface = { id: 'ruin-wall', v: 4 };
assert.equal(ClimbSystem.cliffDodge(), true, 'dodge detaches from an authored climbable ruin wall');
assert.equal(player.onClimbSurface, null, 'wall climb no longer owns movement');
assert.equal(wallReleases, 1, 'dodge uses the existing release operation exactly once');
assert.equal(wallFallRequested, true, 'dodge asks the wall climb owner for a physical fall');
assert.equal(player.dodging, false, 'detaching never starts a combat dodge');
assert.equal(ClimbSystem.cliffDodge(), false, 'normal dodge remains available after a wall release');

player.x = TILE * 0.5; player.y = TILE * 0.5; player.angle = 0;
target = ClimbSystem.getClimbTarget();
assert.equal(ClimbSystem.startClimb(target), true);
for (let i = 0; i < 20; i++) ClimbSystem.updateClimb(1 / 60);
assert.equal(ClimbSystem.cliffDodge(), true, 'dodge interrupts a scripted wall ascent');
assert.equal(ClimbSystem.debug.lastJumpMode, 'cancel-drop', 'the ascent uses the existing safe drop path');
assert.equal(player.dodging, false, 'scripted wall release does not evade');
runClimb();
assert.equal(player.x, TILE * 0.5, 'scripted release returns to the starting ground');

// --- Map boundary escarpments ---------------------------------------------
player.dodging = false; player.x = TILE * 4.5; player.angle = 0;
assert.equal(ClimbSystem.getClimbTarget(), null, 'a boundary escarpment wall is never climbable');
const mapRoot = { tiles: { '0,0': { borderEscarpment: true }, '1,0': { borderEntryGate: true, borderEscarpment: true }, '2,0': { distantBoundaryLandscape: true }, '3,0': {} } };
const merged = new Map([['0,0', { c: 0, r: 0 }], ['1,0', { c: 1, r: 0 }], ['2,0', { c: 2, r: 0 }], ['3,0', { c: 3, r: 0 }]]);
assert.equal(MapBoundaryGuard.markMergedTiles(mapRoot, merged), 2);
assert.equal(merged.get('0,0').mapBoundary, true);
assert.equal(!!merged.get('1,0').mapBoundary, false, 'the entry gate cut stays open');
assert.equal(merged.get('2,0').mapBoundary, true);
const spawn = MapBoundaryGuard.relocateOffBoundary(grid, 7, 1, TILE * 6.5, TILE * 0.5, TILE);
assert.equal(spawn?.col, 4, 'a spawn on a boundary top moves to the nearest placeable tile');
assert.equal(MapBoundaryGuard.relocateOffBoundary(grid, 7, 1, TILE * 0.5, TILE * 0.5, TILE), null, 'ordinary ground is left alone');
assert.equal(MapBoundaryGuard.blocksCreatureStep(grid, TILE, TILE * 4.5, 32, TILE * 5.2, 32), true, 'creatures cannot step onto boundary terrain');
assert.equal(MapBoundaryGuard.blocksCreatureStep(grid, TILE, TILE * 6.5, 32, TILE * 5.5, 32), false, 'one already on it may walk off');
const g2 = makeGrid();
MapBoundaryGuard.clearAround(g2, 7, 1, 6, 0, 1);
assert.equal(!!g2[0][6].mapBoundary || !!g2[0][5].mapBoundary, false, 'exits clear the boundary around them');

// --- Hostiles follow up cliffs and get shot off ---------------------------
grid = makeGrid();
CreatureCliffClimb.init({
  TILE, isSolid: () => false, tileSurfaceYInArea: tile => (tile.elevTier || 0) * 2,
  isZoneArea: () => true, getCurrentArea: () => 'zone',
  getActiveGrid: () => grid, getActiveCols: () => 7, getActiveRows: () => 1,
});
const footing = [];
context.window.ResourceSystem = { applyDamage() {}, spendFooting: (e, amt) => footing.push(amt) };
const hunter = { id: 'h1', x: TILE * 0.8, y: 32, state: 'chase', health: 10, areaId: 'zone' };
const prey = { x: TILE * 4.5, y: 32, health: 10 };
assert.equal(CreatureCliffClimb.update(hunter, 1 / 60, prey), true, 'a chasing hostile at the wall foot climbs after its target');
for (let i = 0; i < 15; i++) CreatureCliffClimb.update(hunter, 1 / 60, prey);
assert(hunter._cliffClimb.surfaceY > 0, 'it is on the face');
assert.equal(CreatureCliffClimb.knockOff(hunter), true, 'a projectile hit knocks it off');
for (let i = 0; i < 60 && hunter._cliffClimb; i++) CreatureCliffClimb.update(hunter, 1 / 60, prey);
assert.equal(hunter._cliffClimb, null);
assert.equal(hunter.x, TILE * 0.8, 'it falls back to the foot of the wall');
assert.equal(footing.length, 1, 'and lands hard');
assert.equal(CreatureCliffClimb.update(hunter, 1 / 60, prey), false, 'retry waits for a cooldown');
for (let i = 0; i < 200; i++) CreatureCliffClimb.update(hunter, 1 / 60, prey);
for (let i = 0; i < 200 && (hunter._cliffClimb || hunter.x < TILE * 3); i++) CreatureCliffClimb.update(hunter, 1 / 60, prey);
assert.equal(hunter.x, TILE * 3.5, 'after the cooldown it climbs again and reaches the plateau');
assert.equal(CreatureCliffClimb.update({ ...hunter, x: TILE * 4.8, state: 'chase', _cliffClimbCooldownT: 0 }, 1 / 60, { x: TILE * 6.5, y: 32, health: 10 }), false, 'hostiles never climb boundary escarpments');

// --- Wiring ----------------------------------------------------------------
const game = fs.readFileSync('docs/game.js', 'utf8');
const html = fs.readFileSync('docs/index.html', 'utf8');
assert(/js\/map-boundary-guard\.js\?v=[A-Za-z0-9_-]+/.test(html) && /js\/creature-cliff-climb\.js\?v=[A-Za-z0-9_-]+/.test(html), 'both modules load');
assert(game.includes('CreatureCliffClimb?.update?.(') && game.includes('CreatureCliffClimb?.knockOff?.('), 'creature climb is driven from the hostile loop and damageCreature');
assert(game.includes('MapBoundaryGuard?.relocateOffBoundary?.('), 'creature spawns are pushed off boundary tiles');

console.log('cliff climb mechanics: ok');

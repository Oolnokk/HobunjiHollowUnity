#!/usr/bin/env node
'use strict';

// Run the real riding and animal-vocalization modules without a browser.
// This verifies that whistle audio, independent exertion pools, wheat charges,
// autonomous travel and physical small-rock crossings share the existing owners.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const voices = JSON.parse(read('docs/config/dialogue/ambient-dialogue.json')).animalVocalizations;
const utteranceIndex = JSON.parse(read('docs/assets/audio/sfx/utterances/index.json'));
const voiceWindow = {};
const voiceCtx = vm.createContext({ window: voiceWindow, Math, Date, console });
vm.runInContext(read('docs/js/animal-vocalizations.js'), voiceCtx);
const scheduled = []; // One record per genuine utterance given to the existing AudioSystem renderer.
voiceWindow.AnimalVocalizations.init({
  hasVoice: () => true, random: () => 0.5,
  renderUtterance: (_animal, opts) => { scheduled.push(opts); opts.onStarted?.(); return true; },
});
voiceWindow.AnimalVocalizations.setAuthoredProfiles(voices);
for (const [species, config] of Object.entries(voices)) {
  if (species === 'default') continue;
  const expected = config.growl?.allowedClips || utteranceIndex.legacySpeciesDefaults?.[species] || [];
  assert.deepEqual(config.exertion?.allowedClips, expected, species + ' exertion is initially copied from the aggression voice');
  assert.equal(config.exertion?.utterances?.length, 1, species + ' exertion is a singular sound');
  const creature = { creatureKey: species, health: 10, state: 'idle', genotype: { sizeClass: 'medium' } };
  const previous = scheduled.length;
  assert.equal(voiceWindow.AnimalVocalizations.mountExertion(creature), true, species + ' exertion is dispatched through the real vocal coordinator');
  assert.equal(scheduled.length, previous + 1, 'one exertion request emits exactly one recording slot');
  assert.deepEqual(Array.from(scheduled[previous].allowedClips || []), expected, species + ' uses its own independent pool');
  assert.equal(scheduled[previous].meaning, 'exertion', 'the utterance does not pose as an aggression growl');
}

const T = 64;
const grid = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => ({ type: 'grass' })));
grid[6][6] = { type: 'rock', projectileCoverHeightTiles: .45 }; // A pair of low wilderness rocks, both shorter than the mounted hop.
grid[6][7] = { type: 'rock', projectileCoverHeightTiles: .45 };
const rockCells = new Set(['6,6', '7,6']);
function canOccupy(x, y) {
  if (x < T || y < T || x > 15 * T || y > 15 * T) return false;
  const radius = 11;
  return [[-radius, -radius], [radius, radius], [-radius, radius], [radius, -radius]]
    .every(([dx, dy]) => !rockCells.has(Math.floor((x + dx) / T) + ',' + Math.floor((y + dy) / T)));
}
const sfx = []; // Exact recorded whistle filenames passed through the game-owned object SFX mixer.
const player = { x: 3.5 * T, y: 6.5 * T, angle: 0, vx: 0, vy: 0 };
const claims = {}; // The same action ownership API used for remappable Dodge/Jump actions.
let breaths = 0;
const win = {
  __farmLog() {},
  AudioSystem: {
    resetCreatureGait() {}, footstepAdvance: () => false,
    playObjectSfx: entry => sfx.push(entry.url),
  },
  ProjectileTileCover: { coverTop: tile => Number(tile.projectileCoverHeightTiles) },
  AnimalVocalizations: { mountExertion: () => { breaths++; return true; } },
  WorldActionInputClaims: {
    setClaims: (owner, entries) => { claims[owner] = entries; },
    clearClaims: owner => { delete claims[owner]; },
  },
  GroundObstacleAvoidance: {
    steer: () => null, reset() {},
  },
  ResourceRings: null,
};
let now = 1000;
const ctx = vm.createContext({ window: win, Math, console, performance: { now: () => now } });
vm.runInContext(read('docs/js/mount-system.js'), ctx);
const input = { x: 0, y: 0 };
const deps = {
  player, input, scene: {}, companionObjects: new Set(),
  getStable: () => [{ id: 'one', kind: 'horse' }],
  CREATURE_DB: { horse: { mountSpeed: 340 } },
  btnCallMount: { classList: { toggle() {}, add() {}, remove() {} } },
  TILE: T, PLAYER_RADIUS: 11, FACING_LERP: 8, MOVE_SPEED: 238,
  ACCEL: 900, DECEL: 900, MOUSE_IDLE_MS: 2000, isDesktop: true, rnd: () => 0.5,
  clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
  angleDiff: (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b)),
  canPlayerOccupy: canOccupy,
  getAlchemySpeedMul: () => 1, getDevGlobalSpeedMul: () => 1,
  getKeyboardVector: () => ({ active: false, x: 0, y: 0 }),
  makeCreatureEntity: (kind, x, y, opts) => ({
    kind, x, y, vx: 0, vy: 0, health: 100, facing: 0, areaId: 'wild',
    def: { mountSpeed: 340 }, ...opts,
  }),
  despawnCreature() {},
  moveCreatureToward: (m, x, y) => { m.x = x; m.y = y; return true; },
  updateCreatureMesh() {}, updateCreatureAnimFrame() {},
  tileSurfaceYInArea: () => 0, characterGroundShadowSurfaceOffset: () => 0,
  getActiveScene: () => ({ add() {} }), getActiveGrid: () => grid,
  getActiveCols: () => 16, getActiveRows: () => 16,
  _isZoneArea: () => true, _isCavernBuildingArea: () => false,
  showToast() {}, getCurrentArea: () => 'wild', getActiveMountId: () => 'one',
  getFacingAngle: () => player.angle, setFacingAngle: angle => { player.angle = angle; },
  getMouseLookActive: () => false, setMouseLookActive() {},
  getControllerLookActive: () => false, getControllerLookAngle: () => 0,
  getLastMouseMoveTime: () => 0, getMouseLookAngle: () => 0,
  isShoulderSurfMode: () => false, cameraFacingAngleRad: () => 0,
};
win.Mounts.init(deps);
win.Mounts.toggleMount();
assert(sfx.includes('assets/audio/sfx/sfx_whistle2.m4a'), 'summoning plays the distinct whistle2 cue');
win.Mounts.updateMountRide(.1);
win.Mounts.updateMountRide(1);
win.Mounts.updateMountRide(0);
assert.equal(win.Mounts.rideState, 'mounted');
assert.deepEqual(Array.from(claims['mount-riding'].map(x => x.actionId)), ['dodge', 'jump']);
const mount = win.Mounts.rideEntity;
mount.x = player.x; mount.y = player.y;
let autoHopSeen = false;
let lifted = false;
for (let frame = 0; frame < 300; frame++) {
  now += 1000 / 60;
  win.Mounts.updateMountedMovement(1 / 60);
  if (mount._mountHop) autoHopSeen = true;
  if ((mount._banditLungeHopCurrent || 0) > 0.1) lifted = true;
  assert.equal(player.x, mount.x, 'rider stays pinned to the true mount X');
  assert.equal(player.y, mount.y, 'rider stays pinned to the true mount Y');
  if (!mount._mountHop) assert(canOccupy(mount.x, mount.y), 'a grounded mount never occupies a rock');
  if (mount.x > 8.5 * T) break;
}
assert(autoHopSeen && lifted, 'autonomous mount hops across the low rock patch with visible vertical travel');
assert(mount.x > 8.5 * T, 'rock patch does not permanently obstruct forward riding');
assert.equal(win.Mounts.ridingDebug.autoRockJumps, 1, 'rock cluster is crossed with one airborne leap');

const boost = claims['mount-riding'].find(x => x.actionId === 'dodge');
const jump = claims['mount-riding'].find(x => x.actionId === 'jump');
boost.onPress();
assert.equal(win.Mounts.ridingDebug.wheatRemaining, 5, 'dodge consumes one wheat charge');
assert.equal(win.Mounts.ridingDebug.boosts, 1, 'dodge triggers exactly one surge');
assert(sfx.includes('assets/audio/sfx/sfx_whistle1.mp3'), 'acceleration plays whistle1, not whistle2');
boost.onPress(); // A repeated event for the same physical press must not eat another charge.
assert.equal(win.Mounts.ridingDebug.wheatRemaining, 5, 'duplicate press is debounced');
now += 300;
boost.onPress(); now += 300; boost.onPress(); now += 300; boost.onPress();
assert.equal(win.Mounts.ridingDebug.wheatRemaining, 2, 'each genuine additional press uses exactly one charge');
jump.onPress();
assert.equal(win.Mounts.ridingDebug.manualJumps, 1, 'jump binding initiates a manual mounted hop');
for (let i = 0; i < 340; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert(breaths > 0, 'partially spent wheat produces periodic species exertion calls');
assert.equal(win.Mounts.ridingDebug.jumping, false, 'manual hop finishes and clears its visual arc');
assert(win.Mounts.ridingDebug.wheatRemaining > 2, 'wheat charges regenerate after the surge ends');

console.log('mounted wheat, whistles, rock hopping, action routing and animal exertion checks passed');

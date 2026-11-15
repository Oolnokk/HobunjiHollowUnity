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

// Older imported animal profiles may have no exertion authoring yet: copy only
// the aggression recording pool, never the whole aggressive multi-utterance sequence.
voiceWindow.AnimalVocalizations.setAuthoredProfiles({
  default: {},
  drenkirra: { growl: { allowedClips: ['sfx_rattle-caw.ogg'], utterances: [
    { tempo: 1, pitchSemitones: 0 }, { tempo: 1.3, pitchSemitones: 1 }, { tempo: 0.8, pitchSemitones: -1 },
  ] } },
});
const beforeLegacy = scheduled.length;
assert.equal(voiceWindow.AnimalVocalizations.mountExertion({ creatureKey: 'drenkirra', health: 10 }), true);
assert.equal(scheduled.length, beforeLegacy + 1, 'legacy growls seed only one single exertion sound');
assert.deepEqual(Array.from(scheduled[beforeLegacy].allowedClips || []), ['sfx_rattle-caw.ogg']);
voiceWindow.AnimalVocalizations.setAuthoredProfiles({
  default: {}, drenkirra: { exertion: { allowedClips: ['sfx_rattle-caw.ogg'], utterances: [
    { tempo: 1, pitchSemitones: 0 }, { tempo: 1.3, pitchSemitones: 1 }, { tempo: 0.8, pitchSemitones: -1 },
  ] } },
});
const beforeOverspecified = scheduled.length;
assert.equal(voiceWindow.AnimalVocalizations.mountExertion({ creatureKey: 'drenkirra', health: 10 }), true);
assert.equal(scheduled.length, beforeOverspecified + 1, 'even imported multi-slot exertion responses play exactly one sound');
voiceWindow.AnimalVocalizations.setAuthoredProfiles(voices);

const T = 64;
const grid = Array.from({ length: 16 }, () => Array.from({ length: 80 }, () => ({ type: 'grass' }))); // Wide enough to observe breathing and wheat recovery during uninterrupted travel.
grid[6][6] = { type: 'rock', projectileCoverHeightTiles: .75 }; // A pair of low wilderness rocks, both shorter than the mounted hop.
grid[6][7] = { type: 'rock', projectileCoverHeightTiles: .75 };
grid[6][8] = { type: 'rock', projectileCoverHeightTiles: .75 }; // Proves a three-tile cluster is crossable in one hop.
const rockCells = new Set(['6,6', '7,6', '8,6']);
const desktopListeners = new Map(); // Captures the actual mounted keyboard capture handler without browser APIs.
const pointerListeners = new Map(); // Captures mounted touch down/click listeners for press deduplication checks.
let menuOpen = false; // Simulates the real menu's gameplay-input exclusion gate.
let controllerCallback = null; // One subscriber to the shared ControllerInput frame, never a new gamepad loop.
const document = {
  addEventListener: (type, fn) => { pointerListeners.set(type, fn); },
  getElementById: id => id === 'menuPanel' ? { classList: { contains: name => name === 'open' && menuOpen } } : null,
}; // No body intentionally: the HUD view has no effect on the movement/audio test fixture.
function canOccupy(x, y) {
  if (x < T || y < T || x > 79 * T || y > 15 * T) return false;
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
  addEventListener: (type, fn) => { desktopListeners.set(type, fn); },
  InputBindings: { getCurrentBindings: () => ({ desktop: { dodge: 'KeyX' }, controller: { dodge: 'Button1', interact: 'Button0' } }) },
  ControllerInput: { subscribe: (_id, callback) => { controllerCallback = callback; } },
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
const ctx = vm.createContext({ window: win, Math, console, performance: { now: () => now }, document });
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
  getActiveCols: () => 80, getActiveRows: () => 16,
  _isZoneArea: () => true, _isCavernBuildingArea: () => false,
  showToast() {}, getCurrentArea: () => 'wild', getActiveMountId: () => 'one',
  getFacingAngle: () => player.angle, setFacingAngle: angle => { player.angle = angle; },
  getMouseLookActive: () => false, setMouseLookActive() {},
  getControllerLookActive: () => false, getControllerLookAngle: () => 0,
  getLastMouseMoveTime: () => 0, getMouseLookAngle: () => 0,
  isShoulderSurfMode: () => false, cameraFacingAngleRad: () => 0,
};
win.Mounts.init(deps);
win.ClimbSystem = { jumpAction: () => win.Mounts.jumpMount() }; // The in-game Jump/Climb owner delegates a normal mounted hop.
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
  if (mount.x > 9.5 * T) break;
}
assert(autoHopSeen && lifted, 'autonomous mount hops across the low rock patch with visible vertical travel');
assert(mount.x > 9.5 * T, 'three-rock patch does not permanently obstruct forward riding');
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

// Verify real device-edge adapters, not only the direct action-claim callbacks above.
assert.equal(typeof desktopListeners.get('keydown'), 'function', 'desktop gameplay listener installed');
assert.equal(typeof pointerListeners.get('pointerdown'), 'function', 'touch gameplay listener installed');
assert.equal(typeof controllerCallback, 'function', 'mount subscribes to the existing shared controller frame');
function keyboard(code) {
  const event = { code, repeat: false, defaultPrevented: false, target: { closest: () => null },
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {} };
  desktopListeners.get('keydown')(event);
  return event;
}
const beforeKeyboard = win.Mounts.ridingDebug.wheatRemaining;
assert.equal(keyboard('KeyX').defaultPrevented, true, 'mounted keyboard Dodge is claimed instead of rolling the rider');
assert.equal(win.Mounts.ridingDebug.wheatRemaining, beforeKeyboard - 1, 'keyboard Dodge consumes one charge');
now += 200;
const beforeModal = win.Mounts.ridingDebug.wheatRemaining;
menuOpen = true;
assert.equal(keyboard('KeyX').defaultPrevented, false, 'menu-open Dodge is left to menu ownership');
controllerCallback({ owner: 'gameplay', focused: true, pressed: new Set(['Button1']) });
assert.equal(win.Mounts.ridingDebug.wheatRemaining, beforeModal, 'menu-open input does not consume wheat on any device');
menuOpen = false;
now += 200;
const beforeController = win.Mounts.ridingDebug.wheatRemaining;
controllerCallback({ owner: 'gameplay', focused: true, pressed: new Set(['Button1']) });
assert.equal(win.Mounts.ridingDebug.wheatRemaining, beforeController - 1, 'remappable controller Dodge accelerates');
const beforeControllerInteract = win.Mounts.ridingDebug.manualJumps;
controllerCallback({ owner: 'gameplay', focused: true, pressed: new Set(['Button0']) });
assert.equal(win.Mounts.ridingDebug.manualJumps, beforeControllerInteract,
  'the extra mount listener leaves A/Interact to the game-owned interaction-or-jump fallback; it must not double-dispatch');
now += 200;
const beforePointer = win.Mounts.ridingDebug.wheatRemaining;
function tapEvent(id) {
  return { target: { closest: selector => selector.includes('#dodgeBtn') ? { id } : null }, preventDefault() {}, stopImmediatePropagation() {} };
}
pointerListeners.get('pointerdown')(tapEvent('dodgeBtn'));
pointerListeners.get('click')(tapEvent('dodgeBtn'));
assert.equal(win.Mounts.ridingDebug.wheatRemaining, beforePointer - 1, 'one touch press + synthetic click consumes only one charge');
now += 200;
const beforeJump = win.Mounts.ridingDebug.manualJumps;
keyboard('Space');
assert.equal(win.Mounts.ridingDebug.manualJumps, beforeJump + 1, 'Space triggers a mounted jump through the Jump/Climb owner');
for (let i = 0; i < 100 && win.Mounts.ridingDebug.jumping; i++) win.Mounts.updateMountedMovement(1 / 60);
assert.equal(win.Mounts.ridingDebug.jumping, false, 'mounted manual hop completes before subsequent collision checks');

// Deliberately tall, tagged wilderness boulders remain fully solid: never teleport across them.
grid[6][20] = { type: 'rock', rockKind: 'undiggableBoulder', boulderId: 'tall', projectileCoverHeightTiles: 1.8 };
rockCells.add('20,6');
mount.x = 18.5 * T; mount.y = 6.5 * T;
const beforeTallRock = win.Mounts.ridingDebug.autoRockJumps;
for (let i = 0; i < 180; i++) {
  now += 1000 / 60;
  win.Mounts.updateMountedMovement(1 / 60);
  assert(canOccupy(mount.x, mount.y), 'a tall boulder remains impassable to grounded riding');
}
assert.equal(win.Mounts.ridingDebug.autoRockJumps, beforeTallRock, 'tall boulders are not eligible for automatic jumps');
assert(mount.x < 20 * T, 'the horse stops at the boulder instead of passing through it');

// Dismounting mid-jump releases visual hop state immediately, without losing the rider/mount transition.
assert.equal(win.Mounts.jumpMount(), true, 'manual hop begins before dismount');
assert.equal(win.Mounts.ridingDebug.jumping, true);
win.Mounts.toggleMount();
assert.equal(win.Mounts.rideState, 'dismountingDown');
assert.equal(mount._mountHop, null, 'dismount cancels an in-progress rock hop');
assert.equal(mount._banditLungeHopCurrent, 0, 'dismount clears airborne visual offset');

console.log('mounted wheat, whistles, rock and boulder collision, device input, dismount and animal exertion checks passed');

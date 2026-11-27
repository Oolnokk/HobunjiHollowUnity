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
const mountHudClasses = new Set(); // Observes the wheat visibility override when all player vitals rows are intentionally hidden.
function fakeHudNode() {
  const node = { style: {}, children: [], attrs: {}, id: '' }; // Minimal DOM surface for mount HUD creation and class toggling.
  node.classList = {
    toggle(name, enabled) { if (enabled) mountHudClasses.add(name); else mountHudClasses.delete(name); },
    contains: name => mountHudClasses.has(name),
  };
  node.appendChild = child => { node.children.push(child); return child; };
  node.setAttribute = (name, value) => { node.attrs[name] = value; };
  return node;
}
const vitalHud = fakeHudNode(); // The resource-bar container can be hidden while wheat remains visible above it.
const fakeBody = fakeHudNode(); // Actual DOM installation is tested instead of disabling the mount HUD.
const document = {
  addEventListener: (type, fn) => { pointerListeners.set(type, fn); },
  createElement: () => fakeHudNode(),
  body: fakeBody, head: fakeHudNode(),
  getElementById: id => id === 'menuPanel'
    ? { classList: { contains: name => name === 'open' && menuOpen } }
    : id === 'vitalsBar' ? vitalHud : null,
};
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
assert(mountHudClasses.has('with-mounted-wheat'), 'wheat remains visible even when player vitals rows are hidden');
assert.equal(vitalHud.children.length, 1, 'wheat HUD is anchored to the player vitals container');
assert.equal(vitalHud.children[0].style.display, 'flex', 'all six wheat charges are displayed while riding');
assert.equal(vitalHud.children[0].children.length, 6, 'mounted display preserves all six charge icons');
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


assert.match(read('docs/js/pixel-probe.js'), /coasting=\$\{!!mountedRide\.coasting\}/, 'mobile Pixel Probe renders real coasting state without requiring a console');

// A manual jump on clear ground must retain normal forward speed and airborne steering.
// The rock-crossing hop above stays a scripted traversal, but ordinary air time
// must not replace the riding controller with the old 0.8-tile horizontal lerp.
mount.x = 12 * T; mount.y = 6.5 * T;
input.x = 1; input.y = 0; // Hold forward throughout this jump, matching the reported input combination.
const levelStartX = mount.x; // Compare the airborne displacement with the species' normal forward cruise.
let manualPeak = 0; // Confirm the horizontal movement fix does not remove the vertical jump animation.
assert.equal(win.Mounts.jumpMount(), true, 'forward riding still accepts a manual jump');
for (let i = 0; i < 29; i++) {
  now += 1000 / 60;
  win.Mounts.updateMountedMovement(1 / 60);
  manualPeak = Math.max(manualPeak, mount._banditLungeHopCurrent || 0);
  assert.equal(player.x, mount.x, 'rider remains attached while moving forward during jump');
}
const airborneTravel = mount.x - levelStartX; // Expected: close to cruise speed × 29 frames, not a fixed 0.8 tile.
assert(airborneTravel > 1.2 * T, 'manual jump keeps cruising forward instead of replacing motion with a fixed short hop');
assert(manualPeak > 0.3, 'manual jump retains a visible airborne elevation arc');
assert.equal(win.Mounts.ridingDebug.jumping, false, 'jump finishes without leaving stale airborne state');

const steerStartY = mount.y; // Turning the reins in midair should still alter the actual travel vector.
input.x = 0; input.y = 1;
assert.equal(win.Mounts.jumpMount(), true, 'a second manual jump can start after landing');
for (let i = 0; i < 18; i++) {
  now += 1000 / 60;
  win.Mounts.updateMountedMovement(1 / 60);
}
assert(mount.y > steerStartY + T * 0.2, 'ordinary airborne mounted steering still changes direction');
for (let i = 0; i < 20 && win.Mounts.ridingDebug.jumping; i++) {
  now += 1000 / 60;
  win.Mounts.updateMountedMovement(1 / 60);
}
input.x = 1; input.y = 0; // Restore the original forward bearing for the later tall-boulder regression.
for (let i = 0; i < 24; i++) {
  now += 1000 / 60;
  win.Mounts.updateMountedMovement(1 / 60);
}
input.x = 0; input.y = 0;

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
const beforeBindingJump = win.Mounts.ridingDebug.manualJumps; // A bound press must add one hop regardless of earlier regression jumps.
const boostedStartX = mount.x, boostedStartY = mount.y; // Verify a boosted jump keeps the wheat-boosted forward cruise.
jump.onPress();
assert.equal(win.Mounts.ridingDebug.manualJumps, beforeBindingJump + 1, 'jump binding initiates a manual mounted hop');
for (let i = 0; i < 20; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert(Math.hypot(mount.x - boostedStartX, mount.y - boostedStartY) > T * 1.5,
  'wheat boost still provides high-speed travel during the jump');
for (let i = 20; i < 340; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
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

// A manual jump must not defeat the solid-boulder collision check.
assert.equal(win.Mounts.jumpMount(), true, 'jump is available even while facing an impassable boulder');
for (let i = 0; i < 29; i++) {
  now += 1000 / 60;
  win.Mounts.updateMountedMovement(1 / 60);
  assert(canOccupy(mount.x, mount.y), 'jumping against a tall boulder does not phase through it');
  assert.equal(player.x, mount.x, 'rider remains seated against the airborne collision boundary');
}
assert(mount.x < 20 * T, 'a manual hop cannot leap through the tall boulder');
assert.equal(win.Mounts.ridingDebug.jumping, false, 'collision-limited jump still lands cleanly');

// Mounted melee uses measured carrier velocity rather than target speed or a player lunge.
const normalMountedSpeed = win.Mounts.mountedTopSpeedPxS(); // Current player-run × 1.1 baseline; used throughout combat and coasting assertions instead of obsolete species mountSpeed.
assert(Math.abs(normalMountedSpeed - deps.MOVE_SPEED * 1.1) < 1e-9, 'unperked mount baseline comes from current player running speed, not species mountSpeed');
mount.vx = 0; mount.vy = 0;
assert.equal(win.Mounts.mountedMeleeDamageMultiplier(), 1, 'a stopped mount has no artificial momentum damage');
mount.vx = normalMountedSpeed; mount.vy = 0;
assert(Math.abs(win.Mounts.mountedMeleeDamageMultiplier() - 1.65) < 1e-8,
  'normal gallop increases melee impact based on actual carrier speed');
mount.vx = 0; mount.vy = 0;
const beforeCombatWheat = win.Mounts.ridingDebug.wheatRemaining; // Combat bursts must never spend OoT-style acceleration charges.
assert.equal(win.Mounts.beginMountedCombatBurst(3, 2.2), true, 'heavy melee grants a timed speed multiplier while seated');
assert.equal(win.Mounts.ridingDebug.combatBoostMultiplier, 3, 'mounted attack boost retains its requested speed factor');
assert.equal(win.Mounts.ridingDebug.wheatRemaining, beforeCombatWheat, 'combat burst does not consume dodge wheat');
mount.x = 24 * T; mount.y = 9 * T;
input.x = 1; input.y = 0;
for (let i = 0; i < 60; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert(win.Mounts.ridingDebug.speedPxS > normalMountedSpeed * 1.5, 'attack speed multiplies the actual carrier speed, not just the rendering');
assert(win.Mounts.ridingDebug.combatBoostSeconds > 0, 'charged gallop persists beyond its first frame');
for (let i = 0; i < 100; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert.equal(win.Mounts.ridingDebug.combatBoostSeconds, 0, 'legacy timed combat burst still ends and restores ordinary speed settings');

// A funded windup changes actual movement's desired speed, never the post-strike
// boost timer, and does not spend any of the six wheat acceleration charges.
const wheatBeforeWindup = win.Mounts.ridingDebug.wheatRemaining; // Snapshot AFTER earlier riding/recovery tests, immediately before the windup grant.
assert.equal(win.Mounts.setMountedCombatWindupBoost('mountedCharge', 3.2, 0), true);
assert.equal(win.Mounts.ridingDebug.windupMultiplier, 0, 'zero paid stamina means zero acceleration');
assert.equal(win.Mounts.ridingDebug.wheatRemaining, wheatBeforeWindup, 'windup spends no wheat');
assert.equal(win.Mounts.setMountedCombatWindupBoost('mountedCharge', 3.2, 0.4), true);
const partialWindup = win.Mounts.ridingDebug.windupMultiplier; // Recorded target of an intermediate payment.
assert(partialWindup > 1 && partialWindup < 3.2, 'partial payment yields a partial speed multiplier');
assert.equal(win.Mounts.setMountedCombatWindupBoost('mountedCharge', 3.2, 1), true);
assert(win.Mounts.ridingDebug.windupMultiplier > partialWindup, 'more stamina payment gives more acceleration');
assert.equal(win.Mounts.clearMountedCombatWindupBoost('mountedQuickAttack'), false, 'unrelated attack cannot cancel the active charge');
assert.equal(win.Mounts.clearMountedCombatWindupBoost('mountedCharge'), true);
assert.equal(win.Mounts.ridingDebug.windupMultiplier, 0, 'release supplies no more additional speed');
assert.equal(win.Mounts.setMountedCombatWindupBoost('mountedQuickAttack', 1.95, 0.5), true);
assert(win.Mounts.ridingDebug.windupMultiplier > 1, 'quick attack ramps the same mount movement');
assert.equal(win.Mounts.clearMountedCombatWindupBoost('mountedQuickAttack'), true);
assert.equal(win.Mounts.ridingDebug.windupOwner, null, 'quick impact clears the speed owner');
mount.x = 24 * T; mount.y = 9 * T; // Collision-free corridor for a real acceleration-and-impact transition.
input.x = 1; input.y = 0;
win.Mounts.setMountedCombatWindupBoost('mountedQuickAttack', 2.5, 1);
for (let i = 0; i < 24; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
const windupActualSpeed = win.Mounts.ridingDebug.speedPxS; // Physical velocity reached after a mounted quick windup.
assert(windupActualSpeed > normalMountedSpeed * 0.85, 'accelerating through the windup changes real carrier velocity');
win.Mounts.clearMountedCombatWindupBoost('mountedQuickAttack');
now += 1000 / 60;
win.Mounts.updateMountedMovement(1 / 60);
assert(win.Mounts.ridingDebug.speedPxS > normalMountedSpeed * 0.85, 'after boost stops, strike-frame inertia remains instead of being discarded');
assert.equal(win.Mounts.ridingDebug.windupMultiplier, 0, 'strike cannot continue to accelerate the mount');
const speedAtRelease = win.Mounts.ridingDebug.speedPxS; // Compare the real carrier across the first half-second after the attack's speed grant ends.
for (let i = 0; i < 30; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
const speedAfterCoast = win.Mounts.ridingDebug.speedPxS; // Passive momentum should decay smoothly rather than shedding ~225 px/s immediately.
assert(speedAfterCoast < speedAtRelease, 'released combat acceleration cannot keep increasing the carrier speed');
assert(speedAtRelease - speedAfterCoast < 140, 'mounted windup release coasts gently for half a second instead of sharply decelerating');
assert.equal(win.Mounts.ridingDebug.coasting, true, 'mobile diagnostics distinguish unpowered coasting from active windup boost');
input.x = -1; input.y = 0; // Opposite reins deliberately override coasting with the existing strong brake.
for (let i = 0; i < 12; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert(win.Mounts.ridingDebug.speedPxS < speedAfterCoast - 150, 'deliberate reverse-rein braking is still substantially stronger than passive drag');
assert.equal(win.Mounts.ridingDebug.coasting, false, 'actively braking must not be reported as coasting');
input.x = 1; input.y = 0;


function runCoastAtFrameRate(fps) {
  // Reset on clear ground at ordinary cruise before replaying the same 0.5 s
  // charged acceleration and 0.5 s unpowered coasting at different frame rates.
  mount.x = 22 * T; mount.y = 9 * T;
  input.x = 1; input.y = 0;
  for (let i = 0; i < 240; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
  assert(Math.abs(win.Mounts.ridingDebug.speedPxS - normalMountedSpeed) < 0.01, 'frame-rate fixture returns to the full player-derived ordinary cruise');
  assert.equal(win.Mounts.setMountedCombatWindupBoost('mountedCharge', 2.5, 1), true);
  for (let i = 0; i < fps / 2; i++) { now += 1000 / fps; win.Mounts.updateMountedMovement(1 / fps); }
  const accelerated = win.Mounts.ridingDebug.speedPxS; // Same funded 0.5 s charge, independent of simulation frequency.
  assert.equal(win.Mounts.clearMountedCombatWindupBoost('mountedCharge'), true);
  mount.x = 15 * T; // Plenty of space for coasting; do not accidentally test boundary collision.
  for (let i = 0; i < fps / 2; i++) { now += 1000 / fps; win.Mounts.updateMountedMovement(1 / fps); }
  return { accelerated, coasted: win.Mounts.ridingDebug.speedPxS };
}
const coast30fps = runCoastAtFrameRate(30); // Low-FPS mobile regression: movement uses elapsed seconds, not a fixed per-frame bleed.
const coast60fps = runCoastAtFrameRate(60); // Gameplay reference for the half-second transition.
const coast120fps = runCoastAtFrameRate(120); // High-FPS check: no accidental multiplicative slowing each update.
for (const sample of [coast30fps, coast120fps]) {
  assert(Math.abs(sample.accelerated - coast60fps.accelerated) < 12, 'charge acceleration is consistent across frame rates');
  assert(Math.abs(sample.coasted - coast60fps.coasted) < 12, 'passive coasting is consistent across frame rates');
  assert(sample.coasted < sample.accelerated, 'unpowered mount coasting never adds speed');
}

mount.x = 22 * T; mount.y = 9 * T;
for (let i = 0; i < 240; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
const wheatBeforeExpiryCheck = win.Mounts.ridingDebug.wheatRemaining; // Wheat tests must consume one charge and cannot reuse combat boost state.
assert.equal(win.Mounts.accelerateMount(), true);
for (let i = 0; i < 82; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert.equal(win.Mounts.ridingDebug.boostSeconds, 0, 'wheat surge ends normally rather than lingering after its duration');
const wheatReleaseSpeed = win.Mounts.ridingDebug.speedPxS; // Surviving physical forward momentum when the wheat timer expires.
for (let i = 0; i < 30; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert(wheatReleaseSpeed > normalMountedSpeed * 0.85, 'wheat acceleration achieves a real speed increase before expiring');
assert(wheatReleaseSpeed - win.Mounts.ridingDebug.speedPxS < 140, 'wheat expiry uses the same gentle passive coasting as mounted combat');
assert.equal(win.Mounts.ridingDebug.wheatRemaining, wheatBeforeExpiryCheck - 1, 'coasting does not consume additional wheat charges');

mount.x = 18.5 * T; mount.y = 6.5 * T; // Same collision-tested tall boulder as the earlier riding regression.
assert.equal(win.Mounts.setMountedCombatWindupBoost('mountedCharge', 3.5, 1), true);
for (let i = 0; i < 50; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert(mount.x < 20 * T, 'charged coasting does not phase through a tall collision barrier');
assert(win.Mounts.ridingDebug.speedPxS < 60, 'collision drag remains powerful even when the rider is charging');
assert.equal(win.Mounts.ridingDebug.coasting, false, 'collision that stops the mount cannot report continued coasting');
assert.equal(win.Mounts.clearMountedCombatWindupBoost('mountedCharge'), true);

// Mobile auto-target must change the mount's path into a circle, not alter
// projectile aiming or override explicit manual reins.
const orbitEnemy = { id: 'orbited-enemy', health: 100, areaId: 'wild', x: 32 * T, y: 9 * T };
win.Combat = {
  input: { isAutoTargetEnabled: () => true },
  deps: { getActiveTool: () => 'ranged', getHeldMode: () => 'tool' },
};
win.RangedWeapons = {
  equippedRangedKey: () => 'bow',
  playerAimSolution: () => ({ reticleTarget: orbitEnemy }),
  playerLockRangePx: () => 7 * T,
};
mount.x = 28 * T; mount.y = 9 * T;
input.x = 0; input.y = 0;
const orbitStartY = mount.y;
const orbitStartDistance = Math.hypot(mount.x - orbitEnemy.x, mount.y - orbitEnemy.y);
for (let i = 0; i < 45; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert.equal(win.Mounts.ridingDebug.orbitTarget, 'orbited-enemy', 'orbit only follows the ranged system\'s selected auto-target');
assert(Math.abs(mount.y - orbitStartY) > T * 0.25, 'ranged auto-target bends travel into a real encircling path');
assert(Math.hypot(mount.x - orbitEnemy.x, mount.y - orbitEnemy.y) < orbitStartDistance + T * 0.5,
  'orbit does not drift substantially farther from the chosen enemy than its acquired distance');
win.Combat.deps.getActiveTool = () => 'weapon';
mount.x = 28 * T; mount.y = 9 * T;
for (let i = 0; i < 12; i++) { now += 1000 / 60; win.Mounts.updateMountedMovement(1 / 60); }
assert.equal(win.Mounts.ridingDebug.orbitActive, false, 'switching from a ranged weapon to melee cancels mount auto-orbit');
win.Combat.input.isAutoTargetEnabled = () => false;
input.x = 0; input.y = 0;


{
  // Use the actual shared compositor, not a stubbed multiplication.
  vm.runInContext(read('docs/js/combat/resource-system.js'), ctx);
  const rs = win.ResourceSystem;
  for (const actor of [player, mount]) {
    Object.assign(actor, { maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100 });
    rs.initEntity(actor);
  }
  mount.x = player.x = 30*T; mount.y = player.y = 8*T; // Open ground, far from the scripted rock hop.
  const baseTop = win.Mounts.mountedTopSpeedPxS();
  rs.addAffliction(player, 'weightlessStamina', 25);
  rs.addAffliction(mount, 'leadboundStamina', 40);
  assert(Math.abs(win.Mounts.mountedTopSpeedPxS() - baseTop*1.5*.7) < 1e-6, 'rider and mount mobility applied once each');
  rs.removeAffliction(player, 'weightlessStamina', 100);
  rs.removeAffliction(mount, 'leadboundStamina', 100);
  win.GameRandom.random = () => 0;
  rs.addAffliction(player, 'windblownStamina', 100);
  win.GameRandom.random = () => .25;
  rs.addAffliction(mount, 'windblownStamina', 100);
  const compose = rs.composeMountedMovement;
  let composed = null, composeArgs = null; // Capture the native phase and verify the real shared output against the ground calculation.
  rs.composeMountedMovement = (...args) => { composeArgs = args; composed = compose(...args); return composed; };
  input.x = 0; input.y = 0;
  const x = mount.x, y = mount.y;
  win.Mounts.updateMountedMovement(.05);
  assert(composed, 'coasting mount uses the shared mounted compositor');
  assert.equal(composeArgs[4].airborne, false, 'ground travel never uses airborne wind');
  assert(Math.abs(mount.x-x-composed.x)<1e-6 && Math.abs(mount.y-y-composed.y)<1e-6, 'one actual mounted sweep contains both winds');
  assert.equal(player.x,mount.x); assert.equal(player.y,mount.y);
  assert.equal(player.footing,100); assert.equal(mount.footing,100);
  win.FeyIllusions = { movementRotationRad: actor => actor === player ? Math.PI/2 : 0 };
  input.x=1; input.y=0;
  assert(win.Mounts.jumpMount());
  composed = null;
  win.Mounts.updateMountedMovement(.05);
  assert(Math.abs(player.inputX)<1e-6 && Math.abs(player.inputY-1)<1e-6, 'Demented rotates mounted reins once');
  assert(composed && win.Mounts.ridingDebug.jumping, 'ordinary mounted jump retains the shared wind sweep');
  assert.equal(composeArgs[4].airborne, true, 'both mounted actors share the real hop phase');
  const [rider, carrier, dx, dy, opts] = composeArgs;
  const groundMotion = compose(rider, carrier, dx, dy, { ...opts, airborne: false });
  assert(Math.abs(composed.x-dx-(groundMotion.x-dx)*1.5)<1e-6 && Math.abs(composed.y-dy-(groundMotion.y-dy)*1.5)<1e-6, 'mounted jump amplifies both wind vectors, not the underlying travel');
  assert.equal(player.x,mount.x); assert.equal(player.y,mount.y);
  rs.removeAffliction(player,'windblownStamina',100); rs.removeAffliction(mount,'windblownStamina',100);
  rs.composeMountedMovement=compose; delete win.FeyIllusions;
  for(let i=0;i<40 && win.Mounts.ridingDebug.jumping;i++) win.Mounts.updateMountedMovement(1/60);
  input.x=0;input.y=0;
}

// Dismounting mid-jump releases visual hop state immediately, without losing the rider/mount transition.
assert.equal(win.Mounts.jumpMount(), true, 'manual hop begins before dismount');
assert.equal(win.Mounts.ridingDebug.jumping, true);
win.Mounts.toggleMount();
assert.equal(win.Mounts.rideState, 'dismountingDown');
assert.equal(win.Mounts.ridingDebug.coasting, false, 'dismount never exposes stale mount coasting diagnostics');
win.Mounts.updateMountRide(0);
assert.equal(mountHudClasses.has('with-mounted-wheat'), false, 'dismount removes the wheat-only player-vitals visibility override');
assert.equal(mount._mountHop, null, 'dismount cancels an in-progress rock hop');
assert.equal(mount._banditLungeHopCurrent, 0, 'dismount clears airborne visual offset');

console.log('mounted wheat, whistles, rock and boulder collision, device input, dismount and animal exertion checks passed');

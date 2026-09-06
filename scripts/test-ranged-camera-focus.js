#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/ranged-camera-focus.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');

assert.match(loader, /ranged-camera-focus\.js\?v=20260906d[\s\S]*HobunjiRangedCameraFocus\?\.version\) >= 4/, 'loader requires the shared interaction-target v4 adapter');
assert.doesNotMatch(loader, /attack-camera-player-root/, 'obsolete player-root camera hook is no longer loaded');
assert.match(source, /shared-3d-interaction-target-native-camera/, 'combat aim reports the shared 3D interaction-target contract');
assert.match(source, /intersectObjects\(scene\.children, true\)/, 'shared aim resolves the first active-scene surface recursively');
assert.match(source, /getPlayerAimRay: \(\) => rangedInteractionAimRay\(\)/, 'ranged shots consume the shared interaction target');
assert.match(source, /interactionTargetMeleeHit/, 'actual player melee collision receives the shared interaction-target direction');
assert.match(source, /transformCrossbowPose/, 'crossbow stance retains portrait-orbit vertical aiming');
assert.doesNotMatch(source, /PerspectiveCamera/, 'combat aim never hooks the camera class');
assert.doesNotMatch(source, /prototype\.lookAt/, 'combat aim never replaces camera lookAt');
assert.doesNotMatch(source, /this\.position\.set/, 'combat aim never writes camera position');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const length = Math.sqrt(this.lengthSq()) || 1;
    this.x /= length; this.y /= length; this.z /= length;
    return this;
  }
}

let sceneRaycasts = 0;
let sceneHits = [];
class Raycaster {
  constructor() { this.ray = { origin: new Vector3(), direction: new Vector3() }; this.near = 0; this.far = Infinity; }
  set(origin, direction) { this.ray.origin = origin.clone(); this.ray.direction = direction.clone(); return this; }
  intersectObjects() { sceneRaycasts++; return sceneHits.filter(hit => hit.distance >= this.near && hit.distance <= this.far); }
}

let heldMode = 'tool';
let activeTool = 'ranged';
let equipped = 'crossbow';
let loaded = true;
let thrownCharge = null;
let sliderValue = 0.60;
let sliderDispatches = 0;
let injectedRangedDeps = null;
let lastRangedVisual = null;
let lastMeleeHitOptions = null;
const player = { x: 128, y: 192, angle: 0 };
const targetActor = { x: 400, y: 192, id: 'dummy' };
const avatarRoot = { name: 'player-avatar', parent: null, visible: true, userData: { handAttachY: 0.45 } };
const debugMesh = { isMesh: true, name: 'debug-helper-plane', parent: null, visible: true, material: { visible: true, opacity: 1 } };
const playerMesh = { isMesh: true, name: 'player-body', parent: avatarRoot, visible: true, material: { visible: true, opacity: 1 } };
const wallMesh = { isMesh: true, name: 'farm-wall', parent: null, visible: true, material: { visible: true, opacity: 1 } };
const scene = { children: [debugMesh, avatarRoot, wallMesh] };
sceneHits = [
  { object: debugMesh, distance: 4, point: new Vector3(4, 2.4, 3) },
  { object: playerMesh, distance: 5, point: new Vector3(5, 2.7, 3) },
  { object: wallMesh, distance: 6, point: new Vector3(6, 3, 3) },
];

const listeners = new Map();
const slider = {
  get value() { return String(sliderValue); },
  set value(value) { sliderValue = Number(value); },
  addEventListener(type, fn) { listeners.set(type, fn); },
  dispatchEvent(event) {
    sliderDispatches++;
    listeners.get(event.type)?.(event);
    return true;
  },
};
const storage = new Map();
const logs = [];
const combatDeps = {
  TILE: 64,
  player,
  getHeldMode: () => heldMode,
  getActiveTool: () => activeTool,
  getActorWorldY: () => 0,
  worldSurfaceY: () => 0,
  getActiveScene: () => scene,
  getPlayerInteractionRay: () => ({ origin: { x: 0, y: 1, z: 3 }, direction: { x: 1, y: 0, z: 0 } }),
  getPlayerMeleeAimDirection: () => ({ x: 0, y: 0, z: 1 }),
  getPlayerMeleeAimPitch: () => 0,
  currentWeaponKey: () => 'hatchet',
  currentComboAbilityId: () => 'swingCombo',
  weaponAbility: () => ({ rangePx: 64 * 1.05 }),
  toolHolder: () => null,
  triggerWeaponSwingVisual() {},
  triggerWeaponHoldVisual() {},
  beginCombatLunge() {},
};

const windowStub = {
  THREE: { Vector3, Raycaster },
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: { distanceTiles: 2.6 } } } } },
  Combat: {
    deps: combatDeps,
    loadout: { getSlot: () => 'swingCombo' },
    comboData: {
      swingCombo: [{ rangeMul: 1 }, { rangeMul: 1.05 }, { rangeMul: 1.15 }],
      RANGE_SCALE: 0.6,
    },
    meleeHit(attacker, target, options) { lastMeleeHitOptions = options; return true; },
  },
  CombatProgression: { getEffects: () => ({ stats: {} }) },
  RangedWeapons: {
    config: {
      crossbow: { rangedType: 'crossbow', rangeTiles: 9 },
      scatterbow: { rangedType: 'scatterbow', rangeTiles: 6.5 },
      blowgun: { rangedType: 'blowgun', rangeTiles: 8 },
      kylie: { rangedType: 'thrown', rangeTiles: 7 },
    },
    init(deps) { injectedRangedDeps = deps; },
    equippedRangedKey: () => equipped,
    isLoaded: () => loaded,
    playerIdlePose: () => ({ x: 0.23, y: 0.08, z: 0.14, pitch: 16, yaw: 65, bodyYaw: -52, roll: 11, scale: 1.77 }),
    actorHitbox: actor => ({ center: actor === player ? new Vector3(2, 0.5, 3) : new Vector3(6, 0.5, 3) }),
    update() {},
  },
  HobunjiRangedWeaponArchetypes: { debugSnapshot: () => ({ thrownCharge }) },
  __farmLog: message => logs.push(message),
};

const context = {
  window: windowStub,
  document: {
    readyState: 'complete',
    getElementById: id => id === 'settingShoulderSurfOffsetH' ? slider : null,
    addEventListener() {},
  },
  Event: class Event { constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); } },
  Math,
  Date,
  performance: { now: () => 1000 },
  console,
};
vm.runInNewContext(source, context, { filename: 'ranged-camera-focus.js' });

windowStub.RangedWeapons.init({
  TILE: 64,
  player,
  getActorWorldY: () => 0,
  worldSurfaceY: () => 0,
  getActiveScene: () => scene,
  getPlayerAimPitch: () => 0,
  getPlayerAimRay: () => ({ origin: { x: 0, y: 1, z: 3 }, direction: { x: 1, y: 0, z: 0 } }),
  getPlayerInteractionRay: () => ({ origin: { x: 0, y: 1, z: 3 }, direction: { x: 1, y: 0, z: 0 } }),
  getPlayerAvatarGroup: () => avatarRoot,
  getEquippedRangedKey: () => equipped,
  triggerRangedWeaponVisual: (durationS, options) => { lastRangedVisual = { durationS, options }; },
});
assert(injectedRangedDeps, 'wrapped ranged init still reaches the original initializer');

// First-surface targeting ignores debug helpers and the player's own portrait,
// then converges the shot from its real projectile origin on the first valid wall.
const rangedTarget = windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(rangedTarget.source, 'interaction-first-surface');
assert.equal(rangedTarget.surfaceName, 'farm-wall');
assert.equal(rangedTarget.point.x, 6);
const sharedRay = injectedRangedDeps.getPlayerAimRay();
assert.equal(sharedRay.origin.x, 2, 'ranged ray starts at the projectile/player origin');
assert(sharedRay.direction.x > 0.84 && sharedRay.direction.y > 0.5, 'ranged shot converges from the muzzle toward the shared 3D surface point');
const raycastsAfterFirstResolve = sceneRaycasts;
windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(sceneRaycasts, raycastsAfterFirstResolve, 'scene surface raycast is cached within the rendered frame');

function settle(frames = 90) {
  for (let i = 0; i < frames; i++) windowStub.RangedWeapons.update(1 / 60);
}

// Existing ready-state zoom and independent shoulder framing are retained; the
// adapter reports explicitly that the native Shoulder Cam transform is untouched.
windowStub.RangedWeapons.update(1 / 60);
assert(windowStub.SCRATCHBONES_CONFIG.game.camera.modes.shoulderSurf.distanceTiles < 2.6, 'loaded crossbow still starts easing camera distance inward');
assert.equal(sliderValue, 0.60, 'first focus tick waits for game.js to expose the authored Combat shoulder preset');
windowStub.RangedWeapons.update(1 / 60);
assert(sliderValue < 0.60, 'loaded crossbow still eases toward its separate ranged-focus shoulder offset');
let focusSnapshot = windowStub.HobunjiRangedCameraFocus.snapshot();
assert.equal(focusSnapshot.cameraMutation, 'native-shoulder-camera-only');
assert.equal(focusSnapshot.aimAlignment, 'shared-3d-interaction-target-native-camera');

windowStub.HobunjiRangedCameraFocus.setFocusHorizontalOffset(-0.35);
assert.equal(storage.get('hobunjiRangedFocusShoulderOffsetH'), '-0.35', 'separate focus shoulder offset still persists independently');
settle(30);
assert(sliderValue < 0.18, 'live focused framing follows the separately-authored focus shoulder value');

// Crossbow/scatterbow loaded stance uses the same resolved 3D target pitch and
// continues rotating its whole pose around the portrait center.
const pitchedPose = windowStub.RangedWeapons.playerIdlePose('crossbow');
assert(pitchedPose.y > 0.08, 'upward surface target moves the crossbow stance upward around the portrait pivot');
assert(pitchedPose.pitch < 0, 'upward surface target pitches the authored crossbow pose upward');
injectedRangedDeps.triggerRangedWeaponVisual(1, {
  pose: {
    neutral: { y: 0.08, z: 0.14, pitch: 16 },
    windup: { y: 0.14, z: 0.11, pitch: -9 },
    strike: { y: 0.11, z: 0.12, pitch: -9 },
  },
});
assert(lastRangedVisual.options.pose.neutral.y > 0.08, 'fire animation pose receives the same portrait-orbit transform');

// Melee falls back to the combo's maximum reach while the wall is too far away,
// then the real windup range makes that same first surface the shared target.
activeTool = 'weapon';
windowStub.RangedWeapons.update(1 / 60);
let meleeTarget = windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(meleeTarget.mode, 'melee');
assert.equal(meleeTarget.source, 'interaction-range-fallback', 'idle short combo cannot select a surface outside its reach');
combatDeps.triggerWeaponSwingVisual(0.5, { coneRangePx: 64 * 4.5, coneAngle: player.angle });
meleeTarget = windowStub.HobunjiRangedCameraFocus.interactionAimTarget();
assert.equal(meleeTarget.source, 'interaction-first-surface', 'windup switches targeting to the attack-specific reach');
assert.equal(meleeTarget.surfaceName, 'farm-wall');
windowStub.Combat.meleeHit(player, targetActor, { rangePx: 64 * 4.5, halfConeRad: 0.4, yaw: Math.PI / 2, pitch: 0 });
assert(lastMeleeHitOptions.direction.x > 0.8 && lastMeleeHitOptions.direction.y > 0.5, 'actual melee collision overrides stale yaw/pitch with the shared 3D target direction');

// Other ranged archetypes retain the original readiness contract.
activeTool = 'ranged';
for (const itemKey of ['scatterbow', 'blowgun']) {
  equipped = itemKey;
  loaded = true;
  windowStub.RangedWeapons.update(1 / 60);
  const state = windowStub.HobunjiRangedCameraFocus.snapshot();
  assert.equal(state.active, true, `${itemKey} focuses while loaded`);
  assert.equal(state.reason, 'loaded', `${itemKey} reports the loaded focus reason`);
}

equipped = 'crossbow';
loaded = false;
settle();
assert(Math.abs(windowStub.SCRATCHBONES_CONFIG.game.camera.modes.shoulderSurf.distanceTiles - 2.6) < 0.01, 'camera distance restores after the shot');
assert(Math.abs(sliderValue - 0.60) < 0.01, 'ordinary Combat horizontal offset restores after the shot');

equipped = 'kylie';
thrownCharge = { itemKey: 'kylie', startedAt: 10 };
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().reason, 'thrown-windup');
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, true);
thrownCharge = null;
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, false, 'releasing a thrown weapon ends tight focus immediately');

activeTool = 'weapon';
equipped = 'crossbow';
loaded = true;
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, false, 'loaded ranged slot does not focus while melee is actually out');

activeTool = 'ranged';
settle(8);
const dispatchesBeforePutAway = sliderDispatches;
activeTool = 'hoe';
settle(20);
assert.equal(sliderDispatches, dispatchesBeforePutAway, 'putting combat away never writes the temporary Combat preset into Default');
assert(logs.some(line => line.includes('native camera untouched')), 'transition log makes native-camera ownership visible on mobile');
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.tightDistanceTiles, 1.55);
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.defaultFocusHorizontalOffsetTiles, 0.18);
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.crossbowVerticalPitchLimitDeg, 70);
console.log('Shared interaction-target combat aim checks passed.');

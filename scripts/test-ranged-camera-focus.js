#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/ranged-camera-focus.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');

assert.match(
  loader,
  /ranged-weapon-archetypes\.js[\s\S]*ranged-camera-focus\.js[\s\S]*ranged-dual-role-anim-style\.js/,
  'attack camera loads after ranged archetypes and before the dual-role animation bridge',
);
assert.match(loader, /ranged-camera-focus\.js\?v=20260906c[\s\S]*HobunjiRangedCameraFocus\?\.version\) >= 3/, 'loader requires the attack-authoritative v3 adapter');
assert.match(source, /settingRangedFocusShoulderOffsetH/, 'ranged focus owns a separate shoulder-offset Settings control');
assert.match(source, /camera-to-authoritative-attack-range-point/, 'camera alignment explicitly follows the attack instead of steering the attack toward the camera');
assert.match(source, /getPlayerAimRay: \(\) => authoritativeRangedAimRay\(\)/, 'RangedWeapons receives a player-facing authoritative shot ray');
assert.match(source, /triggerWeaponSwingVisual = function attackCameraRangeAwareSwing/, 'melee windups report their real attack cone range to the camera');
assert.match(source, /transformCrossbowPose/, 'crossbow stance has a portrait-orbit vertical-aim transform');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const length = Math.sqrt(this.lengthSq()) || 1;
    this.x /= length; this.y /= length; this.z /= length;
    return this;
  }
}
class PerspectiveCamera {
  constructor() { this.isPerspectiveCamera = true; this.position = new Vector3(); this.lastLookAt = null; }
  lookAt(x, y, z) {
    this.lastLookAt = x && typeof x === 'object' ? { x: x.x, y: x.y, z: x.z } : { x, y, z };
  }
}

let heldMode = 'tool';
let activeTool = 'ranged';
let equipped = 'crossbow';
let loaded = true;
let thrownCharge = null;
let aimPitch = 0;
let sliderValue = 0.60;
let sliderDispatches = 0;
let injectedRangedDeps = null;
let lastRangedVisual = null;
const player = { x: 128, y: 192, angle: 0 };
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
  getPlayerMeleeAimPitch: () => aimPitch,
  currentWeaponKey: () => 'hatchet',
  currentComboAbilityId: () => 'swingCombo',
  weaponAbility: () => ({ rangePx: 64 * 1.05 }),
  triggerWeaponSwingVisual() {},
  triggerWeaponHoldVisual() {},
  beginCombatLunge() {},
};
const windowStub = {
  THREE: { Vector3, PerspectiveCamera },
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
    actorHitbox: () => ({ center: new Vector3(2, 0.5, 3) }),
    update() {},
  },
  HobunjiRangedWeaponArchetypes: { debugSnapshot: () => ({ thrownCharge }) },
  __hobunjiFurnitureDebug: { camState: { mode: 'shoulderSurf', position: { x: 0, y: 1, z: 3 } } },
  __farmLog: message => logs.push(message),
};
const context = {
  window: windowStub,
  document: {
    readyState: 'complete',
    getElementById: id => id === 'settingShoulderSurfOffsetH' ? slider : null,
    addEventListener() {},
  },
  Event: class Event {
    constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); }
  },
  Math,
  Date,
  performance: { now: () => 1000 },
  console,
};
vm.runInNewContext(source, context, { filename: 'ranged-camera-focus.js' });

// game.js still supplies its normal camera ray, but RangedWeapons receives a
// replacement ray whose horizontal direction comes from player.angle. Vertical
// pitch remains the ordinary look pitch so up/down aiming is still controllable.
windowStub.RangedWeapons.init({
  TILE: 64,
  player,
  getActorWorldY: () => 0,
  worldSurfaceY: () => 0,
  getPlayerAimAngle: () => Math.PI / 2,
  getPlayerAimPitch: () => aimPitch,
  getPlayerAimRay: () => ({ origin: new Vector3(0, 1, 0), direction: new Vector3(0, 0, 1) }),
  getPlayerAvatarGroup: () => ({ userData: { handAttachY: 0.45 } }),
  getEquippedRangedKey: () => equipped,
  triggerRangedWeaponVisual: (durationS, options) => { lastRangedVisual = { durationS, options }; },
});
assert(injectedRangedDeps, 'wrapped ranged init still reaches the original initializer');
let authoritativeRay = injectedRangedDeps.getPlayerAimRay();
assert(Math.abs(authoritativeRay.direction.x - 1) < 1e-9, 'shot ray follows player facing instead of the camera yaw');
assert(Math.abs(authoritativeRay.direction.z) < 1e-9, 'camera +Z ray no longer steers a player facing +X');
assert.equal(authoritativeRay.origin.y, 0.55, 'authoritative ray starts at the same projectile-height convention as ranged shots');

function settle(frames = 90) {
  for (let i = 0; i < frames; i++) windowStub.RangedWeapons.update(1 / 60);
}

// A load/fire weapon focuses only once its authoritative loaded flag is true.
windowStub.RangedWeapons.update(1 / 60);
assert(windowStub.SCRATCHBONES_CONFIG.game.camera.modes.shoulderSurf.distanceTiles < 2.6, 'loaded crossbow starts easing camera distance inward');
assert.equal(sliderValue, 0.60, 'first focus tick waits for game.js to expose the Combat horizontal preset');
windowStub.RangedWeapons.update(1 / 60);
assert(sliderValue < 0.60, 'loaded crossbow eases the shoulder framing toward the separate ranged-focus preset');
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().reason, 'loaded');
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().aimAlignment, 'camera-to-authoritative-attack-range-point');

// Shoulder Cam's final lookAt is redirected to the point at the actual shot's
// intended range. Camera orbit/position remains separate, so input can still turn.
const camera = new PerspectiveCamera();
camera.position.set(0, 1, 3);
camera.lookAt(0, 0, 0);
assert(Math.abs(camera.lastLookAt.x - 11) < 1e-9, 'camera looks nine tiles forward from the projectile origin along player facing');
assert(Math.abs(camera.lastLookAt.z - 3) < 1e-9, 'camera range point lies on the authoritative shot axis');

// The ranged-focus shoulder value is independent of the ordinary Combat preset.
windowStub.HobunjiRangedCameraFocus.setFocusHorizontalOffset(-0.35);
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.focusHorizontalOffsetTiles, -0.35, 'separate focus shoulder offset is independently authorable');
assert.equal(storage.get('hobunjiRangedFocusShoulderOffsetH'), '-0.35', 'focus shoulder offset persists independently');
settle(30);
assert(sliderValue < 0.18, 'live focused framing follows the separately-authored focus shoulder value');

// Crossbow/scatterbow loaded stance rotates around the portrait center as
// vertical aim changes: position follows the orbit and the whole pose pitches.
aimPitch = Math.PI / 6;
const pitchedPose = windowStub.RangedWeapons.playerIdlePose('crossbow');
assert(pitchedPose.y > 0.08, 'aiming upward moves the crossbow stance upward around the portrait pivot');
assert(Math.abs(pitchedPose.pitch + 14) < 1e-9, '30-degree upward aim rotates the authored 16-degree pose by the same amount');
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().verticalStance.pitchDeg, 30, 'vertical stance pitch is mobile-debug visible');
injectedRangedDeps.triggerRangedWeaponVisual(1, {
  pose: {
    neutral: { y: 0.08, z: 0.14, pitch: 16 },
    windup: { y: 0.14, z: 0.11, pitch: -9 },
    strike: { y: 0.11, z: 0.12, pitch: -9 },
  },
});
assert(lastRangedVisual.options.pose.neutral.y > 0.08, 'fire animation pose set receives the same portrait-orbit vertical rotation');

// Scatterbow and Blowgun share the existing loaded-ready camera zoom contract.
for (const itemKey of ['scatterbow', 'blowgun']) {
  equipped = itemKey;
  loaded = true;
  windowStub.RangedWeapons.update(1 / 60);
  const state = windowStub.HobunjiRangedCameraFocus.snapshot();
  assert.equal(state.active, true, `${itemKey} focuses while loaded`);
  assert.equal(state.reason, 'loaded', `${itemKey} reports the loaded focus reason`);
}

// Melee normally looks to the equipped combo's maximum reach, then switches to
// the real attack cone reach as soon as a windup reports it.
activeTool = 'weapon';
equipped = 'crossbow';
aimPitch = 0;
windowStub.RangedWeapons.update(1 / 60);
const idleMeleeTarget = windowStub.HobunjiRangedCameraFocus.attackCameraTarget();
assert.equal(idleMeleeTarget.mode, 'melee');
assert.equal(idleMeleeTarget.source, 'combo-max-range');
combatDeps.triggerWeaponSwingVisual(0.5, { coneRangePx: 64 * 4.5, coneAngle: player.angle });
const quickAttackTarget = windowStub.HobunjiRangedCameraFocus.attackCameraTarget();
assert(Math.abs(quickAttackTarget.rangeTiles - 4.5) < 1e-9, 'melee camera convergence changes to the exact windup attack range');
assert.equal(quickAttackTarget.source, 'swing-windup');

// Firing empties the ranged weapon; tight zoom and temporary horizontal framing restore.
activeTool = 'ranged';
equipped = 'crossbow';
loaded = false;
settle();
assert(Math.abs(windowStub.SCRATCHBONES_CONFIG.game.camera.modes.shoulderSurf.distanceTiles - 2.6) < 0.01, 'camera distance restores after the shot');
assert(Math.abs(sliderValue - 0.60) < 0.01, 'ordinary Combat horizontal offset restores after the shot');

// Thrown weapons focus only during their existing hold/release charge.
equipped = 'kylie';
loaded = false;
thrownCharge = { itemKey: 'kylie', startedAt: 10 };
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().reason, 'thrown-windup');
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, true);
thrownCharge = null;
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, false, 'releasing a thrown weapon ends tight focus immediately');

// A loaded ranged slot is insufficient for tight focus if the ranged weapon is not actually out.
equipped = 'crossbow';
loaded = true;
activeTool = 'weapon';
windowStub.RangedWeapons.update(1 / 60);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, false);
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().reason, 'ranged-not-out');

// Putting combat away never writes the temporary Combat preset into the Default preset.
activeTool = 'ranged';
settle(8);
const dispatchesBeforePutAway = sliderDispatches;
activeTool = 'hoe';
settle(20);
assert.equal(sliderDispatches, dispatchesBeforePutAway, 'no synthetic horizontal writes happen while a non-combat tool is out');

assert(logs.some(line => line.includes('focus ON')), 'focus transitions are mirrored into the in-game debug log');
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.tightDistanceTiles, 1.55, 'tight zoom target remains explicit and inspectable');
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.defaultFocusHorizontalOffsetTiles, 0.18, 'separate ranged focus shoulder default remains explicit and inspectable');
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.crossbowVerticalPitchLimitDeg, 70, 'vertical crossbow stance clamp remains explicit and inspectable');
console.log('Ranged/attack camera focus checks passed.');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/ranged-camera-focus.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const rangedSource = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8');

assert.match(
  loader,
  /ranged-weapon-archetypes\.js[\s\S]*ranged-camera-focus\.js[\s\S]*ranged-dual-role-anim-style\.js/,
  'camera focus loads after ranged archetypes and before the dual-role animation bridge',
);
assert.match(source, /settingRangedFocusShoulderOffsetH/, 'ranged focus owns a separate shoulder-offset Settings control');
assert.match(source, /Ranged Focus Shoulder Offset/, 'separate ranged focus setting has a visible player-facing label');

// Shoulder-cam parallax is already resolved by the ranged core: it samples the
// real center camera ray, chooses a point on that ray, then aims from the
// projectile origin to that point. A second camera-yaw correction here would
// move the ray and create a feedback loop instead of improving shot alignment.
assert.match(rangedSource, /const cameraRay = normalizedAimRay\(deps\.getPlayerAimRay\?\.\(\)\)/, 'ranged aim samples the real camera center ray');
assert.match(rangedSource, /targetPoint = cameraRay\.origin\.clone\(\)\.addScaledVector\(cameraRay\.direction/, 'empty-space aim selects a point on the camera ray');
assert.match(rangedSource, /direction = targetPoint\.clone\(\)\.sub\(origin\)/, 'projectile direction converges from muzzle/origin to the camera-ray target point');
assert.doesNotMatch(source, /azimuthDeg\s*=/, 'focus adapter does not double-correct camera yaw on top of the core convergence solve');

let heldMode = 'tool';
let activeTool = 'ranged';
let equipped = 'crossbow';
let loaded = true;
let thrownCharge = null;
let sliderValue = 0.60;
let sliderDispatches = 0;
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
const windowStub = {
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: { distanceTiles: 2.6 } } } } },
  Combat: { deps: { getHeldMode: () => heldMode, getActiveTool: () => activeTool } },
  RangedWeapons: {
    config: {
      crossbow: { rangedType: 'crossbow' },
      scatterbow: { rangedType: 'scatterbow' },
      blowgun: { rangedType: 'blowgun' },
      kylie: { rangedType: 'thrown' },
    },
    equippedRangedKey: () => equipped,
    isLoaded: () => loaded,
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
  Event: class Event {
    constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); }
  },
  Math,
  console,
};
vm.runInNewContext(source, context, { filename: 'ranged-camera-focus.js' });

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
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().aimAlignment, 'core-camera-ray-convergence');

// The ranged-focus shoulder value is independent of the ordinary Combat preset.
windowStub.HobunjiRangedCameraFocus.setFocusHorizontalOffset(-0.35);
assert.equal(windowStub.HobunjiRangedCameraFocus.tuning.focusHorizontalOffsetTiles, -0.35, 'separate focus shoulder offset is independently authorable');
assert.equal(storage.get('hobunjiRangedFocusShoulderOffsetH'), '-0.35', 'focus shoulder offset persists independently');
settle(30);
assert(sliderValue < 0.18, 'live focused framing follows the separately-authored focus shoulder value');

// Scatterbow and Blowgun share the same loaded-ready contract.
for (const itemKey of ['scatterbow', 'blowgun']) {
  equipped = itemKey;
  loaded = true;
  windowStub.RangedWeapons.update(1 / 60);
  const state = windowStub.HobunjiRangedCameraFocus.snapshot();
  assert.equal(state.active, true, `${itemKey} focuses while loaded`);
  assert.equal(state.reason, 'loaded', `${itemKey} reports the loaded focus reason`);
}

// Firing empties the weapon; both camera values restore to their authored values.
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
assert.equal(windowStub.HobunjiRangedCameraFocus.snapshot().active, false, 'releasing a thrown weapon ends focus immediately');

// A loaded ranged slot is insufficient if the ranged weapon is not actually out.
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
console.log('Ranged camera focus checks passed.');

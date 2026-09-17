#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8');
assert.match(source, /ensureShoulderPetHeadDeadzone\(companion\)/,
  'shoulder-pet attachment path installs a visual head deadzone');
assert.match(source, /CREATURE_PERP_DEAD_RAD/,
  'shoulder-pet head yaw reuses the global creature deadzone radius');
assert.match(source, /shoulderHeadDeadzone:/,
  'mobile-readable attachment diagnostics expose shoulder-pet head deadzone state');

let shoulderProvider = null;
const player = {};
const appliedYaw = [];
const avatarRef = {
  group: {},
  headRig: { currentYawDeg: 0 },
  updateHeadYaw(yawDeg) {
    appliedYaw.push(yawDeg);
    this.headRig.currentYawDeg = yawDeg;
    return yawDeg;
  },
};
const companion = {
  health: 10,
  stableRole: 'shoulderPet',
  master: player,
  pngRot: 0,
  perpState: { pixelProbeDebug: { cameraPerpsRad: [0, Math.PI] } },
  avatarRef,
  def: { sprites: { idle: 'idle.png' } },
  currentFrameUrl: 'idle.png',
};
const context = {
  console,
  Math,
  Object,
  Array,
  Number,
  window: {
    PlayerBodyTransformComposer: {
      registerExternalRootProvider(name, provider) {
        if (name === 'shoulderPets') shoulderProvider = provider;
      },
    },
    Combat: {
      deps: {
        player,
        companionObjects: [companion],
        setCreatureFrame() {},
      },
    },
    PerpRotation: {
      CREATURE_PERP_DEAD_RAD: Math.PI / 6,
      perpClamp(_state, _raw, _perps, deadzoneRad) {
        return { effectiveTarget: deadzoneRad };
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(source, context);
assert.equal(typeof shoulderProvider, 'function', 'shoulder pet provider is registered');
shoulderProvider();
assert.equal(avatarRef.__hobunjiShoulderHeadDeadzoneWrapped, true,
  'active shoulder pet gets exactly one head-yaw wrapper');
avatarRef.updateHeadYaw(0, 1 / 60);
assert.ok(Math.abs(appliedYaw.at(-1) - 30) < 1e-9,
  'requested head yaw is clamped to the creature deadzone edge before reaching the shared head rig');
const debug = context.window.PlayerBodyAttachmentBridge.getDebug().shoulderHeadDeadzone;
assert.equal(debug.active, true, 'debug record reports an active shoulder-pet head deadzone');
assert.equal(debug.requestedYawDeg, 0, 'debug record preserves the requested head yaw');
assert.ok(Math.abs(debug.renderedYawDeg - 30) < 1e-9,
  'debug record exposes the clamped rendered yaw');

console.log('Shoulder-pet head deadzone checks passed.');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Guards delivery of bridge changes through the browser cache boundary.
assert.match(source, /ensureShoulderPetHeadDeadzone\(companion\)/,
  'shoulder-pet attachment path installs a visual head deadzone');
assert.match(source, /CREATURE_PERP_DEAD_RAD/,
  'shoulder-pet head yaw reuses the global creature deadzone radius');
assert.match(source, /perspectivePerpsForState\(bodyState, fallbackCameraPerps \|\| \[\]\)/,
  'shoulder-pet head yaw asks the live subject-aware camera resolver for deadzone centers');
assert.match(source, /shoulderHeadDeadzone:/,
  'mobile-readable attachment diagnostics expose shoulder-pet head deadzone state');
assert.match(loaderSource, /player-body-attachment-bridge\.js\?v=20260916headdeadzone1/,
  'the runtime loader cache-busts the changed shoulder-pet attachment bridge');

let shoulderProvider = null;
let perspectiveResolveCount = 0; // Used below to prove the runtime path prefers the live screen-view resolver over stale probe fallback data.
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
  perpState: { pixelProbeDebug: { cameraPerpsRad: [Math.PI / 2, -Math.PI / 2] } },
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
  Set,
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
      perspectivePerpsForState(state, fallbackPerps) {
        perspectiveResolveCount++;
        assert.equal(state, companion.perpState, 'live perspective resolver receives the companion body rotation state');
        assert.deepEqual(Array.from(fallbackPerps), [Math.PI / 2, -Math.PI / 2],
          'live perspective resolver receives the previous body-plane probe centers as fallback only');
        return [0, Math.PI];
      },
      perpClamp(_state, _raw, perps, deadzoneRad) {
        assert.deepEqual(Array.from(perps), [0, Math.PI],
          'head clamp consumes live perspective centers rather than stale probe fallback centers');
        return { effectiveTarget: deadzoneRad };
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(source, context);
assert.equal(typeof shoulderProvider, 'function', 'shoulder pet provider is registered');
shoulderProvider();
const firstWrappedUpdate = avatarRef.updateHeadYaw; // Used below to prove rediscovery does not stack another deadzone wrapper.
shoulderProvider();
assert.equal(avatarRef.updateHeadYaw, firstWrappedUpdate,
  'repeated render-root discovery does not stack shoulder-pet head-yaw wrappers');
assert.equal(avatarRef.__hobunjiShoulderHeadDeadzoneWrapped, true,
  'active shoulder pet gets the deadzone wrapper marker');
avatarRef.updateHeadYaw(0, 1 / 60);
assert.equal(perspectiveResolveCount, 1,
  'one head-yaw update resolves the current screen-view deadzone exactly once');
assert.ok(Math.abs(appliedYaw.at(-1) - 30) < 1e-9,
  'requested head yaw is clamped to the creature deadzone edge before reaching the shared head rig');
const debug = context.window.PlayerBodyAttachmentBridge.getDebug().shoulderHeadDeadzone;
assert.equal(debug.active, true, 'debug record reports an active shoulder-pet head deadzone');
assert.equal(debug.requestedYawDeg, 0, 'debug record preserves the requested head yaw');
assert.ok(Math.abs(debug.renderedYawDeg - 30) < 1e-9,
  'debug record exposes the clamped rendered yaw');

console.log('Shoulder-pet head deadzone checks passed.');

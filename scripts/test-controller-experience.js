'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const helperSource = fs.readFileSync('docs/js/controller-input.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const uiSource = fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8');
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const context = { window: {} }; // Receives the browser helper namespace for deterministic stick-response tests.
vm.runInNewContext(helperSource, context);
const { normalizeStick, pickActiveGamepad } = context.window.ControllerInput;

assert.deepEqual(
  JSON.parse(JSON.stringify(normalizeStick(0.1, -0.1, 0.24, 1.25))),
  { x: 0, y: 0, magnitude: 0, rawMagnitude: Math.hypot(0.1, -0.1) },
  'small center drift is rejected radially',
);
const diagonal = normalizeStick(0.75, 0.75, 0.24, 1.25);
assert.ok(Math.abs(diagonal.x - diagonal.y) < 1e-9, 'diagonal direction is preserved');
assert.ok(diagonal.magnitude <= 1 && diagonal.magnitude > 0.9, 'outer diagonal throw stays strong and bounded');
const full = normalizeStick(1, 0, 0.24, 1.45);
assert.equal(full.x, 1, 'full horizontal throw still reaches full output');
assert.equal(full.y, 0, 'full horizontal throw does not introduce vertical drift');

const idlePreferred = { index: 0, connected: true, axes: [0, 0], buttons: [] };
const activeSecond = { index: 1, connected: true, axes: [0.8, 0], buttons: [] };
assert.equal(pickActiveGamepad([idlePreferred, activeSecond], 0).index, 1, 'deliberate input can take ownership from an idle preferred pad');
assert.equal(pickActiveGamepad([idlePreferred, activeSecond], 1).index, 1, 'active preferred pad keeps ownership');
assert.equal(pickActiveGamepad([null, idlePreferred, null], 0).index, 0, 'sparse browser gamepad slots are ignored safely');
assert.equal(pickActiveGamepad([null, undefined], 0), null, 'empty browser gamepad slots report no active controller');

assert.match(gameSource, /pollControllerInput\(\);\s*applyControllerCameraLook\(dt\);\s*updateMeleeAutoTarget\(dt\);/, 'controller camera rotation is applied before movement/combat updates');
assert.match(gameSource, /cameraAzimuthOffsetDeg = freeRotateCameraActive\(\)[\s\S]{0,520}cameraAngleOffsetDeg = clampCameraPitchOffsetDeg/, 'right stick updates yaw and uses the shared directional pitch clamp');
assert.match(gameSource, /if \(!gamepadState\.uiOwned\) releaseControllerGameplayInput\('released to menu'\)/, 'opening a menu releases held gameplay actions exactly once');
assert.match(gameSource, /if \(gamepadState\.primeButtonsOnResume\)[\s\S]{0,500}gamepadState\.previous = new Set\(down\)/, 'the button used to close a menu is primed instead of ghost-firing in gameplay');
assert.match(gameSource, /gamepadState\.actionByButton\.set\(button, actionId\)[\s\S]{0,700}gamepadState\.actionByButton\.get\(button\)/, 'controller releases remain paired with the action originally pressed across mode-shift changes');
assert.match(gameSource, /window\.HOBUNJI_CONTROLLER_STATUS = status/, 'controller state is exposed to in-game diagnostics');
assert.match(probeSource, /Controller: #\$\{controllerDebug\.index\}[\s\S]{0,260}owner=\$\{controllerDebug\.owner\}/, 'Pixel Probe includes controller identity and current input owner');
assert.match(uiSource, /function adjustFocusedControl\(delta\)/, 'menu sliders, number inputs, and selects are controller-adjustable');
assert.match(uiSource, /scrollStick[\s\S]{0,900}scrollTop \+=/, 'right stick scrolls long menu panes');
assert.match(uiSource, /hobunji-controller-owner-change[\s\S]{0,180}owner: 'menu'/, 'menu ownership is announced even while the gameplay loop is paused');
assert.match(indexSource, /id="settingControllerLookSensitivity"[\s\S]{0,700}id="settingControllerInvertY"/, 'camera sensitivity and invert-Y settings are present');
const controllerHelperIndex = indexSource.indexOf('controller-input.js?v=20260909controller1'); // Used to verify parser order without assuming a maximum HTML distance between scripts.
const gameScriptIndex = indexSource.indexOf('game.js?v=20260909controller1'); // Used with controllerHelperIndex to protect the helper-before-consumer contract.
assert.ok(controllerHelperIndex >= 0 && gameScriptIndex > controllerHelperIndex, 'shared controller helpers load before the cache-invalidated game script');

console.log('Controller experience checks passed.');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const helperSource = fs.readFileSync('docs/js/controller-input.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const uiSource = fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8');
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const configSource = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Used to pin every discrete formerly-hardcoded controller action in authored input config.
const settingsSource = fs.readFileSync('docs/js/input-settings-panel.js', 'utf8'); // Used to guard controller listening and JSON export controls.
const musicSource = fs.readFileSync('docs/js/music-minigame.js', 'utf8'); // Used to ensure music buttons resolve semantic actions instead of fixed Gamepad indices.
const socialSource = fs.readFileSync('docs/js/social-action-wheel.js', 'utf8'); // Used to ensure non-ButtonN bindings work for the social wheel too.
const context = { window: {} }; // Receives the browser helper namespace for deterministic stick-response tests.
vm.runInNewContext(helperSource, context);
const { normalizeStick, pickActiveGamepad, isBindingPressed, getPressedBindingCodes } = context.window.ControllerInput;

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

const bindingPadButtons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })); // Used to verify symbolic button/trigger lookup without a browser Gamepad object.
bindingPadButtons[0] = { pressed: true, value: 1 };
bindingPadButtons[6] = { pressed: false, value: 0.7 };
const bindingPad = { buttons: bindingPadButtons, axes: [0, 0, -0.8, 0.9] }; // Used to cover ordinary buttons, trigger aliases, and right-stick directional actions.
assert.equal(isBindingPressed(bindingPad, 'Button0'), true, 'ordinary ButtonN bindings resolve through the shared controller helper');
assert.equal(isBindingPressed(bindingPad, 'LeftTrigger'), true, 'trigger aliases resolve through the shared controller helper');
assert.equal(isBindingPressed(bindingPad, 'RightStickLeft'), true, 'right-stick directional actions resolve through the shared controller helper');
assert.equal(isBindingPressed(bindingPad, 'RightStickDown'), true, 'vertical right-stick directional actions resolve through the shared controller helper');
assert.ok(getPressedBindingCodes(bindingPad).includes('Button0'), 'controller listening reports supported pressed bindings');
assert.ok(getPressedBindingCodes(bindingPad).includes('LeftTrigger'), 'controller listening reports trigger aliases');

assert.match(gameSource, /pollControllerInput\(\);\s*applyControllerCameraLook\(dt\);\s*updateMeleeAutoTarget\(dt\);/, 'controller camera rotation is applied before movement/combat updates');
assert.match(gameSource, /cameraAzimuthOffsetDeg = freeRotateCameraActive\(\)[\s\S]{0,420}cameraAngleOffsetDeg = window\.FormatUtils\.clamp/, 'right stick updates both camera yaw and pitch');
assert.match(gameSource, /if \(!gamepadState\.uiOwned\) releaseControllerGameplayInput\('released to menu'\)/, 'opening a menu releases held gameplay actions exactly once');
assert.match(gameSource, /if \(gamepadState\.primeButtonsOnResume\)[\s\S]{0,500}gamepadState\.previous = new Set\(down\)/, 'the button used to close a menu is primed instead of ghost-firing in gameplay');
assert.match(gameSource, /gamepadState\.actionByButton\.set\(button, actionId\)[\s\S]{0,700}gamepadState\.actionByButton\.get\(button\)/, 'controller releases remain paired with the action originally pressed across mode-shift changes');
assert.match(gameSource, /window\.HOBUNJI_CONTROLLER_STATUS = status/, 'controller state is exposed to in-game diagnostics');
assert.match(gameSource, /inputBindings\.controller\?\.meleeAutoTargetToggle/, 'melee auto-target toggle resolves its configured controller binding');
assert.doesNotMatch(gameSource, /down\.has\('Button11'\)/, 'melee auto-target no longer bypasses configuration with a hardcoded R3 check');
assert.match(probeSource, /Controller: #\$\{controllerDebug\.index\}[\s\S]{0,260}owner=\$\{controllerDebug\.owner\}/, 'Pixel Probe includes controller identity and current input owner');
assert.match(uiSource, /function adjustFocusedControl\(delta\)/, 'menu sliders, number inputs, and selects are controller-adjustable');
assert.match(uiSource, /scrollStick[\s\S]{0,900}scrollTop \+=/, 'right stick scrolls long menu panes');
assert.match(uiSource, /hobunji-controller-owner-change[\s\S]{0,180}owner: 'menu'/, 'menu ownership is announced even while the gameplay loop is paused');
assert.match(uiSource, /UI_ACTIONS = Object\.freeze\([\s\S]{0,300}uiOpenMenu/, 'menu confirm/cancel/tab/navigation actions are semantic configurable bindings');
assert.doesNotMatch(uiSource, /BTN_CONFIRM|BTN_CANCEL|BTN_TAB_PREV|BTN_TAB_NEXT|BTN_OPEN_MENU|BTN_DPAD_/, 'universal menu navigation no longer carries physical button constants');
assert.match(settingsSource, /listenForControllerInput/, 'controller rows can capture the next physical controller input');
assert.match(settingsSource, /Copy Keyboard Controls JSON/, 'keyboard controls can be copied as JSON');
assert.match(settingsSource, /Copy Controller Controls JSON/, 'controller controls can be copied as JSON');
assert.match(settingsSource, /isControllerListening/, 'menu navigation can stand down while a controller binding is being captured');
assert.match(musicSource, /controllerButton\(gamepad, 'musicNote1'/, 'music note buttons use named configurable actions');
assert.match(musicSource, /controllerButton\(gamepad, 'musicPause'/, 'music pause uses a named configurable action');
assert.doesNotMatch(musicSource, /controllerButton\(gamepad,\s*\d+/, 'music button actions no longer pass fixed Gamepad indices');
assert.match(socialSource, /ControllerInput\?\.isBindingPressed\?\.\(pad, openCode\)/, 'social actions accept any supported configured controller binding, not just ButtonN');
assert.match(configSource, /"id": "uiOpenMenu"[\s\S]{0,120}"context": "menu"/, 'menu open/close is authored in controller configuration');
assert.match(configSource, /"id": "musicNote1"[\s\S]{0,120}"context": "music"/, 'music controls are authored in controller configuration');
assert.match(configSource, /"id": "meleeAutoTargetToggle"[\s\S]{0,160}"context": "melee"/, 'melee auto-target toggle is authored in controller configuration');
assert.match(indexSource, /id="settingControllerLookSensitivity"[\s\S]{0,700}id="settingControllerInvertY"/, 'camera sensitivity and invert-Y settings are present');
const controllerHelperIndex = indexSource.indexOf('controller-input.js?v=20260909controller2'); // Used to verify parser order without assuming a maximum HTML distance between scripts.
const gameScriptIndex = indexSource.indexOf('game.js?v=20260909controller2'); // Used with controllerHelperIndex to protect the helper-before-consumer contract.
assert.ok(controllerHelperIndex >= 0 && gameScriptIndex > controllerHelperIndex, 'shared controller helpers load before the cache-invalidated game script');

console.log('Controller experience checks passed.');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const helperSource = fs.readFileSync('docs/js/controller-input.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const uiSource = fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8');
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const settingsSource = fs.readFileSync('docs/js/input-settings-panel.js', 'utf8'); // Used to guard controller listening and JSON export controls.
const musicSource = fs.readFileSync('docs/js/music-minigame.js', 'utf8'); // Used to ensure music buttons resolve semantic actions instead of fixed Gamepad indices.
const socialSource = fs.readFileSync('docs/js/social-action-wheel.js', 'utf8'); // Used to ensure non-ButtonN bindings work for the social wheel too.
const bindingsSource = fs.readFileSync('docs/js/input-bindings.js', 'utf8'); // Used to pin selector-action migration, mount preservation, and per-device defaults behavior.
const selectorSource = fs.readFileSync('docs/js/controller-selection-ui.js', 'utf8'); // Used to guard automatic both-stick controller ownership for wheels/arches.
const resetUiSource = fs.readFileSync('docs/js/input-default-reset-ui.js', 'utf8'); // Used to guarantee separate keyboard/controller reset buttons stay attached to their own Settings sections.
const actionLocksSource = fs.readFileSync('docs/js/character-action-locks.js', 'utf8'); // Used to verify controller helpers are parser-loaded before gameplay polling can consume the same inputs.
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

const persistedResets = []; // Captures reset saves so tests prove each device reset persists through the normal storage path.
const resetEvents = []; // Captures semantic binding-change/reset events so runtime HUD consumers are refreshed after a bulk reset.
const resetContext = {
  window: {
    addEventListener() {},
    dispatchEvent(event) { resetEvents.push({ type: event.type, detail: event.detail }); },
  },
  localStorage: {
    getItem() { return null; },
    setItem(_key, value) { persistedResets.push(JSON.parse(value)); },
  },
  setInterval() { return 1; },
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
}; // Runs InputBindings independently of the browser/game closure so reset isolation can be asserted directly.
vm.runInNewContext(bindingsSource, resetContext);
const resetApi = resetContext.window.InputBindings; // Exercises the same public API used by the Settings reset buttons.
const resetDefaults = {
  storageKey: 'controller-reset-test',
  actions: [
    { id: 'interact', label: 'Interact', desktop: 'KeyE', controller: 'Button0' },
    { id: 'toolSelect', label: 'Tool Select', desktop: 'KeyT', controller: 'Button10' },
  ],
  desktop: { interact: 'KeyE', toolSelect: 'KeyT' },
  controller: { interact: 'Button0', toolSelect: 'Button10' },
  modeShifts: [
    { id: 'desktop-q', label: 'Desktop Held Q', device: 'desktop', button: 'KeyQ', bindings: { WheelUp: 'interact' } },
    { id: 'controller-custom-default', label: 'Controller Default Shift', device: 'controller', button: 'Button5', bindings: { RightStickLeft: 'interact' } },
  ],
}; // Supplies distinct authored defaults for both devices and their mode shifts.
const liveResetBindings = {
  desktop: { interact: 'KeyZ', toolSelect: 'KeyY', staleDesktop: 'KeyP' },
  controller: { interact: 'Button9', toolSelect: 'Button3', staleController: 'Button2' },
  modeShifts: [
    { id: 'desktop-custom', label: 'Desktop Custom', device: 'desktop', button: 'KeyH', bindings: { WheelDown: 'interact' } },
    { id: 'controller-custom', label: 'Controller Custom', device: 'controller', button: 'Button4', bindings: { RightStickRight: 'interact' } },
  ],
}; // Starts both devices deliberately different from defaults so cross-device mutation is easy to detect.
resetApi.init({ INPUT_DEFAULTS: resetDefaults });
resetApi.init({ INPUT_DEFAULTS: resetDefaults, getInputBindings: () => liveResetBindings });
const controllerBeforeKeyboardReset = JSON.stringify(liveResetBindings.controller); // Must remain byte-for-byte unchanged by a keyboard-only reset.
assert.equal(resetApi.resetDeviceToDefaults('desktop'), true, 'keyboard reset succeeds through the shared binding API');
assert.equal(liveResetBindings.desktop.interact, 'KeyE', 'keyboard reset restores authored desktop bindings');
assert.equal(liveResetBindings.desktop.toolSelect, 'KeyT', 'keyboard reset restores all desktop action defaults');
assert.equal(Object.prototype.hasOwnProperty.call(liveResetBindings.desktop, 'staleDesktop'), false, 'keyboard reset removes stale desktop-only saved actions');
assert.equal(JSON.stringify(liveResetBindings.controller), controllerBeforeKeyboardReset, 'keyboard reset does not alter controller bindings');
assert.ok(liveResetBindings.modeShifts.some(shift => shift.id === 'desktop-q'), 'keyboard reset restores desktop default mode shifts');
assert.ok(liveResetBindings.modeShifts.some(shift => shift.id === 'controller-custom'), 'keyboard reset preserves controller mode shifts');

liveResetBindings.desktop.interact = 'KeyX';
liveResetBindings.modeShifts = [
  { id: 'desktop-after-keyboard-reset', label: 'Desktop Preserved', device: 'desktop', button: 'KeyJ', bindings: { WheelUp: 'interact' } },
  { id: 'controller-custom-2', label: 'Controller Custom 2', device: 'controller', button: 'Button4', bindings: { RightStickRight: 'interact' } },
];
const desktopBeforeControllerReset = JSON.stringify(liveResetBindings.desktop); // Must remain byte-for-byte unchanged by a controller-only reset.
assert.equal(resetApi.resetDeviceToDefaults('controller'), true, 'controller reset succeeds through the shared binding API');
assert.equal(liveResetBindings.controller.interact, 'Button0', 'controller reset restores authored controller bindings');
assert.equal(liveResetBindings.controller.toolSelect, 'Button10', 'controller reset restores all controller action defaults');
assert.equal(Object.prototype.hasOwnProperty.call(liveResetBindings.controller, 'staleController'), false, 'controller reset removes stale controller-only saved actions');
assert.equal(JSON.stringify(liveResetBindings.desktop), desktopBeforeControllerReset, 'controller reset does not alter keyboard bindings');
assert.ok(liveResetBindings.modeShifts.some(shift => shift.id === 'controller-custom-default'), 'controller reset restores controller default mode shifts');
assert.ok(liveResetBindings.modeShifts.some(shift => shift.id === 'desktop-after-keyboard-reset'), 'controller reset preserves desktop mode shifts');
assert.ok(persistedResets.length >= 2, 'both per-device resets save through localStorage');
assert.ok(resetEvents.some(event => event.type === 'hobunji-input-bindings-reset' && event.detail?.device === 'desktop'), 'keyboard reset broadcasts a device-specific refresh event');
assert.ok(resetEvents.some(event => event.type === 'hobunji-input-bindings-reset' && event.detail?.device === 'controller'), 'controller reset broadcasts a device-specific refresh event');

const gameplayCollisionBindings = liveResetBindings.controller; // Exercises contextual dispatch without reaching into game.js internals.
gameplayCollisionBindings.interact = 'Button0';
gameplayCollisionBindings.uiConfirm = 'Button0';
assert.equal(resetApi.resolveActionForButton('controller', 'Button0'), 'interact', 'generic gameplay dispatch ignores same-button menu context actions');
gameplayCollisionBindings.meleeAutoTargetToggle = 'Button3';
const contextualDown = new Set(['Button3']);
assert.equal(resetApi.consumeControllerPress('meleeAutoTargetToggle', contextualDown, new Set(), true), true, 'contextual controller press resolves from the configured binding');
assert.equal(contextualDown.has('Button3'), false, 'contextual press is consumed before generic gameplay dispatch');
const heldContextualDown = new Set(['Button3']);
assert.equal(resetApi.consumeControllerPress('meleeAutoTargetToggle', heldContextualDown, new Set(['Button3']), true), false, 'held contextual binding does not re-edge-trigger');
assert.equal(heldContextualDown.has('Button3'), false, 'held contextual binding remains consumed while its context owns the input');

assert.match(gameSource, /if \(!gamepadState\.uiOwned\) releaseControllerGameplayInput\('released to menu'\)/, 'opening a menu releases held gameplay actions exactly once');
assert.match(gameSource, /if \(gamepadState\.primeButtonsOnResume\)[\s\S]{0,500}gamepadState\.previous = new Set\(down\)/, 'the button used to close a menu is primed instead of ghost-firing in gameplay');
assert.match(gameSource, /gamepadState\.actionByButton\.set\(button, actionId\)[\s\S]{0,700}gamepadState\.actionByButton\.get\(button\)/, 'controller releases remain paired with the action originally pressed across mode-shift changes');
assert.match(gameSource, /window\.HOBUNJI_CONTROLLER_STATUS = status/, 'controller state is exposed to in-game diagnostics');
assert.match(gameSource, /InputBindings\?\.consumeControllerPress\?\.\('meleeAutoTargetToggle'/, 'gameplay delegates the melee contextual press to the binding API');
assert.doesNotMatch(gameSource, /down\.has\('Button11'\)/, 'melee auto-target no longer bypasses configuration with a hardcoded R3 check');
assert.match(probeSource, /Controller: #\$\{controllerDebug\.index\}[\s\S]{0,260}owner=\$\{controllerDebug\.owner\}/, 'Pixel Probe includes controller identity and current input owner');
assert.match(uiSource, /function adjustFocusedControl\(delta\)/, 'menu sliders, number inputs, and selects are controller-adjustable');
assert.match(uiSource, /scrollStick[\s\S]{0,900}scrollTop \+=/, 'right stick scrolls long menu panes');
// Menu ownership is still announced while the gameplay loop is paused, but it
// is now declared through ControllerInput's registry, which emits the same
// hobunji-controller-owner-change event, instead of each module dispatching it.
assert.match(uiSource, /ControllerInput\?\.setOwner\?\.\('menu'\)/, 'the menu navigator declares menu ownership');
assert.match(
  fs.readFileSync('docs/js/controller-input.js', 'utf8'),
  /function setOwner[\s\S]{0,400}hobunji-controller-owner-change/,
  'the ownership registry still emits the owner-change event gameplay listens for',
);
assert.match(uiSource, /UI_ACTIONS = Object\.freeze\([\s\S]{0,300}uiOpenMenu/, 'menu confirm/cancel/tab/navigation actions are semantic configurable bindings');
assert.doesNotMatch(uiSource, /BTN_CONFIRM|BTN_CANCEL|BTN_TAB_PREV|BTN_TAB_NEXT|BTN_OPEN_MENU|BTN_DPAD_/, 'universal menu navigation no longer carries physical button constants');
assert.match(settingsSource, /listenForControllerInput/, 'controller rows can capture the next physical controller input');
assert.match(settingsSource, /Copy Keyboard Controls JSON/, 'keyboard controls can be copied as JSON');
assert.match(settingsSource, /Copy Controller Controls JSON/, 'controller controls can be copied as JSON');
assert.match(settingsSource, /isControllerListening/, 'menu navigation can stand down while a controller binding is being captured');
assert.match(resetUiSource, /Reset Keyboard to Defaults/, 'keyboard Settings section exposes its own Reset to Defaults button');
assert.match(resetUiSource, /Reset Controller to Defaults/, 'controller Settings section exposes its own Reset to Defaults button');
assert.match(resetUiSource, /resetDeviceToDefaults/, 'both Settings reset buttons delegate to the shared device-isolated reset API');
assert.match(resetUiSource, /window\.InputSettingsPanel\?\.render\?\.\(\)/, 'a successful reset immediately refreshes the visible binding rows');
// Asserted on the action argument rather than the source-parameter name, which
// changed from a raw Gamepad to the shared ControllerInput frame.
assert.match(musicSource, /controllerButton\(\w+, 'musicNote1'/, 'music note buttons use named configurable actions');
assert.match(musicSource, /controllerButton\(\w+, 'musicPause'/, 'music pause uses a named configurable action');
assert.doesNotMatch(musicSource, /controllerButton\(\w+,\s*\d+/, 'music button actions no longer pass fixed Gamepad indices');
// The wheel now reads the shared frame's per-code values, which run through the
// same ControllerInput decoder, so triggers and right-stick codes still resolve.
assert.match(socialSource, /frame\.isDown\(openCode\)/, 'social actions accept any supported configured controller binding, not just ButtonN');

assert.match(bindingsSource, /AUTOMATIC_SELECTION_ACTION_IDS = new Set\(\['toolSelect', 'itemSelect', 'utilityMenu', 'socialWheel'\]\)/, 'tool, item, utility, and social selectors are one automatic controller-selection class');
assert.match(bindingsSource, /id: 'itemSelect',[\s\S]{0,120}label: 'Item Select'/, 'Item Select is guaranteed to exist as a first-class controller action');
assert.match(bindingsSource, /id: 'toggleMount',[\s\S]{0,120}label: 'Call\/Dismiss Mount'/, 'Call/Dismiss Mount is guaranteed to remain a controller-configurable action');
assert.match(bindingsSource, /filter\(shift => shift\?\.id !== 'controller-left-bumper'\)/, 'the obsolete held-LB controller selector shift is migrated out of loaded and exported bindings');
assert.match(bindingsSource, /function resetDeviceToDefaults\(device\)/, 'binding core exposes one device-isolated defaults reset function');
assert.match(bindingsSource, /otherModeShifts[\s\S]{0,260}\(shift\.device \|\| 'desktop'\) !== device/, 'device reset preserves the opposite device mode shifts');
assert.match(bindingsSource, /String\(button\)\.startsWith\('RightStick'\)[\s\S]{0,180}reserved for navigating this wheel or arch/, 'selector opener actions cannot consume the stick directions they automatically own');
assert.match(bindingsSource, /targetContext === 'selection' && otherContext === 'gameplay'/, 'selector openers conflict with simultaneous gameplay actions instead of double-firing');
assert.match(bindingsSource, /function resolveActionForButton\(device, button, heldShift = null\)/, 'generic gameplay action resolution is owned by InputBindings');
assert.match(bindingsSource, /function consumeControllerPress\(actionId, down, previous, active = true\)/, 'contextual controller edge/consumption is owned by InputBindings');

assert.match(selectorSource, /toolSelect:[\s\S]{0,100}open: 'openTool'[\s\S]{0,100}step: 'scrollTool'/, 'Tool Select drives the existing shared tool arch');
assert.match(selectorSource, /itemSelect:[\s\S]{0,100}open: 'openItem'[\s\S]{0,100}step: 'scrollItem'/, 'Item Select drives the existing shared item arch');
assert.match(selectorSource, /utilityMenu:[\s\S]{0,120}open: 'openUtilities'[\s\S]{0,100}step: 'scrollEntries'/, 'Utility Menu drives the existing shared utility arch');
assert.match(selectorSource, /socialWheel:[\s\S]{0,80}kind: 'social'/, 'Social Actions is routed through the same automatic selector ownership layer');
assert.match(selectorSource, /const leftX = axis\(pad, 0\)[\s\S]{0,180}const rightX = axis\(pad, 2\)/, 'both left and right sticks provide horizontal arch navigation');
assert.match(selectorSource, /const left = \{ x: axis\(pad, 0\), y: axis\(pad, 1\)[\s\S]{0,220}const right = \{ x: axis\(pad, 2\), y: axis\(pad, 3\)/, 'both left and right sticks provide full radial social-wheel navigation');
assert.match(selectorSource, /!isDown\(frame, state\.openerCode\)[\s\S]{0,120}finishSelection\(true, 'opener released'\)/, 'releasing a selector opener commits the current choice');
assert.match(selectorSource, /arch\?\.releaseSelection\?\.\(\)/, 'arch commits reuse the existing release-selection path');
assert.match(selectorSource, /SocialActionWheel\?\.close\?\.\(commit\)/, 'social-wheel commits reuse the existing wheel close/commit path');
// Gameplay polling still stands down while a wheel or arch owns the sticks, but
// via the explicit ownership registry rather than by replacing ControllerUI's
// isActive() with a wrapper that told every consumer a menu was open.
assert.doesNotMatch(selectorSource, /ui\.isActive = wrapped/, 'selector ownership must not be implemented by patching ControllerUI.isActive');
assert.match(selectorSource, /ControllerInput\?\.setOwner\?\.\(`selection:/, 'held selectors declare ownership through the shared registry');
assert.match(gameSource, /ControllerInput\?\.gameplaySuspended\?\.\(\)/, 'automatic selector ownership suppresses ordinary gameplay controller polling while a wheel or arch owns the sticks');
assert.match(selectorSource, /CharacterActionLocks\?\.acquire/, 'held controller selectors also suppress player movement/tools/actions through the shared lock registry');
assert.match(selectorSource, /showDebug/, 'controller selector ownership has an in-page debug surface for mobile testing');
assert.match(actionLocksSource, /controller-selection-ui\.js\?v=20260910controller1/, 'the automatic selector adapter is parser-loaded with a cache-busted URL');
assert.match(actionLocksSource, /input-default-reset-ui\.js\?v=20260909controller4/, 'the per-device reset-button helper is parser-loaded with a cache-busted URL');

assert.match(bindingsSource, /id: 'uiOpenMenu'[\s\S]{0,180}context: 'menu'/, 'menu open/close schema is owned by the controller binding module');
assert.match(bindingsSource, /id: 'musicNote1'[\s\S]{0,180}context: 'music'/, 'music controller schema is owned by the controller binding module');
assert.match(bindingsSource, /id: 'meleeAutoTargetToggle'[\s\S]{0,220}context: 'melee'/, 'melee contextual schema is owned by the controller binding module');
const controllerHelperIndex = indexSource.indexOf('js/controller-input.js?'); // Parser-order contract is version-agnostic so camera/game cache bumps cannot break this controller test.
const bindingsHelperIndex = indexSource.indexOf('js/input-bindings.js?');
const gameScriptIndex = indexSource.indexOf('game.js?');
assert.ok(controllerHelperIndex >= 0 && bindingsHelperIndex > controllerHelperIndex && gameScriptIndex > bindingsHelperIndex, 'controller helper/binding layers load before game.js');

console.log('Controller experience checks passed.');

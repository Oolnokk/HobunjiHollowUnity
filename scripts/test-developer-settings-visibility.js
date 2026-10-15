#!/usr/bin/env node
'use strict';
// Exercises the Settings owner's classification, runtime teardown, and companion
// actions without a renderer, keeping feature event handlers authoritative.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/input-default-reset-ui.js', 'utf8'); // Executes shipped functions rather than duplicating their decisions.
const elements = new Map(); // Minimal document lookup shared by all tested functions.
const panels = new Map(); // Captures the real companion registrations.
const state = { dataset: {} }; // Models the body's synchronous CSS visibility gate.
let selectedSettings = 0; // Verifies hiding the active Debug tab returns to a visible page.
const document = {
  body: state,
  getElementById: id => elements.get(id) || null,
  querySelector: selector => selector.includes('="debug"') ? { classList: { contains: () => true } } : { click: () => selectedSettings++ },
}; // Only the DOM boundary required by these settings functions.
const context = vm.createContext({ document, Event: class { constructor(type) { this.type = type; } }, window: { DevCompanion: { registerCheatPanel: spec => panels.set(spec.id, spec) } } }); // Captures commands without requiring BroadcastChannel.
function extract(name) {
  const start = source.indexOf(`  function ${name}(`); // Keeps tests attached to the function's actual implementation.
  assert.ok(start >= 0);
  const end = source.indexOf('\n  function ', start + 1); // These sibling declarations are the module's stable owner boundaries.
  return source.slice(start, end);
}
vm.runInContext(source.slice(source.indexOf('  const DEV_SECTION_LABELS'), source.indexOf('  let devModeControl')) + ['devModeEnabled', 'companionControls', 'settingAction', 'applyCompanionSetting', 'registerCompanionSettings', 'syncDeveloperVisibility', 'markDeveloperSettings'].map(extract).join('\n'), context);
function control(id, extra = {}) {
  const events = []; // Tracks whether valid requests really reach the feature's existing handlers.
  const node = { id, tagName: 'INPUT', type: 'checkbox', checked: false, disabled: false, events,
    dispatchEvent: event => events.push(event.type), getAttribute: () => null, closest: () => null, ...extra }; // Covers only the native input properties the settings bridge reads.
  elements.set(id, node);
  return node;
}
const devMode = control('settingDevMode'); // Existing authoritative Settings checkbox.
const hitboxes = control('settingShowHitboxes', { checked: true }); // Simulates a previously persisted diagnostic overlay.
const gpuSync = control('settingGpuSyncDiagnostic', { checked: true }); // Expensive testing overrides must not remain active invisibly.
const fps = control('settingFpsCounter', { checked: true }); // Genuine player performance preference must survive Dev Mode changes.
context.syncDeveloperVisibility();
assert.equal(state.dataset.devMode, 'false');
assert.equal(hitboxes.checked, false);
assert.deepEqual(hitboxes.events, ['change']);
assert.equal(gpuSync.checked, false);
assert.equal(fps.checked, true);
assert.equal(selectedSettings, 1);
context.syncDeveloperVisibility();
assert.deepEqual(hitboxes.events, ['change'], 'unchanged controls do not dispatch repeated events');
devMode.checked = true;
context.syncDeveloperVisibility();
assert.equal(state.dataset.devMode, 'true');
context.registerCompanionSettings();
const display = panels.get('settings-display'); // Real registered panel, including the audited control whitelist.
assert.ok(display.when());
assert.equal(display.onAction('toggle', { controlId: hitboxes.id, checked: true }).ok, true);
assert.deepEqual(hitboxes.events, ['change', 'input', 'change']);
assert.equal(display.onAction('toggle', { controlId: fps.id, checked: false }).ok, false, 'companion cannot mutate controls outside its audited section');
devMode.checked = false;
assert.equal(display.onAction('toggle', { controlId: hitboxes.id, checked: false }).ok, false, 'stale actions are blocked immediately after Dev Mode changes');
devMode.checked = true;
const radius = control('settingCloudForestCullRadius', { type: 'range', min: '5', max: '40', step: '1', value: '30', validity: { valid: true } }); // Tests bounded numeric tuning through its original input handler.
const tuning = panels.get('settings-cloud-forest'); // Real Cloud Forest settings registration.
assert.equal(tuning.onAction('value', { controlId: radius.id, value: '25' }).ok, true);
assert.equal(radius.value, '25');
assert.deepEqual(radius.events, ['input', 'change']);
for (const value of ['', ' ', null, true, 'invalid', Infinity, 4, 41]) assert.equal(tuning.onAction('value', { controlId: radius.id, value }).ok, false);
assert.equal(radius.value, '25');
radius.validity.valid = false;
assert.equal(tuning.onAction('value', { controlId: radius.id, value: '25.5' }).ok, false);
assert.equal(radius.value, '25', 'step-invalid numeric input restores the old value without dispatching');
const lab = control('devWildernessLabSize', { tagName: 'SELECT', type: 'select-one', value: '1', options: [{ value: '1', textContent: '1 chunk' }, { value: '4', textContent: '2×2 chunks' }, { value: '9', disabled: true }] }); // Reuses the selected size before the existing teleport handler is invoked.
const world = panels.get('settings-world'); // Real world/teleport settings registration.
assert.equal(world.onAction('value', { controlId: lab.id, value: '4' }).ok, true);
assert.equal(lab.value, '4');
assert.equal(world.onAction('value', { controlId: lab.id, value: '9' }).ok, false);
let teleports = 0; // Confirms command execution reaches the existing button exactly once.
const teleport = control('devTeleportArenaBtn', { tagName: 'BUTTON', type: 'button', click: () => teleports++ }); // Does not reimplement the developer arena transition.
assert.equal(world.onAction('click', { controlId: teleport.id }).ok, true);
assert.equal(teleports, 1);
teleport.disabled = true;
assert.equal(world.onAction('click', { controlId: teleport.id }).ok, false);
assert.equal(teleports, 1);
// Late-injected developer sections get the same gate as authored markup.
const marked = new Set(); // Tracks classification writes without requiring DOM/CSS rendering.
const node = (id, containsDev = false) => ({ contains: candidate => containsDev && candidate === devMode, hasAttribute: () => marked.has(id), setAttribute: () => marked.add(id) }); // Represents a section heading or a dynamically created row.
const devTitle = node('dev-title'); // The Developer heading and switch must remain reachable.
context.sections = [{ label: 'Dev Tools', title: devTitle, nodes: [devTitle, node('switch', true), node('late-ruin')] }, { label: 'Progression', nodes: [node('progression'), node('reset')] }, { label: 'Camera', nodes: [node('camera')] }];
context.collectSettingsSections = () => context.sections;
context.markDeveloperSettings({});
assert.deepEqual([...marked].sort(), ['late-ruin', 'progression', 'reset']);
console.log('test-developer-settings-visibility: ok');

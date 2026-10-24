'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const expectedController = {
  interact: 'Button0',
  dodge: 'Button1',
  action1: 'RightTrigger',
  action2: 'LeftTrigger',
  action3: 'Button2',
  action4: null,
  action5: null,
  action6: null,
  action7: null,
  action8: null,
  swapTarget: null,
  toggleMount: 'Button10',
  perceptionMode: 'Button14',
  weaponSwitch: 'Button11',
  utilityMenu: 'Button12',
  toolSelect: 'Button5',
  itemPrev: null,
  itemNext: null,
  toolPrev: null,
  toolNext: null,
  tool1: null,
  tool2: null,
  tool4: null,
  tool5: null,
  tool6: null,
  uiOpenMenu: 'Button8',
  uiConfirm: 'Button0',
  uiCancel: 'Button1',
  uiTabPrev: 'Button4',
  uiTabNext: 'Button5',
  uiUp: 'Button12',
  uiDown: 'Button13',
  uiLeft: 'Button14',
  uiRight: 'Button15',
  musicNote1: 'Button2',
  musicNote2: 'Button0',
  musicNote3: 'Button1',
  musicNote4: 'Button3',
  musicBank1: 'LeftTrigger',
  musicBank2: 'RightTrigger',
  musicBank3: 'Button4',
  musicBank4: 'Button5',
  musicPause: 'Button9',
  musicScalePrev: 'Button14',
  musicScaleNext: 'Button15',
  socialWheel: 'Button15',
  itemSelect: 'Button4',
}; // Exact approved controller JSON binding map; changing a shipped default must intentionally update this fixture.

const context = {
  window: { addEventListener() {}, dispatchEvent() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  setInterval() { return 1; },
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
};
vm.runInNewContext(fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('docs/js/input-bindings.js', 'utf8'), context);

const inputDefaults = context.window.SCRATCHBONES_CONFIG.game.input; // Uses the real shipped input config rather than a synthetic fixture.
const live = {
  desktop: { sentinelDesktop: 'KeyZ' },
  controller: { stale: 'Button9' },
  modeShifts: [
    { id: 'desktop-custom-preserved', device: 'desktop', button: 'KeyH', bindings: { WheelUp: 'interact' } },
    { id: 'controller-stale', device: 'controller', button: 'Button6', bindings: { RightStickLeft: 'toolPrev' } },
  ],
}; // Deliberately dirty live state proves Reset Controller replaces only the controller side.

const api = context.window.InputBindings;
api.init({ INPUT_DEFAULTS: inputDefaults });
api.init({ INPUT_DEFAULTS: inputDefaults, getInputBindings: () => live });

assert.deepEqual(
  JSON.parse(JSON.stringify(api.getDefaultBindings('controller'))),
  expectedController,
  'the shipped controller-default map exactly matches the approved manual layout',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.getDefaultModeShifts('controller'))),
  [],
  'the shipped controller defaults contain no manual mode-shift bindings',
);

assert.equal(api.resetDeviceToDefaults('controller'), true, 'Reset Controller to Defaults succeeds');
assert.deepEqual(
  JSON.parse(JSON.stringify(live.controller)),
  expectedController,
  'pressing Reset Controller to Defaults produces the approved controller JSON binding map exactly',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(live.modeShifts.filter(shift => (shift.device || 'desktop') === 'controller'))),
  [],
  'pressing Reset Controller to Defaults leaves no controller mode shifts',
);
assert.deepEqual(live.desktop, { sentinelDesktop: 'KeyZ' }, 'controller reset leaves keyboard bindings untouched');
assert.ok(live.modeShifts.some(shift => shift.id === 'desktop-custom-preserved'), 'controller reset preserves desktop-only mode shifts');

console.log('Controller default layout checks passed.');

// Prompt labels are shared by gameplay, menus, and the binding editor.
for (const [index, label] of ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS Click', 'RS Click', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide'].entries()) {
  assert.equal(api.buttonLabel('Button' + index), label);
}
assert.equal(api.buttonLabel('Button4+Button0'), 'LB + A');
assert.equal(api.buttonLabel('Ctrl+KeyF'), 'Ctrl + F');
assert.equal(api.buttonLabel('Button20'), 'Button 20');

// Execute the shipped arch formatter with and without the shared binding module.
const archSource = fs.readFileSync('docs/js/arch-button-labels.js', 'utf8'); // Keeps compact badges aligned with the same public Xbox prompt vocabulary.
const compactSource = archSource.slice(archSource.indexOf('  function compactControllerBinding('), archSource.indexOf('  function currentInputDevice(')); // Only the formatter is needed for this label test.
for (const shared of [api, null]) {
  const compactContext = { window: { InputBindings: shared } }; // Covers startup fallback as well as initialized shared labels.
  vm.runInNewContext(compactSource, compactContext);
  for (const [code, expected] of Object.entries({ Button0: 'A', Button6: 'LT', Button7: 'RT', Button8: 'BACK', Button9: 'START', Button10: 'LS', Button11: 'RS', Button16: 'GUIDE', LeftTrigger: 'LT' })) {
    assert.equal(compactContext.compactControllerBinding(code), expected);
  }
}

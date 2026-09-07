const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('docs/js/shoulder-camera-reset-button.js', 'utf8');
assert.match(source, /id=\"resetShoulderCamBtn\"/, 'reset button must be injected into Camera settings');
assert.match(source, /class=\"settings-small-btn\"/, 'reset button should reuse the existing Settings button style');
assert.match(source, /HobunjiShoulderCameraCharacterFraming\?\.refreshPlayerFraming/, 'reset must reapply species-relative framing');

class MockInput {
  constructor(value = '') {
    this.value = value;
    this.checked = false;
    this.events = [];
  }
  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

const toggle = new MockInput();
const horizontal = new MockInput();
const vertical = new MockInput();
const elements = {
  settingShoulderSurf: toggle,
  settingShoulderSurfOffsetH: horizontal,
  settingShoulderSurfOffsetV: vertical,
};
let combat = false;
let refreshCount = 0;

const windowObject = {
  __hobunjiFurnitureDebug: {
    get shoulderSurfCombatStance() { return combat; },
  },
  HobunjiShoulderCameraCharacterFraming: {
    refreshPlayerFraming() { refreshCount++; return true; },
  },
  __farmLog() {},
};
windowObject.window = windowObject;

const context = vm.createContext({
  window: windowObject,
  document: {
    readyState: 'loading',
    getElementById(id) { return elements[id] || null; },
    addEventListener() {},
  },
  Event: class Event { constructor(type) { this.type = type; } },
  Date,
  setInterval() { return 1; },
  clearInterval() {},
});
vm.runInContext(source, context, { filename: 'shoulder-camera-reset-button.js' });

assert(windowObject.HobunjiShoulderCameraReset, 'reset API should install');
assert.strictEqual(windowObject.HobunjiShoulderCameraReset.resetToDefaults(), true, 'default-stance reset should succeed');
assert.strictEqual(toggle.checked, true, 'reset should enable Shoulder Cam');
assert(toggle.events.includes('change'), 'reset should use Shoulder Cam\'s existing change handler');
assert.strictEqual(horizontal.value, '0.35', 'default stance horizontal offset should reset to 0.35');
assert.strictEqual(vertical.value, '-0.05', 'default stance vertical offset should reset to -0.05');
assert(horizontal.events.includes('input') && vertical.events.includes('input'), 'reset should use the existing offset input handlers');
assert.strictEqual(refreshCount, 1, 'reset should reapply species-relative neck/height framing');

combat = true;
horizontal.events.length = 0;
vertical.events.length = 0;
assert.strictEqual(windowObject.HobunjiShoulderCameraReset.resetToDefaults(), true, 'combat-stance reset should succeed');
assert.strictEqual(horizontal.value, '0.6', 'combat stance horizontal offset should reset to 0.60');
assert.strictEqual(vertical.value, '-0.05', 'combat stance vertical offset should reset to -0.05');
assert.strictEqual(refreshCount, 2, 'combat reset should also reapply species-relative framing');
const snapshot = windowObject.HobunjiShoulderCameraReset.snapshot();
assert.strictEqual(snapshot.lastReset.preset, 'combat', 'debug snapshot should identify the reset stance');
assert.strictEqual(snapshot.lastReset.horizontal, 0.6, 'debug snapshot should report the restored combat offset');

console.log('Shoulder Camera reset button regression: PASS');

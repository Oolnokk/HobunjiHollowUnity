'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const configSource = fs.readFileSync(path.join(root, 'docs/config/hand-model-profiles.js'), 'utf8');
const closeupSource = fs.readFileSync(path.join(root, 'docs/js/attack-editor-hand-tool-closeup.js'), 'utf8');

const storage = new Map();
const sandbox = {
  window: {
    SCRATCHBONES_CONFIG: {
      game: {
        appearanceEditor: { species: {} },
        assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { default: 1 } } } },
      },
    },
  },
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
};
sandbox.window.localStorage = sandbox.localStorage;
vm.runInNewContext(configSource, sandbox, { filename: 'hand-model-profiles.js' });

const profiles = sandbox.window.HobunjiHandModelProfiles;
assert(profiles, 'hand model profile manager should install');
assert.strictEqual(profiles.data.alignmentPreset, 'attack-editor-closeup-visual-grips-v1');
assert.strictEqual(profiles.data.visualCalibration?.source, 'attack-editor-hand-tool-closeup');
assert.strictEqual(profiles.data.visualCalibration?.authority, 'rendered-hand-tool-relationship');
assert.strictEqual(profiles.data.visualCalibration?.baselineGripMode, 'palm-parallel');

const expected = {
  feline: { position: { x: 0, y: 0.10, z: 0.08 }, rotationDeg: { pitch: -90, yaw: 0, roll: 0 } },
  sloth: { position: { x: 0, y: 0.26, z: 0.50 }, rotationDeg: { pitch: -90, yaw: 0, roll: 0 } },
  parrot: { position: { x: 0, y: 0.17, z: 0.07 }, rotationDeg: { pitch: -90, yaw: 0, roll: 0 } },
  pachyderm: { position: { x: 0, y: 0.07, z: 0.10 }, rotationDeg: { pitch: -70, yaw: 0, roll: 0 } },
};

for (const [modelKey, transform] of Object.entries(expected)) {
  const model = profiles.data.models[modelKey];
  assert(model, `${modelKey} profile should exist`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(model.handFromTool)), transform, `${modelKey} must keep the approved close-up calibration values`);
  assert.strictEqual(model.horizontalMirrorX, true, `${modelKey} must default to pair-wide horizontal mirroring`);
}

assert.strictEqual(profiles.data.models.parrot.mirrorX, false, 'parrot source-handedness must remain independent from pair-wide mirroring');
assert.strictEqual(profiles.data.models.feline.mirrorX, true, 'feline source-handedness must remain the normal left-source convention');

assert.match(closeupSource, /camera preserved until Refit/, 'close-up should tell the author that camera framing is persistent');
assert.match(closeupSource, /cameraAutoRefit: false/, 'close-up debug should expose disabled value-driven auto-refit');
assert.doesNotMatch(closeupSource, /sidebar[^\n]*addEventListener\(['"]input/, 'hand value input must not auto-refit the close-up camera');
assert.doesNotMatch(closeupSource, /profiles\.subscribe\?\.\(\(\) => requestRefit\(\)\)/, 'profile edits must not reset close-up orbit/zoom');
assert.doesNotMatch(closeupSource, /gripModes\.subscribe\?\.\(\(\) => requestRefit\(\)\)/, 'grip-mode edits must not reset close-up orbit/zoom');

console.log('PASS: hand close-up visual calibration defaults and persistent camera contract');

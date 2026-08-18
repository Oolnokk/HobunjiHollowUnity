'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const configSource = read('docs/config/hand-model-profiles.js');
const handSource = read('docs/js/procedural-hand-attachments.js');
const driverSource = read('docs/js/procedural-hand-frame-driver.js');
const gripConfigSource = read('docs/js/hand-tool-grips.js');
const editorUiSource = read('docs/js/attack-editor-hand-configurator.js');
const directEditorSource = read('docs/js/attack-editor-hand-direct-attachments.js');
const gripModeSource = read('docs/js/hand-grip-modes.js');
const gripEditorSource = read('docs/js/attack-editor-hand-grip-mode.js');
const heldSource = read('docs/js/held-action-animations.js');
const bridgeSource = read('docs/js/player-body-attachment-bridge.js');
const weaponScaleSource = read('docs/js/weapon-png-scale.js');
const armCompassSource = read('docs/js/portrait-arm-compass.js');
const handCompassAimSource = read('docs/js/procedural-hand-compass-aim.js');
const materialRoleSource = read('docs/js/procedural-hand-foot-material-roles.js');

const storage = new Map();
const sandbox = {
  window: {
    SCRATCHBONES_CONFIG: {
      game: {
        appearanceEditor: { species: {} },
        assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { default: 1, 'mao-ao': { male: 0.7, female: 0.65 } } } } },
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
assert(profiles, 'profile manager should be installed');
assert.strictEqual(profiles.data.schema, 'hobunji_hand_model_profiles.v1');
assert.strictEqual(profiles.data.sourceBasis.handedness, 'left');
assert.strictEqual(profiles.modelKeyForSpecies('mao-ao'), 'feline');
assert.strictEqual(profiles.modelKeyForSpecies('kenkari'), 'parrot');
assert.strictEqual(profiles.modelKeyForSpecies('rakakoan'), 'parrot');
assert.strictEqual(profiles.data.models.parrot.glb, 'assets/models/hands/hand_parrot.glb');
assert.strictEqual(profiles.speciesScaleFor('mao-ao', 'male'), 0.7, 'hand size should still inherit foot scale by default');
assert.strictEqual(profiles.modelScaleFor('mao-ao'), 2, 'hand GLBs keep the 2x model default');
assert.strictEqual(profiles.data.models.feline.mirrorX, true, 'Mao\'ao keeps the normal source-X mirror');
assert.strictEqual(profiles.data.models.parrot.mirrorX, false, 'Kenkari/Rakako\'an parrot hands must use the opposite mirror');

const maoTransform = JSON.stringify({
  position: { x: -0.07, y: -0.13, z: 0.21 },
  rotationDeg: { pitch: 90, yaw: -28, roll: 92 },
});
for (const [key, model] of Object.entries(profiles.data.models)) {
  assert.strictEqual(JSON.stringify(model.handFromTool), maoTransform, `${key} must use the Mao'ao tool-relative hand setup`);
}

assert.match(handSource, /authored origin/i, 'direct hand runtime must preserve the GLB authored origin');
assert.doesNotMatch(handSource, /solveTwoBoneArm|shoulderNode|upper_arm/, 'direct hand runtime must contain no arm-chain implementation');
assert.match(handSource, /THREE\.DoubleSide/, 'direct runtime must keep hand backface culling disabled');
assert.match(driverSource, /placeHandWorld\?\.\('right'/, 'right hand must follow primary tool grip');
assert.match(driverSource, /secondaryGripForTool/, 'driver must support an optional second grip');
assert.match(driverSource, /setSideIdle\?\.\('left'/, 'left hand must idle on one-handed tools');
assert.doesNotMatch(driverSource, /clampDeltaWorld|armLength|elbow/, 'driver must never perform arm reach correction');

const gripSandbox = { window: {}, localStorage: sandbox.localStorage };
gripSandbox.window.localStorage = sandbox.localStorage;
vm.runInNewContext(gripConfigSource, gripSandbox, { filename: 'hand-tool-grips.js' });
const grips = gripSandbox.window.HobunjiHandToolGrips;
assert(grips, 'secondary grip config manager should be installed');
assert.strictEqual(grips.secondaryGripForTool('hatchet').enabled, true, 'hatchet must start two-handed');
assert.strictEqual(grips.secondaryGripForTool('bronzehoe').enabled, true, 'hoe must start two-handed');
assert.strictEqual(grips.secondaryGripForTool('pickshovel'), null, 'other tools must remain one-handed unless authored');

assert.match(gripModeSource, /palm-parallel/, 'palm-parallel grip mode must remain');
assert.match(gripModeSource, /palm-perpendicular/, 'palm-perpendicular grip mode must remain');
assert.match(gripModeSource, /multiplyQuat\(modeQ, fineQ\)/, 'grip rotations must remain quaternion-composed');
assert.match(gripEditorSource, /handGripModeSelect/, 'Attack Editor must keep the grip-mode dropdown');
assert.match(directEditorSource, /handSecondaryGripEnabled/, 'Attack Editor must expose secondary grip enablement');
assert.match(directEditorSource, /handSecondaryGripPositionFields/, 'Attack Editor must expose secondary grip position');
assert.match(directEditorSource, /handSecondaryGripRotationFields/, 'Attack Editor must expose secondary grip orientation');

assert.match(editorUiSource, /Final hand size = <b>model scale × species\/gender scale<\/b>/, 'editor must retain scale authoring');
assert.match(editorUiSource, /hand-model-profiles\.json/, 'editor must retain reusable hand profile export');
assert.match(heldSource, /procedural-hand-attachments\.js/, 'bootstrap must load the direct hand runtime');
assert.match(heldSource, /hand-tool-grips\.js/, 'bootstrap must load tool grip sockets');
assert.match(heldSource, /portrait-arm-compass\.js/, 'bootstrap must separate the raw arm sprites before hand attachment');
assert.match(heldSource, /procedural-hand-compass-aim\.js/, 'bootstrap must connect arm compass rotation and wrist roll before the frame driver');
assert.match(heldSource, /weapon-png-scale\.js/, 'game bootstrap must load baseline weapon PNG scaling');
assert.doesNotMatch(heldSource, /arm-bones\.js|procedural-arm-animation\.js|portrait-biceps|forearm-follow|arm-length/, 'bootstrap must not load deleted arm systems');
assert.match(bridgeSource, /ProceduralHandAttachments\?\.installGameRuntime/, 'gameplay dependency bridge must target direct hands');

assert.match(armCompassSource, /SHOULDER_DROP_FRAC = 0\.10/, 'shoulder origin must be first opaque arm region plus 10% portrait height');
assert.match(armCompassSource, /bodyLayers\.filter\(layer => !ARM_ID_RE\.test/, 'base portrait must omit neutral raw arms so no ghost arm remains');
assert.match(armCompassSource, /scanArmAnchors\(canvas\)/, 'each separated arm must be scanned for shoulder/wrist anchors');
assert.match(handCompassAimSource, /record\.pivot\.rotation\.z = record\.armAngleRad/, 'arm sprite must rotate in 2D around its shoulder pivot');
assert.match(handCompassAimSource, /setFromAxisAngle\(zAxis, correction\)/, 'hand wrist alignment must correct local roll only');
assert.match(handCompassAimSource, /set\(0, 1, 0\)\.applyQuaternion/, 'GLB local +Y/top must be treated as the wrist direction');
assert.doesNotMatch(handCompassAimSource, /solveTwoBoneArm|elbow|reach clamp/i, 'compass presentation must not reintroduce arm IK');

assert.match(materialRoleSource, /MAT_None_7a4e2e: 'keratin'/, 'parrot first export material must be flipped to keratin');
assert.match(materialRoleSource, /MAT_EyeSurface_0c0c0c: 'body'/, 'parrot second export material must be flipped to body');

assert.match(weaponScaleSource, /BASE_WEAPON_PNG_SCALE = 1\.15/, 'unscaled weapon PNG baseline must be 1.15x');
for (const key of ['hatchet', 'bronzehoe', 'pickshovel', 'fishingspear', 'fishingmace']) {
  assert(weaponScaleSource.includes(`'${key}'`), `${key} must receive the baseline weapon PNG scale`);
}
assert.match(weaponScaleSource, /holderScale <= 1\.0001/, 'already enlarged weapon animations must not receive another 1.15 multiplier');
assert.doesNotMatch(weaponScaleSource, /crossbow|scatterbow/, 'already enlarged ranged weapons must not be placed in the 1.15 eligibility list');

for (const removed of [
  'docs/js/arm-bones.js',
  'docs/js/procedural-arm-animation.js',
  'docs/js/procedural-hand-portrait-shoulders.js',
  'docs/js/procedural-arm-portrait-biceps.js',
  'docs/js/procedural-hand-forearm-follow.js',
  'docs/js/procedural-hand-arm-length.js',
]) assert(!fs.existsSync(path.join(root, removed)), `${removed} should be physically removed`);

console.log('procedural hands: direct sockets + 2D compass arms + wrist roll-to-shoulder + shared Mao\'ao setup PASS');
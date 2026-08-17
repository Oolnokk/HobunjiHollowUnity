'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const configSource = read('docs/config/hand-model-profiles.js');
const armSource = read('docs/js/arm-bones.js');
const handSource = read('docs/js/procedural-arm-animation.js');
const editorUiSource = read('docs/js/attack-editor-hand-configurator.js');
const heldSource = read('docs/js/held-action-animations.js');
const bridgeSource = read('docs/js/player-body-attachment-bridge.js');

// Execute the model-profile manager with a non-1 foot fallback so scale-stack
// ordering is observable instead of accidentally passing with all defaults=1.
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
assert.strictEqual(profiles.modelKeyForSpecies('mao-ao'), 'feline');
assert.strictEqual(profiles.speciesScaleFor('mao-ao', 'male'), 0.7, 'hand scale should inherit the matching foot scale when no override exists');
profiles.mutate(data => { data.models.feline.scale = 1.5; });
assert(Math.abs(profiles.effectiveScaleFor('mao-ao', 'male') - 1.05) < 1e-10, 'effective hand scale must be model scale × inherited species scale');
profiles.mutate(data => {
  data.speciesScaleOverrides['mao-ao'] = { male: 0.8 };
});
assert.strictEqual(profiles.speciesScaleFor('mao-ao', 'male'), 0.8);
assert(Math.abs(profiles.effectiveScaleFor('mao-ao', 'male') - 1.2) < 1e-10, 'authored species scale must multiply on top of model scale');
assert.deepStrictEqual(Object.keys(profiles.data.models).sort(), ['feline', 'pachyderm', 'parrot', 'sloth']);
for (const model of Object.values(profiles.data.models)) {
  assert(model.glb && model.scale > 0, 'every hand model needs a GLB and positive model scale');
  assert(model.toolGrip?.position && model.toolGrip?.rotationDeg, 'every hand model needs a reusable position+direction grip socket');
}

assert.match(armSource, /solveTwoBoneArm/, 'shared arm IK should still exist');
assert.match(handSource, /const effectiveScale = modelScale \* speciesScale/, 'runtime GLB size must explicitly stack model and species scales');
assert.match(handSource, /toolGrip/, 'runtime must consume authored tool-grip profiles');
assert.match(handSource, /socketOffset[\s\S]*socketQuaternion/, 'runtime must apply both grip point and grip direction');
assert.match(handSource, /downward raw-arm opacity scan; shoulder = first opaque pixel \+ 10% portrait height/, 'raw arm scan rule must survive the main merge');
assert.match(handSource, /rightShoulder\.y - handAttachY/, 'arm reach must stay shoulder Y minus canonical tool-attach Y');
assert.match(handSource, /originalBuild[\s\S]*proceduralHandPending/, 'hands should wrap the current PNG avatar builder instead of replacing the neck-aware implementation');
assert.match(handSource, /originalRender\.call/, 'hand follow should compose around the current renderer rather than replace it');

assert.match(editorUiSource, /Final hand size = <b>model scale × species\/gender scale<\/b>/, 'editor must explain the scale stack');
assert.match(editorUiSource, /Tool grip point/, 'editor must expose grip position');
assert.match(editorUiSource, /Tool grip direction/, 'editor must expose grip orientation');
assert.match(editorUiSource, /hand-model-profiles\.json/, 'editor must export a reusable config');
assert.match(editorUiSource, /Inherit foot scale/, 'editor must let a species return to its foot-scale default');
assert.match(editorUiSource, /Show tool-grip axes/, 'editor must provide a visible socket guide for mobile/no-console tuning');
assert.match(editorUiSource, /raw-arm scan/, 'editor must surface scan diagnostics visibly');

assert.match(heldSource, /config\/hand-model-profiles\.js/, 'shared held-action bootstrap must load hand profiles in game and editor');
assert.match(heldSource, /attack-editor-hand-configurator\.js/, 'attack editor configurator must be layered onto the existing editor');
assert.match(bridgeSource, /ProceduralArmAnimation\?\.installGameRuntime/, 'gameplay must receive playerMesh/toolHolder through the existing attachment bridge');

// When run in the full repository, these guard the conflict resolution: current
// ranged/neck editor work must remain intact while the hand layer is additive.
const fullRepoEditor = path.join(root, 'docs/tools/attack-animation-editor/index.html');
if (fs.existsSync(fullRepoEditor)) {
  const editor = read('docs/tools/attack-animation-editor/index.html');
  assert.match(editor, /crossbowLoaded/, 'main ranged attack-editor support must survive the hand merge');
  assert.match(editor, /showHeadSkinVertices/, 'main neck/skin-weight preview must survive the hand merge');
  assert.match(editor, /onlyHeadSprite/, 'main head-only neck centroid path must survive the hand merge');
}
const fullPortrait = path.join(root, 'docs/js/portrait-utils.js');
if (fs.existsSync(fullPortrait)) {
  assert.match(read('docs/js/portrait-utils.js'), /onlyHeadSprite/, 'main portrait neck mask support must survive unchanged');
}

console.log('procedural hands: model socket, layered scale, raw-arm scan, and merge guards PASS');

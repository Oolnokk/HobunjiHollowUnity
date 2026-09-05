'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const profileSource = read('docs/config/hand-model-profiles.js');
const gripSource = read('docs/js/hand-tool-grips.js');
const feetSource = read('docs/js/procedural-leg-animation.js');
const scratchConfigSource = read('docs/config/scratchbones-config.js');

const storage = new Map(); // Shared in-memory localStorage used by both config sandboxes below.
const localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const windowObject = {
  localStorage,
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: { species: {} },
      assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { default: 1 } } } },
    },
  },
  requestAnimationFrame() {}, // hand-tool-grips.js self-schedules a managed per-frame loop on load.
};
const sandbox = { window: windowObject, localStorage, requestAnimationFrame: windowObject.requestAnimationFrame, location: { pathname: '/index.html' } };
const almostEqual = (actual, expected) => assert(Math.abs(actual - expected) < 1e-12, `expected ${actual} to equal ${expected}`); // Handles decimal scale products without brittle IEEE-754 equality.

vm.runInNewContext(profileSource, sandbox, { filename: 'hand-model-profiles.js' });
const profiles = windowObject.HobunjiHandModelProfiles;
assert.strictEqual(profiles.data.modelScalePreset, 'hands-92_5-feet-120-v2');
assert.strictEqual(profiles.data.models.feline.scale, 1.85, 'ordinary hands should sit halfway between the original 2x and prior 1.7x size');
almostEqual(profiles.data.models.parrot.scale, 2.775);

const oldProfiles = profiles.clone(); // Simulates a currently saved pre-midpoint profile to verify one-time migration.
oldProfiles.modelScalePreset = 'parrot-3x-v1';
oldProfiles.models.feline.scale = 2;
oldProfiles.models.parrot.scale = 3;
profiles.replace(oldProfiles);
assert.strictEqual(profiles.data.models.feline.scale, 1.85);
almostEqual(profiles.data.models.parrot.scale, 2.775);
profiles.replace(profiles.clone());
assert.strictEqual(profiles.data.models.feline.scale, 1.85, 'migration marker must prevent repeated resizing');
const priorBalancedProfiles = profiles.clone(); // Simulates the immediately previous 85% saved profile that should grow halfway back.
priorBalancedProfiles.modelScalePreset = 'hands-85-feet-120-v1';
priorBalancedProfiles.models.feline.scale = 1.7;
priorBalancedProfiles.models.parrot.scale = 2.55;
profiles.replace(priorBalancedProfiles);
assert.strictEqual(profiles.data.models.feline.scale, 1.85);
almostEqual(profiles.data.models.parrot.scale, 2.775);
const incompleteOldProfiles = profiles.clone();
delete incompleteOldProfiles.modelScalePreset;
delete incompleteOldProfiles.models.feline.scale;
profiles.replace(incompleteOldProfiles);
assert.strictEqual(profiles.data.models.feline.scale, 1.85, 'missing old scales must receive the balanced default exactly once');

vm.runInNewContext(gripSource, sandbox, { filename: 'hand-tool-grips.js' });
const grips = windowObject.HobunjiHandToolGrips;
assert.strictEqual(grips.secondaryGripForTool('hatchet'), null, 'hatchet second-hand toggle must default off');
assert.strictEqual(grips.secondaryGripForTool('bronzehoe'), null, 'hoe second-hand toggle must default off');

// Simulates saved/editor data from before the animation-gated span migration -- no
// secondaryGripSpan key at all, just the old always-on per-tool toggle -- which must
// convert into a span but not resurrect as always-on secondary grip afterward.
const oldGrips = {
  schema: grips.schema,
  tools: {
    hatchet: { secondaryGrip: { enabled: true, position: { x: 0, y: 0, z: 1 } } },
    hoe: { secondaryGrip: { enabled: true, position: { x: 0, y: 0, z: 1 } } },
  },
};
grips.replace(oldGrips);
assert.strictEqual(grips.secondaryGripForTool('hatchet'), null, 'legacy always-on toggle must not resurrect as always-on after migration');
assert.strictEqual(grips.secondaryGripForTool('hoe'), null, 'legacy always-on toggle must not resurrect as always-on after migration');
assert(grips.secondaryGripSpanForTool('hatchet')?.enabled, 'legacy always-on toggle must migrate into an enabled animation-gated span');
grips.mutate(data => { data.tools.hatchet.secondaryGripSpan.enabled = true; });
assert(grips.secondaryGripSpanForTool('hatchet')?.enabled, 'future deliberate reauthoring must remain possible after migration');

assert.match(scratchConfigSource, /"sizeBalanceMultiplier": 1\.2/, 'shared feet config must enlarge all species by 20%');
assert.match(feetSource, /footScaleMultiplierForSpecies\(speciesId, gender\) \* sizeBalanceMultiplier/, 'foot radius must apply the shared multiplier after species scale');

console.log('hand/foot size midpoint + secondary-grip reset PASS');

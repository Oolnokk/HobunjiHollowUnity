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
};
const sandbox = { window: windowObject, localStorage };

vm.runInNewContext(profileSource, sandbox, { filename: 'hand-model-profiles.js' });
const profiles = windowObject.HobunjiHandModelProfiles;
assert.strictEqual(profiles.data.modelScalePreset, 'hands-85-feet-120-v1');
assert.strictEqual(profiles.data.models.feline.scale, 1.7, 'ordinary hands should shrink from 2x to 1.7x');
assert.strictEqual(profiles.data.models.parrot.scale, 2.55, 'parrot hands should retain their relative 3x basis at 85% size');

const oldProfiles = profiles.clone(); // Simulates a currently saved pre-midpoint profile to verify one-time migration.
oldProfiles.modelScalePreset = 'parrot-3x-v1';
oldProfiles.models.feline.scale = 2;
oldProfiles.models.parrot.scale = 3;
profiles.replace(oldProfiles);
assert.strictEqual(profiles.data.models.feline.scale, 1.7);
assert.strictEqual(profiles.data.models.parrot.scale, 2.55);
profiles.replace(profiles.clone());
assert.strictEqual(profiles.data.models.feline.scale, 1.7, 'migration marker must prevent repeated shrinking');
const incompleteOldProfiles = profiles.clone();
delete incompleteOldProfiles.modelScalePreset;
delete incompleteOldProfiles.models.feline.scale;
profiles.replace(incompleteOldProfiles);
assert.strictEqual(profiles.data.models.feline.scale, 1.7, 'missing old scales must receive the balanced default exactly once');

vm.runInNewContext(gripSource, sandbox, { filename: 'hand-tool-grips.js' });
const grips = windowObject.HobunjiHandToolGrips;
assert.strictEqual(grips.secondaryGripForTool('hatchet'), null, 'hatchet second-hand toggle must default off');
assert.strictEqual(grips.secondaryGripForTool('bronzehoe'), null, 'hoe second-hand toggle must default off');

const oldGrips = grips.clone(); // Simulates existing saved/editor data whose enabled toggles must be cleared once.
delete oldGrips.secondaryGripPreset;
oldGrips.tools.hatchet.secondaryGrip.enabled = true;
oldGrips.tools.hoe.secondaryGrip.enabled = true;
grips.replace(oldGrips);
assert.strictEqual(grips.secondaryGripForTool('hatchet'), null);
assert.strictEqual(grips.secondaryGripForTool('hoe'), null);
grips.mutate(data => { data.tools.hatchet.secondaryGrip.enabled = true; });
assert(grips.secondaryGripForTool('hatchet'), 'future deliberate reauthoring must remain possible after migration');

assert.match(scratchConfigSource, /"sizeBalanceMultiplier": 1\.2/, 'shared feet config must enlarge all species by 20%');
assert.match(feetSource, /footScaleMultiplierForSpecies\(speciesId, gender\) \* sizeBalanceMultiplier/, 'foot radius must apply the shared multiplier after species scale');

console.log('hand/foot size midpoint + secondary-grip reset PASS');

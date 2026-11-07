#!/usr/bin/env node
// End-to-end source/VM checks for Longoran's inherited art, posture and population odds.
const assert = require('node:assert/strict'); // Used by every regression assertion below.
const fs = require('node:fs'); // Loads canonical repository assets.
const vm = require('node:vm'); // Runs browser modules with a small mock window.
const read = path => fs.readFileSync(path, 'utf8'); // Shared canonical fixture reader.
const near = (a, b) => Math.abs(a - b) < 1e-9; // Compares fractional species probabilities.

const definition = JSON.parse(read('docs/config/species/longoran.json'));
const index = JSON.parse(read('docs/config/species/index.json'));
assert.equal(definition.parentSpecies, 'tletingan');
assert.deepEqual(definition.genders, ['male', 'female']);
assert(index.entries.some(entry => entry.speciesId === 'longoran'));
const scaleWindow = { SCRATCHBONES_CONFIG: {} }; // Rig-scale defaults only need an optional config host.
vm.runInNewContext(read('docs/config/character-rig-scale-defaults.js'), { window: scaleWindow });
for (const gender of ['male', 'female']) {
  const defaults = scaleWindow.HobunjiCharacterRigScaleDefaults;
  const donor = defaults.scaleFor('tletingan', gender);
  const child = defaults.scaleFor('longoran', gender);
  assert(near(child.x, donor.x * 1.25));
  assert(near(child.y, donor.y * 1.5));
  assert.equal(child.head, donor.head);
}

const w = { // Minimum donor registries for the same browser inheritance bridge.
  HobunjiCharacterRigScaleDefaults: scaleWindow.HobunjiCharacterRigScaleDefaults,
  SCRATCHBONES_CONFIG: { game: {
    appearanceEditor: { species: { tletingan: { label: 'Tletingan', genders: ['male', 'female'], male: { slots: [{slot:'hairFront'}] } } }, bodyPalettes: { tletingan: { male: ['m'] } } },
    assets: { pngPlaneAvatar: { behindView: { headUrls: { tletingan: { male: 'back' } } }, proceduralFeet: { species: { tletingan: { glb: 'sloth.glb' } }, footScale: { tletingan: { male: 1 } } } } },
    portrait: { armOnlyOpacityMask: { profiles: {} } },
  } },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'tletingan::male': { species: 'tletingan', gender: 'male', anatomy: { rigScaleX: 2, handScale: .9, footScale: 1 } } } },
  HobunjiHandModelProfiles: { data: { speciesModels: { tletingan: 'sloth' } }, mutate(fn) { fn(this.data); } },
  ConditionRegistry: { PLAYER_SPECIES: ['tletingan'] },
  _getMouthSpriteUrl(_expression, id) { return id; },
};
vm.runInNewContext(read('docs/js/longoran-species-runtime.js'), { window: w, console });
const bridge = w.HobunjiLongoranSpecies;
assert(bridge, 'Longoran must install its own runtime identity');
assert.equal(bridge.parentSpecies, 'tletingan');
assert.equal(bridge.gaitProfile.lurchDegrees, 19);
assert.equal(bridge.spineProfile.hunch, .75);
assert.equal(bridge.spineProfile.kyphosis, .8);
assert.equal(w.SCRATCHBONES_CONFIG.game.appearanceEditor.species.longoran.parentSpecies, 'tletingan');
assert.equal(w.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.behindView.headUrls.longoran.male, 'back');
assert.equal(w.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.species.longoran.glb, 'sloth.glb');
assert.equal(w.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['longoran::male'].anatomy.rigScaleX, undefined);
assert.equal(w.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['longoran::male'].anatomy.handScaleAxes, undefined);
assert(w.ConditionRegistry.PLAYER_SPECIES.includes('longoran'));
assert.equal(w._getMouthSpriteUrl('talk', 'longoran'), 'tletingan');
assert.equal(bridge.rollSubspecies(() => .0499), 'longoran');
assert.equal(bridge.rollSubspecies(() => .05), 'nuhongan');
assert.equal(bridge.rollSubspecies(() => .21), 'tletingan');

const spineWindow = { HobunjiLongoranSpecies: bridge }; // Explicit per-character overrides must still be supported.
vm.runInNewContext(read('docs/js/character-spine.js'), { window: spineWindow });
assert.equal(spineWindow.HobunjiCharacterSpine.resolve({ speciesId: 'longoran' }).hunch, .75);
assert.equal(spineWindow.HobunjiCharacterSpine.resolve({ speciesId: 'tletingan' }).hunch, 0);
assert.equal(spineWindow.HobunjiCharacterSpine.resolve({ speciesId: 'longoran', spine: { hunch: .2 } }).hunch, .2);
const maskbound = read('docs/js/combat/combat-maskbound-guardian.js'); // Existing strongest lurch value is authoritative.
const maskboundMax = Math.max(...Array.from(maskbound.matchAll(/lurchDegrees:\s*([0-9.]+)/g), match => Number(match[1])));
assert.equal(bridge.gaitProfile.lurchDegrees, maskboundMax);

const bands = JSON.parse(read('docs/config/bandits/bandit-gang-config.json'));
const totals = bands.speciesWeights;
const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
const slagothim = totals.tletingan + totals.nuhongan + totals.longoran;
assert(near(total, 100));
assert(near(slagothim, 5)); // Overall Slagothim bandit frequency is unchanged.
assert(near(totals.longoran / slagothim, .05));
assert(near(totals.nuhongan / totals.tletingan, .2));
assert(near(bands.gruntVariants.slagothimBeastmaster.speciesWeights.longoran, 5));
assert(read('docs/js/bandit-camps.js').includes('variant?.speciesWeights'), 'Beastmasters must roll derived Slagothim');
assert(read('docs/js/combat/combat-bandit.js').includes('await loadBanditSpeciesDef(parentId)'), 'Inherited bandit clothing must be usable');
assert(read('docs/js/slagothim-traders.js').includes('rollSubspecies?.(rng)'), 'Trader species must roll from deterministic seeds');
assert(read('docs/js/onboarding-character-creation-redesign.js').includes('data-ob-subspecies="longoran"'), 'Creator must expose the subspecies');
assert(read('docs/js/procedural-leg-animation.js').includes("speciesId === 'longoran' ? window.HobunjiLongoranSpecies?.gaitProfile"), 'Normal Longoran walkers need the maskbound gait');
assert(read('docs/js/attachment-rig-latest-authored-snapshot.js').includes('longoran-species-runtime.js?v='), 'Runtime must load before avatar creation');

// The Animation Author writes the same Longoran values that game avatars read at construction.
const savedTuning = new Map(); // Simulates same-origin localStorage shared by authoring and gameplay.
w.localStorage = {
  getItem: key => savedTuning.get(key) || null,
  setItem: (key, value) => { savedTuning.set(key, value); },
  removeItem: key => { savedTuning.delete(key); },
};
const initial = bridge.tuningSnapshot(); // Checks independent species-wide spine and walking-gait defaults.
assert.equal(initial.spineProfile.hunch, 0.75);
assert.equal(initial.gaitProfile.lurchDegrees, 19);
assert.equal(bridge.applyTuning({
  spineProfile: { hunch: .6, kyphosis: .92, sway: 'not-a-number' },
  gaitProfile: { lurchDegrees: 28, cadence: .55, stance: .68, dragLift: .12, dragSide: 'left' },
}, { persist: false }), true);
assert.equal(bridge.spineProfile.hunch, .6);
assert.equal(bridge.spineProfile.kyphosis, .92);
assert.equal(bridge.gaitProfile.lurchDegrees, 25, 'lurch input must clamp to the procedural-leg solver maximum');
assert.equal(bridge.gaitProfile.dragSide, 'left');
assert.equal(bridge.gaitProfile.cadence, .55);
assert.equal(bridge.spineProfile.sway, 0, 'invalid input cannot write NaN into the spine');
assert.equal(savedTuning.size, 0, 'dragging the slider should not write to storage on every frame');
assert.equal(bridge.persistTuning(), true);
assert.equal(JSON.parse(savedTuning.get(bridge.tuningStorageKey)).gaitProfile.dragSide, 'left');
assert.equal(JSON.parse(savedTuning.get(bridge.tuningStorageKey)).spineProfile.hunch, .6);
bridge.resetTuning();
assert.equal(bridge.spineProfile.hunch, initial.spineProfile.hunch);
assert.equal(bridge.gaitProfile.lurchDegrees, initial.gaitProfile.lurchDegrees);
assert.equal(bridge.gaitProfile.dragSide, initial.gaitProfile.dragSide);
assert.equal(savedTuning.size, 0, 'reset discards persisted species-wide authoring edits');

// The head-scale runtime must not undo a Longoran's permanent spine drop when a
// later hand attachment reapplies whole-rig scale with per-NPC age=0.
const compensatedWindow = {
  HobunjiCharacterRigScaleDefaults: scaleWindow.HobunjiCharacterRigScaleDefaults,
  HobunjiCharacterSpine: spineWindow.HobunjiCharacterSpine,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {} },
};
vm.runInNewContext(read('docs/js/character-rig-scale.js'), {
  window: compensatedWindow,
  location: { pathname: '/game/' }, // The shared scale module checks the tool route before installing Animation Author handlers.
  setInterval: () => 1,
  clearInterval: () => {},
  console,
});
const bone = () => ({
  scale: { x: 1, y: 1, z: 1, set(x, y, z) { Object.assign(this, { x, y, z }); } },
  position: { x: 0, y: 0, z: 0 },
  userData: {},
  updateMatrix() {},
}); // Supplies exactly the native bone contract consumed by HeadCompensation.
const headBone = bone(); // Separate head-only bone receives the effective vertical offset.
const neck = bone(); // Required for the existing findNeckRig predicate.
const root = {
  userData: {
    portraitModelHeight: 1,
    hobunjiSpine: { hunch: .75 },
    neckRig: { neckJoint: neck, headScaleJoint: headBone, splineNodes: [{}] },
  },
};
assert.equal(compensatedWindow.HobunjiCharacterRigScale.applyHeadCompensation(root, 'longoran', 'male', {}, 0), true);
const expectedOffset = compensatedWindow.HobunjiCharacterRigScale.ageHunchFraction(.75)
  + spineWindow.HobunjiCharacterSpine.profileFor(.75).shoulderDrop;
assert(near(headBone.position.y, expectedOffset), 'Longoran portrait must keep bound spine drop after age=0 scale reapplication');
root.userData.hobunjiSpine = { hunch: .2 }; // Explicit actor spine beats the species' default in the same runtime.
compensatedWindow.HobunjiCharacterRigScale.applyHeadCompensation(root, 'longoran', 'male', {}, 0);
const newOffset = compensatedWindow.HobunjiCharacterRigScale.ageHunchFraction(.2)
  + spineWindow.HobunjiCharacterSpine.profileFor(.2).shoulderDrop;
assert(near(headBone.position.y, newOffset), 'Explicit spine edits must not accumulate or retain the earlier larger drop');

console.log('Longoran inheritance, posture, runtime head compensation, editable gait and spawn weighting checks passed.');

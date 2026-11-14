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
const defaults = scaleWindow.HobunjiCharacterRigScaleDefaults; // Uses actual gameplay scales, not duplicated editor-only values.
const oldMale = { x: 1.0625, y: 1.275, head: 0.8, offsetY: 0 }; // Previously shipped Longoran male proportions, used only to verify the requested relative change.
const oldFemale = { x: 1.14375, y: 1.335, head: 0.8823529411764706, offsetY: 0 }; // Preserves the established gender ratios rather than copying male dimensions wholesale.
const exportedMale = { x: 1.05, y: 2, head: 0.9647, offsetY: -0.055 }; // Exact values in the supplied Full Character Scale JSON.
assert.deepEqual(JSON.parse(JSON.stringify(defaults.scaleFor('longoran', 'male'))), exportedMale);
const female = defaults.scaleFor('longoran', 'female'); // Female keeps her original relationship to male measurements for each axis.
for (const field of ['x', 'y', 'head']) {
  const expected = oldFemale[field] * exportedMale[field] / oldMale[field];
  assert(near(female[field], expected), `female Longoran ${field} must inherit the male's relative proportional change`);
}
assert(near(female.offsetY, oldFemale.offsetY + exportedMale.offsetY - oldMale.offsetY), 'female Longoran head offset uses the same additive change (percentage points), not a zero-denominator ratio');
assert.equal(defaults.scaleFor('tletingan', 'male').x, 0.85, 'Longoran authoring must not change the parent Tletingan scale');

// Execute the actual Full Character Scale save bridge: the old 200% cap used to turn a valid female height of 209.4% back into 200% after reload.
function restoreScaleBridge(savedScales) {
  const items = new Map([['hobunjiFullCharacterRigScales.v2', JSON.stringify(savedScales)]]); // Real localStorage key used by previous Animation Author sessions.
  const localStorage = {
    getItem(key) { return items.has(key) ? items.get(key) : null; },
    setItem(key, value) { items.set(key, value); },
    removeItem(key) { items.delete(key); },
  }; // Exercises persistence and migration without modifying a browser or player profile.
  const authorWindow = {
    HobunjiCharacterRigScaleDefaults: defaults,
    HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {
      'longoran::male': { species: 'longoran', gender: 'male', anatomy: {} },
      'longoran::female': { species: 'longoran', gender: 'female', anatomy: {} },
      'tletingan::male': { species: 'tletingan', gender: 'male', anatomy: {} },
    } },
  }; // Canonical shared profile records updated by setRigScale.
  const document = {
    documentElement: { dataset: {} },
    addEventListener() {},
    getElementById() { return null; },
  }; // No viewport is needed for the storage-only bridge tests.
  vm.runInNewContext(read('docs/js/character-scale-comparison-host-bridge.js'), {
    window: authorWindow, document, localStorage, location: { pathname: '/tools/animation-author/index.html' },
    setInterval() { return 1; }, clearInterval() {}, console,
  });
  return { host: authorWindow.HobunjiAnimationAuthorScaleHost, items, profiles: authorWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters };
}

const priorSavedScales = { // Rounds previous canonical defaults as the Full Character Scale export does.
  'longoran::male': exportedMale,
  'longoran::female': { x: 1.1438, y: 1.335, head: 0.8824, offsetY: 0 },
  'tletingan::male': { x: 0.91, y: 0.85, head: 0.8, offsetY: 0 },
};
const migratedBridge = restoreScaleBridge(priorSavedScales);
assert(near(migratedBridge.host.rigScaleFor('longoran', 'female').y, female.y), 'old default female save must migrate to the new height above 200%');
assert(near(migratedBridge.profiles['longoran::female'].anatomy.rigScaleY, female.y), 'the live female rig must see the height above 200%');
assert.deepEqual(JSON.parse(JSON.stringify(migratedBridge.host.rigScaleFor('longoran', 'male'))), exportedMale, 'custom male Longoran from the user file must not be overwritten');
assert.equal(migratedBridge.host.rigScaleFor('tletingan', 'male').x, 0.91, 'unrelated species saved scales must not be changed');
assert(near(JSON.parse(migratedBridge.items.get('hobunjiFullCharacterRigScales.v2'))['longoran::female'].y, female.y), 'migration must persist the full female height to storage');
const customBridge = restoreScaleBridge({ 'longoran::female': { x: 1.2, y: 3.25, head: 0.95, offsetY: 0.1 } });
assert.equal(customBridge.host.rigScaleFor('longoran', 'female').y, 3.25, 'genuinely customized female scales must not be migrated or capped');
assert.equal(customBridge.host.setRigScale('longoran', 'female', { x: 1.1303, y: 4, head: 1.064, offsetY: -0.055 }).y, 4, 'full 400% editor upper limit must survive save/restore');

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
assert.match(read('docs/js/procedural-leg-animation.js'), /speciesId === 'longoran'[^\n]+HobunjiLongoranSpecies\?\.gaitFor/, 'Normal Longoran walkers need the authored gender-specific Maskbound gait');
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
const authoredHeadOffset = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('longoran', 'male').offsetY; // The new approved -5.5% head nudge composes with, rather than replacing, the permanent hunch drop.
const expectedOffset = authoredHeadOffset + compensatedWindow.HobunjiCharacterRigScale.ageHunchFraction(.75)
  + spineWindow.HobunjiCharacterSpine.profileFor(.75).shoulderDrop;
assert(near(headBone.position.y, expectedOffset), 'Longoran portrait must keep bound spine drop after age=0 scale reapplication');
root.userData.hobunjiSpine = { hunch: .2 }; // Explicit actor spine beats the species' default in the same runtime.
compensatedWindow.HobunjiCharacterRigScale.applyHeadCompensation(root, 'longoran', 'male', {}, 0);
const newOffset = authoredHeadOffset + compensatedWindow.HobunjiCharacterRigScale.ageHunchFraction(.2)
  + spineWindow.HobunjiCharacterSpine.profileFor(.2).shoulderDrop;
assert(near(headBone.position.y, newOffset), 'Explicit spine edits must not accumulate or retain the earlier larger drop');

console.log('Longoran inheritance, posture, runtime head compensation, editable gait and spawn weighting checks passed.');

const assert = require('node:assert/strict'); // Used for all Nuhongan inheritance and scale regression checks below.
const fs = require('node:fs'); // Used to read the shipped config/runtime sources exactly as the browser would receive them.
const vm = require('node:vm'); // Used to execute browser modules against lightweight window stubs.

const read = path => fs.readFileSync(path, 'utf8'); // Used to keep fixture reads concise while still testing repository files directly.
const species = JSON.parse(read('docs/config/species/nuhongan.json')); // Used to verify the authored parent-species contract.
const speciesIndex = JSON.parse(read('docs/config/species/index.json')); // Used to verify shared species-loader discoverability.

assert.equal(species.speciesId, 'nuhongan');
assert.equal(species.label, 'Nuhongan');
assert.equal(species.parentSpecies, 'tletingan');
assert.deepEqual(species.genders, ['male', 'female']);
assert(speciesIndex.entries.some(entry => entry.speciesId === 'nuhongan' && entry.path === './nuhongan.json'));

const scaleWindow = { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: {} } } } } } }; // Used to execute canonical scale defaults without a browser.
vm.runInNewContext(read('docs/config/character-rig-scale-defaults.js'), { window: scaleWindow });
const tletinganMale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('tletingan', 'male'); // Used as the male proportional donor for exact ratio assertions.
const tletinganFemale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('tletingan', 'female'); // Used as the female proportional donor for exact ratio assertions.
const nuhonganMale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('nuhongan', 'male'); // Used to prove the male 80% width / 75% height contract.
const nuhonganFemale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('nuhongan', 'female'); // Used to prove the female 80% width / 75% height contract.
assert.equal(nuhonganMale.x, tletinganMale.x * 0.8);
assert.equal(nuhonganMale.y, tletinganMale.y * 0.75);
assert.equal(nuhonganMale.head, tletinganMale.head);
assert.equal(nuhonganFemale.x, tletinganFemale.x * 0.8);
assert.equal(nuhonganFemale.y, tletinganFemale.y * 0.75);
assert.equal(nuhonganFemale.head, tletinganFemale.head);

const runtimeWindow = { // Used to verify Nuhongan runtime inheritance without loading the full game.
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: {
        species: { tletingan: { label: 'Tletingan', genders: ['male', 'female'], male: { slots: [{ slot: 'hairFront' }] }, female: { slots: [{ slot: 'hairBack' }] } } },
        bodyPalettes: { tletingan: { male: ['m'], female: ['f'] } },
      },
      assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { tletingan: { male: 1, female: 1.1 } }, footModels: { tletingan: 'tletingan-feet' } } } },
    },
  },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    characters: {
      'tletingan::male': { species: 'tletingan', gender: 'male', anchors: { hand: 1 }, anatomy: { rigScaleX: 99, rigScaleY: 99, headScale: 99, headOffsetY: 99 } },
      'tletingan::female': { species: 'tletingan', gender: 'female', anchors: { hand: 2 }, anatomy: { rigScaleX: 98, rigScaleY: 98, headScale: 98, headOffsetY: 98 } },
    },
  },
  HobunjiHandModelProfiles: {
    data: { speciesModels: { tletingan: 'tletingan-hands' } },
    mutate(fn) { fn(this.data); },
  },
  applyHobunjiAttachmentRigProfileCorrections() {},
};
vm.runInNewContext(read('docs/js/nuhongan-species-runtime.js'), { window: runtimeWindow });
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.species.nuhongan.parentSpecies, 'tletingan');
assert.deepEqual(runtimeWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.bodyPalettes.nuhongan, runtimeWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.bodyPalettes.tletingan);
assert.equal(runtimeWindow.HobunjiHandModelProfiles.data.speciesModels.nuhongan, 'tletingan-hands');
for (const gender of ['male', 'female']) {
  const profile = runtimeWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[`nuhongan::${gender}`]; // Used to verify an independent same-gender Tletingan rig clone exists.
  assert(profile);
  assert.equal(profile.species, 'nuhongan');
  assert.equal(profile.anatomy.rigScaleX, undefined);
  assert.equal(profile.anatomy.rigScaleY, undefined);
  assert.equal(profile.anatomy.headScale, undefined);
  assert.equal(profile.anatomy.headOffsetY, undefined);
}
assert.deepEqual(runtimeWindow.HobunjiNuhonganSpecies.debugSnapshot().rigHeightMultiplier, 0.75);
assert.deepEqual(runtimeWindow.HobunjiNuhonganSpecies.debugSnapshot().rigWidthMultiplier, 0.8);

const studioWindow = {}; // Used to verify the Character Studio pre-config assignment hook adds Nuhongan before editor initialization.
vm.runInNewContext(read('docs/js/character-studio-mammakhbuur-config.js'), { window: studioWindow, console });
studioWindow.SCRATCHBONES_CONFIG = {
  game: {
    appearanceEditor: {
      species: {
        mashtzarr: { label: 'Mashtzarr', male: { slots: [] }, female: { slots: [] } },
        tletingan: { label: 'Tletingan', genders: ['male'], male: { slots: [{ slot: 'hairFront' }] } },
      },
      bodyPalettes: { mashtzarr: { male: ['m'], female: ['f'] }, tletingan: { male: ['t'] } },
    },
  },
};
assert.equal(studioWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.species.nuhongan.label, 'Nuhongan');
assert.equal(studioWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.species.nuhongan.parentSpecies, 'tletingan');
assert.deepEqual(studioWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.species.nuhongan.genders, ['male']);

const onboardingWindow = { // Used to call the existing private SPECIES_DATA hydration bridge directly.
  SCRATCHBONES_CONFIG: { game: { appearanceEditor: { species: { mashtzarr: { female: { slots: [] } } }, bodyPalettes: {} } } },
  randomPortraitProfileSeeded() { return {}; },
  getPortraitFighters() { return []; },
};
const onboardingDocument = { addEventListener() {} }; // Used only to satisfy the bridge's player-ready cleanup registration.
vm.runInNewContext(read('docs/js/onboarding-character-creation-mashtzarr-female.js'), {
  window: onboardingWindow,
  document: onboardingDocument,
  setTimeout() { return 0; },
});
const privateSpeciesTable = { // Used to mimic onboarding-core's private species table and prove Nuhongan is cloned from Tletingan.
  'mao-ao': { label: 'Mao-ao' },
  tletingan: { label: 'Tletingan', genders: ['male'], male: { slots: [{ slot: 'hairFront', options: [{ id: 'same' }] }], colorOptions: ['same'] } },
  kenkari: { label: 'Kenkari' },
  'engh-sho': { label: 'Engh-sho' },
  mashtzarr: { label: 'Mashtzarr', genders: ['male'], male: { slots: [{ slot: 'hairFront' }], colorOptions: [] } },
};
assert.equal(onboardingWindow.hobunjiOnboardingMashtzarrFemale.hydratePrivateSpeciesTable(privateSpeciesTable), true);
assert.equal(privateSpeciesTable.nuhongan.label, 'Nuhongan');
assert.deepEqual(privateSpeciesTable.nuhongan.genders, privateSpeciesTable.tletingan.genders);
assert.deepEqual(privateSpeciesTable.nuhongan.male, privateSpeciesTable.tletingan.male);
assert.notEqual(privateSpeciesTable.nuhongan, privateSpeciesTable.tletingan);

console.log('Nuhongan species tests passed.');

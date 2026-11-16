'use strict';
// Verify fixed shoulder-pet scales against world-space portrait-plane width/height, without runtime auto-scaling.
const assert = require('node:assert/strict'); // Validates runtime profiles and authoring ratios.
const fs = require('node:fs'); // Reads the shipped modules used by this regression.
const vm = require('node:vm'); // Executes species installers against a minimal browser host.
const read = path => fs.readFileSync(path, 'utf8'); // Loads actual sources without test-specific duplicates.
const host = { // In-memory profile and appearance registries consumed by every installer.
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {} },
  SCRATCHBONES_CONFIG: { game: {
    appearanceEditor: { species: {}, bodyPalettes: {} },
    assets: { pngPlaneAvatar: { behindView: { headUrls: {} }, proceduralFeet: { models: {}, species: {}, footScale: {} } } },
    portrait: { armOnlyOpacityMask: { profiles: {} } },
  } },
  HobunjiHandModelProfiles: { data: { speciesModels: {} }, mutate(fn) { fn(this.data); } },
  HobunjiSpeciesPoseScale: { resolveScale() { return 1; }, setScale() { return true; } },
  getPortraitFighters() { return []; },
};
const donorPerches = { // Canonical authored default scales of the three donor species, independent of orbit size.
  'tletingan::male': 0.5, 'tletingan::female': 0.530831,
  'engh-sho::male': 0.540542, 'engh-sho::female': 0.527572,
  'mashtzarr::male': 0.894, 'mashtzarr::female': 0.816568,
};
const donorPortraitScales = { tletingan: 0.85, 'engh-sho': 0.95, mashtzarr: 1.18 }; // Latest authored portraitScale, consumed when constructing each donor fixture.
for (const [id, size] of Object.entries(donorPerches)) {
  const [species, gender] = id.split('::'); // Builds exact donor fixtures for the same-gender inheritance paths.
  host.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[id] = { species, gender, anatomy: { portraitScale: donorPortraitScales[species] },
    anchors: { shoulderPerch: { position: { x: -0.25, y: 0.6, z: 0 }, scale: { x: size, y: size, z: size } },
      rightHandShoulder: { position: { x: -0.25, y: 0.6, z: 0 } } } };
  host.SCRATCHBONES_CONFIG.game.appearanceEditor.species[species] = { label: species, genders: ['male', 'female'] };
}
const donorSnapshot = JSON.stringify(host.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters); // Regression guard for donated anchors.
const context = vm.createContext({ window: host, console, location: { pathname: '/game' },
  document: { getElementById() { return null; }, addEventListener() {}, body: { dataset: {} } } }); // Supplies the existing browser-oriented installers' optional globals.
const run = path => vm.runInContext(read(path), context, { filename: path }); // Applies real species registration modules exactly once.
run('docs/config/character-rig-scale-defaults.js');
for (const path of ['docs/js/nuhongan-species-runtime.js', 'docs/js/longoran-species-runtime.js',
  'docs/js/harlyao-species-runtime.js', 'docs/js/mammakhbuur-species-runtime.js',
  'docs/js/skeleton-species-runtime.js', 'docs/js/harlyao-skeleton-species-runtime.js']) run(path);
const expected = { // Explicit six-decimal pet scales must be authored, not calculated by the running game.
  nuhongan: ['tletingan', 0.387298, 0.411180],
  longoran: ['tletingan', 0.852434, 0.904997],
  harlyao: ['engh-sho', 0.648650, 0.633087],
  mammakhbuur: ['mashtzarr', 1.040143, 0.950042],
  'harlyao-skeleton': ['engh-sho', 0.648650, 0.633087],
};
for (const [species, [donorSpecies, male, female]] of Object.entries(expected)) {
  for (const [gender, size] of [['male', male], ['female', female]]) {
    const profile = host.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[`${species}::${gender}`]; // Resolved authored attachment profile.
    const donor = host.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[`${donorSpecies}::${gender}`]; // Independent same-gender donor position.
    assert(profile && donor, `Missing profile for ${species}::${gender}`);
    assert.deepEqual(JSON.parse(JSON.stringify(profile.anchors.shoulderPerch.position)),
      JSON.parse(JSON.stringify(donor.anchors.shoulderPerch.position)), 'Perch position must not move');
    for (const axis of ['x', 'y', 'z']) assert.equal(profile.anchors.shoulderPerch.scale[axis], size);
    const body = host.HobunjiCharacterRigScaleDefaults.scaleFor(species, gender); // Static whole-rig X/Y used only in this test's world-plane calculation.
    const reference = host.HobunjiCharacterRigScaleDefaults.scaleFor('tletingan', 'male'); // Shared world-portrait baseline, not the species' donor.
    const modelWidth = 0.9; // Actual square portrait model width in world units.
    const portraitScale = Number(profile.anatomy.portraitScale); // Donor-inherited portrait-plane multiplier, independent of whole-rig X/Y.
    const baselineArea = (modelWidth * donorPortraitScales.tletingan) ** 2 * reference.x * reference.y; // Tletingan male portrait world-space area.
    const worldPortraitArea = (modelWidth * portraitScale) ** 2 * body.x * body.y; // World-space portrait-plane area, not opaque pixels or limb geometry.
    const predicted = 0.5 * Math.sqrt(worldPortraitArea / baselineArea); // Offline-only world portrait dimensions; gameplay uses authored fixed constants.
    assert(Math.abs(predicted - size) < 0.000001, `Unexpected authored size for ${species}::${gender}: ${predicted}`);
  }
}
assert.equal(JSON.stringify(Object.fromEntries(
  Object.keys(donorPerches).map(key => [key, host.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[key]]))),
donorSnapshot, 'Derived species installers may not modify the donor profiles');

const gameSource = read('docs/game.js'); // Verify the live game, not only editor rig profiles, actually consumes authored size.
const anchorStart = gameSource.indexOf('function _computePlayerAttachmentAnchor(anchorName) {'); // Private gameplay resolver extracted without starting WebGL.
const anchorEnd = gameSource.indexOf('function creatureAttachmentAnchor(', anchorStart); // Delimits only this function and its return shape.
assert(anchorStart > 0 && anchorEnd > anchorStart, 'Game must expose an authored player attachment resolver');
const anchorResolver = new Function('window', '_playerData', 'playerAvatarModelHeight', 'playerToolBaseY',
  gameSource.slice(anchorStart, anchorEnd) + '; return _computePlayerAttachmentAnchor("shoulderPerch");'); // Exercises exact production scale propagation.
for (const [species, [, male, female]] of Object.entries(expected)) {
  for (const [gender, scale] of [['male', male], ['female', female]]) {
    const anchor = anchorResolver(host, { appearance: { speciesId: species, gender } }, 0.9, 0.45); // Uses the actual saved species/gender key.
    assert.equal(anchor.scale.x, scale, species + ' ' + gender + ' X scale must reach gameplay');
    assert.equal(anchor.scale.y, scale, species + ' ' + gender + ' Y scale must reach gameplay');
    assert.equal(anchor.scale.z, scale, species + ' ' + gender + ' Z scale must reach gameplay');
  }
}
assert.match(gameSource, /const authoredPetPerchScale = c\.stableRole === 'shoulderPet'/,
  'Only a shoulder pet should adopt the authored carrier perch size during creature rendering');
assert.match(gameSource, /x: c\.visualScaleX \* petScaleX, y: c\.visualScaleY \* petScaleY/,
  'Runtime size must multiply existing genotype size without overwriting it or accumulating each frame');
assert.match(gameSource, /\(grip\.y \|\| 0\) \* perchScaleY/,
  'The final foot-grip offset must use the same authored scale as the rendered sprite');
assert.match(gameSource, /perch\.y - grip\.y \* gripScaleY/,
  'The initial shoulder pet location must honor the scaled grip until final pose positioning');

console.log('Fixed world-portrait shoulder-perch scale tests passed.');

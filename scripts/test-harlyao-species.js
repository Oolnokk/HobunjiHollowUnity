const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const harlyao = JSON.parse(fs.readFileSync('docs/config/species/harlyao.json', 'utf8')); // Guards the authored species record and future head-asset contract.
const speciesIndex = JSON.parse(fs.readFileSync('docs/config/species/index.json', 'utf8')); // Guards discoverability through the shared species loader.
const runtimeSource = fs.readFileSync('docs/js/harlyao-species-runtime.js', 'utf8'); // Executed below against a minimal browser-shaped runtime to verify inheritance wiring.
const scaleSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Supplies the explicit Harlyao 1.2x Engh-sho whole-rig defaults.
const bootstrapSource = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8'); // Guards load order: Harlyao rig clones must exist before scale defaults are installed into profiles.

assert.equal(harlyao.speciesId, 'harlyao');
assert.equal(harlyao.parentSpecies, 'engh-sho');
assert.equal(harlyao.npcOnly, true);
assert.equal(harlyao.playerSelectable, false);
assert.equal(harlyao.inheritanceNotes.wardrobeSpecies, 'engh-sho');
assert.equal(harlyao.inheritanceNotes.bodyColorSpecies, 'mao-ao');
assert.equal(harlyao.inheritanceNotes.rigScaleMultiplier, 1.2);
assert.equal(harlyao.male.headSprite, 'fightersprites/engh-sho-m/head_harlyao_m.png');
assert.equal(harlyao.female.headSprite, 'fightersprites/engh-sho-f/head_harlyao_f.png');
assert.deepEqual(harlyao.male.portraitBodyLayers.map(layer => layer.url), [
  'portraitsprites/arm_L_engh_m.png',
  'portraitsprites/torso_engh_m.png',
  'portraitsprites/arm_R_engh_m.png',
]);
assert.deepEqual(harlyao.female.portraitBodyLayers.map(layer => layer.url), [
  'portraitsprites/arm_L_engh_f.png',
  'portraitsprites/torso_engh_f.png',
  'portraitsprites/arm_R_engh_f.png',
]);
assert.equal(harlyao.male.bodyColorRanges, undefined, 'Harlyao must inherit live Mao-ao ranges rather than freeze a duplicated palette snapshot');
assert.equal(harlyao.female.bodyColorRanges, undefined, 'Harlyao must inherit live Mao-ao ranges rather than freeze a duplicated palette snapshot');
assert(speciesIndex.entries.some(entry => entry.speciesId === 'harlyao' && entry.path === './harlyao.json'));

const fighters = [
  { id: 'harlyao_male', speciesId: 'harlyao', gender: 'male' },
  { id: 'harlyao_female', speciesId: 'harlyao', gender: 'female' },
  { id: 'M', speciesId: 'mao-ao', gender: 'male' },
  { id: 'F', speciesId: 'mao-ao', gender: 'female' },
]; // Used by the palette bridge exactly as portrait-utils exposes its live fighter registry.
const cosmetics = {
  bodyColorRangesByGender: {
    M: { A: { source: 'mao-male' } },
    F: { A: { source: 'mao-female' } },
  },
}; // Used to prove Harlyao points at the same canonical Mao-ao range objects rather than copies.
const windowObject = {
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: { species: {} },
      portrait: {},
    },
  },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    characters: {
      'engh-sho::male': {
        species: 'engh-sho', gender: 'male', anatomy: { portraitScale: 0.95, handScale: 1.2, footScale: 1.1, rigScaleX: 0.8, rigScaleY: 0.845, headScale: 0.7894736842105263, headOffsetY: 0 },
        anchors: { leftHandShoulder: { position: { x: -1, y: 2, z: 0 } } },
      },
      'engh-sho::female': {
        species: 'engh-sho', gender: 'female', anatomy: { portraitScale: 0.975, handScale: 1.2, footScale: 1.1, rigScaleX: 0.795, rigScaleY: 0.81, headScale: 0.7894736842105263, headOffsetY: 0 },
        anchors: { leftHandShoulder: { position: { x: -2, y: 3, z: 0 } } },
      },
    },
  },
  applyHobunjiAttachmentRigProfileCorrections: () => true,
  resolveOptionLayers: (_option, fighter) => fighter.speciesId,
  getPortraitFighters: () => fighters,
  loadPortraitCosmetics: async () => cosmetics,
}; // Minimal browser-shaped host used to exercise the bridge without loading the whole game.
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(runtimeSource, context, { filename: 'harlyao-species-runtime.js' });

assert.equal(windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.species.harlyao.npcOnly, true);
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.species.harlyao.playerSelectable, false);
assert.equal(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao::male'].species, 'harlyao');
assert.notEqual(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao::male'], windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['engh-sho::male']);
assert.equal(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao::male'].anatomy.portraitScale, 0.95);
assert.equal(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao::male'].anatomy.rigScaleX, undefined);
assert.equal(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao::female'].anatomy.rigScaleY, undefined);
assert.equal(windowObject.resolveOptionLayers({}, fighters[0]), 'engh-sho', 'Harlyao wardrobe variants must resolve through Engh-sho');
assert.equal(windowObject.resolveOptionLayers({}, fighters[2]), 'mao-ao', 'non-Harlyao wardrobe resolution must remain untouched');
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['harlyao:male'].maskYScaleMultiplier, 1.04);
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['harlyao:female'].maskYScaleMultiplier, 1.15);

(async () => {
  const loadedCosmetics = await windowObject.loadPortraitCosmetics();
  assert.equal(loadedCosmetics.bodyColorRangesByGender.harlyao_male, loadedCosmetics.bodyColorRangesByGender.M);
  assert.equal(loadedCosmetics.bodyColorRangesByGender.harlyao_female, loadedCosmetics.bodyColorRangesByGender.F);

  vm.runInContext(scaleSource, context, { filename: 'character-rig-scale-defaults.js' });
  const maleScale = windowObject.HobunjiCharacterRigScaleDefaults.scaleFor('harlyao', 'male');
  const femaleScale = windowObject.HobunjiCharacterRigScaleDefaults.scaleFor('harlyao', 'female');
  assert(Math.abs(maleScale.x - 0.8 * 1.2) < 1e-12);
  assert(Math.abs(maleScale.y - 0.845 * 1.2) < 1e-12);
  assert(Math.abs(maleScale.head - 0.7894736842105263 * 1.2) < 1e-12);
  assert(Math.abs(femaleScale.x - 0.795 * 1.2) < 1e-12);
  assert(Math.abs(femaleScale.y - 0.81 * 1.2) < 1e-12);
  assert(Math.abs(femaleScale.head - 0.7894736842105263 * 1.2) < 1e-12);

  const harlyaoBootstrapIndex = bootstrapSource.indexOf("harlyao-species-runtime.js?v=20260909a");
  const scaleBootstrapIndex = bootstrapSource.indexOf("character-rig-scale.js?v=20260904i");
  assert(harlyaoBootstrapIndex >= 0 && scaleBootstrapIndex > harlyaoBootstrapIndex,
    'Harlyao profile inheritance must load before whole-rig scale installs profile defaults');

  const debug = windowObject.HobunjiHarlyaoSpecies.debugSnapshot();
  assert.equal(debug.rigProfilesInstalled, 2);
  assert.equal(debug.wardrobeResolverInstalled, true);
  assert.equal(debug.paletteInheritanceInstalled, true);
  assert.equal(debug.armMaskProfilesInstalled, 2);

  console.log('Harlyao species regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

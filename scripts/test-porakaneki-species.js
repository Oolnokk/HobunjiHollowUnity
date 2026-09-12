const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const porakaneki = JSON.parse(fs.readFileSync('docs/config/species/porakaneki.json', 'utf8')); // Guards the authored NPC-only species contract.
const speciesIndex = JSON.parse(fs.readFileSync('docs/config/species/index.json', 'utf8')); // Guards discoverability through the shared species loader.
const speciesOverrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8')); // Guards the existing barbarian chief's authoritative species assignment.
const runtimeSource = fs.readFileSync('docs/js/porakaneki-species-runtime.js', 'utf8'); // Executed against a minimal browser-shaped host to verify inheritance wiring.
const bootstrapSource = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8'); // Guards load order before whole-rig scale initialization.

assert.equal(porakaneki.speciesId, 'porakaneki');
assert.equal(porakaneki.parentSpecies, 'kenkari');
assert.equal(porakaneki.npcOnly, true);
assert.equal(porakaneki.playerSelectable, false);
assert.deepEqual(porakaneki.genders, ['male']);
assert.equal(porakaneki.inheritanceNotes.wardrobeSpecies, 'kenkari');
assert.equal(porakaneki.inheritanceNotes.bodyColorSpecies, 'kenkari');
assert.equal(porakaneki.inheritanceNotes.handSpecies, 'mashtzarr');
assert.equal(porakaneki.inheritanceNotes.footSpecies, 'engh-sho');
assert.equal(porakaneki.inheritanceNotes.hairSpecies, 'tletingan');
assert.equal(porakaneki.male.headSprite, 'fightersprites/kenkari-m/head_porakaneki_m.png');
assert.deepEqual(porakaneki.male.headUrLayers.map(layer => layer.url), [
  'fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki.png',
]);
assert.deepEqual(porakaneki.male.portraitBodyLayers.map(layer => layer.url), [
  'portraitsprites/arm-L_kenk_m.png',
  'portraitsprites/torso_porakaneki_m.png',
  'portraitsprites/arm-R_kenk_m.png',
]);
assert.equal(porakaneki.male.bodyColorRanges, undefined, 'Porakaneki must inherit live Kenkari ranges rather than freeze a duplicated palette snapshot');
assert(porakaneki.male.allowedCosmetics.includes('appearance::Tletingan_M::tl_forwardtuft_long'));
assert(porakaneki.male.allowedCosmetics.includes('appearance::Tletingan_M::tl_wildbeard'));
assert(!porakaneki.male.allowedCosmetics.includes('appearance::Kenkari_M::kenk_forwardtuft_long'), 'Porakaneki hair must come from Tletingan/Slagothim, not Kenkari');
assert(speciesIndex.entries.some(entry => entry.speciesId === 'porakaneki' && entry.path === './porakaneki.json'));
assert.equal(speciesOverrides.npcs.porakaneki_chief.species, 'porakaneki');
assert(fs.existsSync('docs/assets/fightersprites/kenkari-m/head_porakaneki_m.png'));
assert(fs.existsSync('docs/assets/fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki.png'));
assert(fs.existsSync('docs/assets/fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki_blink.png'), 'Blink alias must match portrait-utils automatic *_blink.png lookup');
assert(fs.existsSync('docs/assets/portraitsprites/torso_porakaneki_m.png'));

const fighters = [
  { id: 'porakaneki_male', speciesId: 'porakaneki', gender: 'male' },
  { id: 'kenkari_male', speciesId: 'kenkari', gender: 'male' },
]; // Used by the palette bridge exactly as portrait-utils exposes its live fighter registry.
const cosmetics = {
  bodyColorRangesByGender: {
    kenkari_male: { A: { source: 'kenkari-male' } },
  },
}; // Proves Porakaneki points at Kenkari's canonical live range object.
const handProfileData = {
  speciesModels: { kenkari: 'avian', mashtzarr: 'pachyderm' },
  speciesScaleOverrides: {},
}; // Proves Porakaneki explicitly resolves the Mashtzarr pachyderm hand-model mapping, not the Kenkari hand family.
const windowObject = {
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: { species: {} },
      portrait: {},
      assets: {
        pngPlaneAvatar: {
          proceduralFeet: {
            models: {
              kenkari: { glb: 'assets/models/feet/foot_kenkari.glb', materialRoles: { Body: 'body' } },
              'engh-sho': { glb: 'assets/models/feet/foot_feline.glb', materialRoles: { Body: 'body' } },
            },
          },
        },
      },
    },
  },
  HobunjiHandModelProfiles: {
    data: handProfileData,
    mutate(mutator) { mutator(this.data); },
  },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    characters: {
      'kenkari::male': {
        species: 'kenkari',
        gender: 'male',
        anatomy: { portraitScale: 1.02, handScale: 0.98, footScale: 1.04, rigScaleX: 1.01, rigScaleY: 0.99 },
        shoulderPerchRule: { appearanceSpeciesId: 'kenkari' },
        posteriorRule: { appearanceSpeciesId: 'kenkari' },
        anchors: { leftHandShoulder: { position: { x: -1, y: 2, z: 0 } } },
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
vm.runInContext(runtimeSource, context, { filename: 'porakaneki-species-runtime.js' });

assert.equal(windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.species.porakaneki.npcOnly, true);
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.species.porakaneki.playerSelectable, false);
assert.deepEqual(Array.from(windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.species.porakaneki.genders), ['male']);
assert.equal(windowObject.HobunjiHandModelProfiles.data.speciesModels.porakaneki, 'pachyderm');
const porakanekiFoot = windowObject.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.models.porakaneki; // Field-level checks avoid cross-realm prototype differences.
const felineFoot = windowObject.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.models['engh-sho']; // Canonical feline source must remain independently mutable.
assert.equal(porakanekiFoot.glb, 'assets/models/feet/foot_feline.glb');
assert.equal(porakanekiFoot.glb, felineFoot.glb);
assert.notEqual(porakanekiFoot, felineFoot);
const porakanekiRig = windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['porakaneki::male']; // Verifies the Kenkari profile is cloned rather than aliased.
assert.equal(porakanekiRig.species, 'porakaneki');
assert.equal(porakanekiRig.anatomy.rigScaleX, 1.01);
assert.equal(porakanekiRig.shoulderPerchRule.appearanceSpeciesId, 'porakaneki');
assert.equal(porakanekiRig.posteriorRule.appearanceSpeciesId, 'porakaneki');
assert.notEqual(porakanekiRig, windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['kenkari::male']);
assert.equal(windowObject.resolveOptionLayers({}, fighters[0]), 'kenkari', 'Porakaneki body/wardrobe variants must resolve through Kenkari');
assert.equal(windowObject.resolveOptionLayers({}, fighters[1]), 'kenkari', 'non-Porakaneki wardrobe resolution must remain untouched');
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['porakaneki:male'].maskYScaleMultiplier, 1.14);

(async () => {
  const loadedCosmetics = await windowObject.loadPortraitCosmetics();
  assert.equal(loadedCosmetics.bodyColorRangesByGender.porakaneki_male, loadedCosmetics.bodyColorRangesByGender.kenkari_male);

  const porakanekiBootstrapIndex = bootstrapSource.indexOf('porakaneki-species-runtime.js?v=20260912b');
  const scaleBootstrapIndex = bootstrapSource.indexOf('character-rig-scale.js?v=20260904i');
  assert(porakanekiBootstrapIndex >= 0 && scaleBootstrapIndex > porakanekiBootstrapIndex,
    'Porakaneki profile inheritance must load before whole-rig scale installs profile defaults');

  const debug = windowObject.HobunjiPorakanekiSpecies.debugSnapshot();
  assert.equal(debug.rigProfilesInstalled, 1);
  assert.equal(debug.handModelInherited, true);
  assert.equal(debug.handDonorSpecies, 'mashtzarr');
  assert.equal(debug.handModelKey, 'pachyderm');
  assert.equal(debug.footModelInherited, true);
  assert.equal(debug.footDonorSpecies, 'engh-sho');
  assert.equal(debug.footGlb, 'assets/models/feet/foot_feline.glb');
  assert.equal(debug.wardrobeResolverInstalled, true);
  assert.equal(debug.paletteInheritanceInstalled, true);
  assert.equal(debug.armMaskProfilesInstalled, 1);
  assert.equal(debug.hairSpecies, 'tletingan');

  console.log('Porakaneki species regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

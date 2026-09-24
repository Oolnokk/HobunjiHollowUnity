const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const porakaneki = JSON.parse(fs.readFileSync('docs/config/species/porakaneki.json', 'utf8')); // Guards the authored NPC-only species contract.
const speciesIndex = JSON.parse(fs.readFileSync('docs/config/species/index.json', 'utf8')); // Guards discoverability through the shared species loader.
const speciesOverrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8')); // Guards the existing barbarian chief's authoritative species assignment.
const bodywrapCosmetic = JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/overwear/tankan_bodywrap.json', 'utf8')); // Guards the exact Kenkari male overwear art Porakaneki must inherit.
const runtimeSource = fs.readFileSync('docs/js/porakaneki-species-runtime.js', 'utf8'); // Executed against a minimal browser-shaped host to verify inheritance wiring.
const bootstrapSource = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8'); // Guards load order before whole-rig scale initialization.

assert.equal(porakaneki.speciesId, 'porakaneki');
assert.equal(porakaneki.parentSpecies, 'kenkari');
assert.equal(porakaneki.npcOnly, true);
assert.equal(porakaneki.playerSelectable, false);
assert.deepEqual(porakaneki.genders, ['male']);
assert.equal(porakaneki.inheritanceNotes.wardrobeSpecies, 'kenkari');
assert.equal(porakaneki.inheritanceNotes.bodyColorSpecies, 'mashtzarr');
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
assert.equal(porakaneki.male.bodyColorRanges, undefined, 'Porakaneki must inherit live Mashtzarr ranges rather than freeze a duplicated palette snapshot');
assert(porakaneki.male.allowedCosmetics.includes('appearance::Tletingan_M::tl_forwardtuft_long'));
assert(porakaneki.male.allowedCosmetics.includes('appearance::Tletingan_M::tl_wildbeard'));
assert(porakaneki.male.allowedCosmetics.includes('bandolier1'));
assert(porakaneki.male.allowedCosmetics.includes('tankan_bodywrap'));
assert(!porakaneki.male.allowedCosmetics.includes('appearance::Kenkari_M::kenk_eyedisks'), 'Porakaneki must never inherit Kenkari eye disks');
assert(!porakaneki.male.allowedCosmetics.includes('appearance::Kenkari_M::kenk_forwardtuft_long'), 'Porakaneki hair must come from Tletingan/Slagothim, not Kenkari');
assert(!porakaneki.male.allowedCosmetics.includes('tankan_tunic'), 'Porakaneki torso clothing is limited to bandoliers');
assert(!porakaneki.male.allowedCosmetics.includes('rugged_poncho'), 'Porakaneki overwear is limited to body wraps');
assert(!porakaneki.male.allowedCosmetics.includes('fine_poncho'), 'Porakaneki overwear is limited to body wraps');
assert(!porakaneki.male.allowedCosmetics.includes('fine_hood'), 'Porakaneki may not inherit Kenkari hood clothing');
assert(!porakaneki.male.allowedCosmetics.some(id => id.includes('appearance::hat::') || id.includes('kenk_bowlkasa')), 'Porakaneki may not inherit Kenkari headwear');
assert.deepEqual(porakaneki.male.forcedCosmetics, { eyes: 'none', hat: 'none', hood: 'none' });
assert.equal(bodywrapCosmetic.slot, 'overwear', 'Tankan Body Wrap must remain an overwear cosmetic, never a hood/facewrap');
assert.equal(
  bodywrapCosmetic.speciesVariants.kenkari_male.parts.torso.layers.back.image.url,
  './assets/cosmetics/clothes/overwear/portrait/tankanbodywrap_kenk_m.png',
  'Porakaneki male bodywrap inheritance must resolve to the Kenkari male bodywrap sprite',
);
assert(fs.existsSync('docs/assets/cosmetics/clothes/overwear/portrait/tankanbodywrap_kenk_m.png'), 'Kenkari male bodywrap sprite must exist');
assert(speciesIndex.entries.some(entry => entry.speciesId === 'porakaneki' && entry.path === './porakaneki.json'));
assert.equal(speciesOverrides.npcs.porakaneki_chief.species, 'porakaneki');
assert(fs.existsSync('docs/assets/fightersprites/kenkari-m/head_porakaneki_m.png'));
assert(fs.existsSync('docs/assets/fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki.png'));
assert(fs.existsSync('docs/assets/fightersprites/kenkari-m/untinted_regions/ur-head_porakaneki_blink.png'), 'Blink alias must match portrait-utils automatic *_blink.png lookup');
assert(fs.existsSync('docs/assets/portraitsprites/torso_porakaneki_m.png'));

const fighters = [
  { id: 'porakaneki_male', speciesId: 'porakaneki', gender: 'male' },
  { id: 'kenkari_male', speciesId: 'kenkari', gender: 'male' },
  { id: 'M', speciesId: 'mao-ao', gender: 'male' },
  { id: 'mashtzarr_male', speciesId: 'mashtzarr', gender: 'male' },
]; // Used by the palette/cosmetic bridge exactly as portrait-utils exposes its live fighter registry.
const cosmetics = {
  bodyColorRangesByGender: {
    kenkari_male: { A: { source: 'kenkari-male' } },
    M: { A: { source: 'mao-ao-male' }, B: { source: 'mao-ao-male-secondary' } },
    mashtzarr_male: { A: { source: 'mashtzarr-male' }, B: { source: 'mashtzarr-male-secondary' } },
  },
  allowedCosmeticsByFighter: {
    porakaneki_male: {
      set: new Set([
        'kenk_eyedisks',
        'basic_headband',
        'fine_hood',
        'tankan_tunic',
        'bandolier1',
        'tankan_bodywrap',
        'rugged_poncho',
        'tl_forwardtuft_long',
      ]),
    },
  },
  forcedCosmeticsByFighter: {
    porakaneki_male: { eyes: 'kenk_eyedisks', hat: 'basic_headband', hood: 'fine_hood' },
  },
}; // Proves the Porakaneki post-load clamp removes cosmetics reintroduced by Kenkari parent inheritance.
const handProfileData = {
  speciesModels: { kenkari: 'avian', mashtzarr: 'pachyderm' },
  speciesScaleOverrides: {},
}; // Proves Porakaneki explicitly resolves the Mashtzarr pachyderm hand-model mapping, not the Kenkari hand family.
const banditEntityConfigs = []; // Captures final configs reaching the original BanditCombat.makeEntity implementation after the Porakaneki guard runs.
const windowObject = {
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: {
        species: {},
        bodyPalettes: {
          mashtzarr: {
            male: [
              { label: 'Color 1', h: -70, s: -0.8, v: -0.55 },
              { label: 'Color 2', h: -40, s: -0.7, v: -0.45 },
              { label: 'Color 3', h: 30, s: -0.6, v: -0.15 },
            ],
          },
        },
      },
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
  BanditCombat: {
    makeEntity(config) { banditEntityConfigs.push(config); return { config }; },
  },
  applyHobunjiAttachmentRigProfileCorrections: () => true,
  resolveOptionLayers: (option, fighter) => ({ optionId: option?.id || null, speciesId: fighter.speciesId, gender: fighter.gender }),
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
const bodywrapResolution = windowObject.resolveOptionLayers({ id: 'tankan_bodywrap' }, fighters[0]); // Verifies the runtime keeps male gender while swapping only the Porakaneki species key to Kenkari.
assert.equal(bodywrapResolution.speciesId, 'kenkari');
assert.equal(bodywrapResolution.gender, 'male');
assert.equal(bodywrapResolution.optionId, 'tankan_bodywrap');
const ordinaryKenkariResolution = windowObject.resolveOptionLayers({ id: 'tankan_bodywrap' }, fighters[1]); // Ensures the wrapper leaves non-Porakaneki resolution untouched.
assert.equal(ordinaryKenkariResolution.speciesId, 'kenkari');
assert.equal(ordinaryKenkariResolution.gender, 'male');
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['porakaneki:male'].maskYScaleMultiplier, 1.14);
const authoredMashtzarrPalette = windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.bodyPalettes.mashtzarr.male; // Finite donor swatches used to bound portrait tint-cache cardinality.
const authoredSwatchKeys = new Set(authoredMashtzarrPalette.map(color => `${color.h}|${color.s}|${color.v}`)); // Membership lookup proves generated A colors are exact authored swatches, not continuous range samples.
const generatedSwatchKeys = new Set(); // Tracks how many authored colors a representative set of resident identities actually reaches.
for (let index = 0; index < 64; index += 1) {
  const bodyColors = windowObject.HobunjiPorakanekiSpecies.bodyColorsForSeed(`camp:resident:${index}`, 'male'); // Stable helper under test; called only at entity materialization in production.
  const key = `${bodyColors.A.h}|${bodyColors.A.s}|${bodyColors.A.v}`; // Exact A-slot signature compared with the finite donor palette.
  assert(authoredSwatchKeys.has(key), 'Porakaneki body A must be one exact authored Mashtzarr swatch');
  assert.deepEqual({ ...bodyColors.B }, { ...bodyColors.A }, 'Porakaneki B must reuse the selected authored body swatch');
  assert.equal(bodyColors.C.h, bodyColors.A.h);
  assert.equal(bodyColors.C.s, Math.max(-1, Math.min(1, bodyColors.A.s + 0.05)));
  assert.equal(bodyColors.C.v, Math.max(-1, Math.min(1, bodyColors.A.v + 0.18)));
  generatedSwatchKeys.add(key);
}
assert(generatedSwatchKeys.size > 1, 'different Porakaneki resident identities must reach more than one Mashtzarr swatch');
assert(generatedSwatchKeys.size <= authoredMashtzarrPalette.length, 'Porakaneki body tint-cache cardinality must be bounded by the authored Mashtzarr palette');
const stableBodyA = windowObject.HobunjiPorakanekiSpecies.bodyColorsForSeed('same-resident', 'male').A; // Repeated identity check ensures LOD rematerialization does not change color.
const stableBodyB = windowObject.HobunjiPorakanekiSpecies.bodyColorsForSeed('same-resident', 'male').A; // Second materialization-style call must choose the same swatch.
assert.deepEqual({ ...stableBodyA }, { ...stableBodyB }, 'same Porakaneki identity must keep its body color across rematerialization');

const porakanekiBanditConfig = {
  speciesWeights: { porakaneki: 1 },
  clothingPool: {
    slots: ['torso', 'overwear', 'hat', 'hood'],
    itemsBySlot: {
      torso: ['bandolier1'],
      overwear: ['tankan_bodywrap'],
      hat: ['appearance::hat::basic_headband'],
      hood: ['fine_hood', 'facewrap'],
    },
    banditExclusiveIds: ['facewrap'],
  },
}; // Mirrors the dangerous shared bandit pool shape that previously let facewrap bypass the Porakaneki species whitelist.
windowObject.BanditCombat.makeEntity(porakanekiBanditConfig);
const guardedBanditConfig = banditEntityConfigs.at(-1); // Final config proves the shared entity factory sees only Porakaneki-approved clothing slots/items.
assert.notEqual(guardedBanditConfig, porakanekiBanditConfig, 'Porakaneki guard must copy rather than mutate the shared bandit config');
assert.deepEqual(Array.from(guardedBanditConfig.clothingPool.slots), ['torso', 'overwear']);
assert.deepEqual(Array.from(guardedBanditConfig.clothingPool.itemsBySlot.torso), ['bandolier1']);
assert.deepEqual(Array.from(guardedBanditConfig.clothingPool.itemsBySlot.overwear), ['tankan_bodywrap']);
assert.deepEqual(Array.from(guardedBanditConfig.clothingPool.itemsBySlot.hat), []);
assert.deepEqual(Array.from(guardedBanditConfig.clothingPool.itemsBySlot.hood), []);
assert.deepEqual(Array.from(guardedBanditConfig.clothingPool.banditExclusiveIds), []);
assert.deepEqual(porakanekiBanditConfig.clothingPool.banditExclusiveIds, ['facewrap'], 'shared source config must remain untouched for real bandits');
const regularBanditConfig = { speciesWeights: { 'mao-ao': 1 }, clothingPool: { banditExclusiveIds: ['facewrap'] } }; // Proves real bandits retain their exclusive facewrap behavior.
windowObject.BanditCombat.makeEntity(regularBanditConfig);
assert.equal(banditEntityConfigs.at(-1), regularBanditConfig, 'non-Porakaneki bandit config must pass through unchanged');

(async () => {
  const loadedCosmetics = await windowObject.loadPortraitCosmetics();
  assert.equal(loadedCosmetics.bodyColorRangesByGender.porakaneki_male, loadedCosmetics.bodyColorRangesByGender.mashtzarr_male, 'Porakaneki must inherit the full live Mashtzarr male palette object');
  assert.notEqual(loadedCosmetics.bodyColorRangesByGender.porakaneki_male, loadedCosmetics.bodyColorRangesByGender.M, 'Porakaneki must not silently fall back to the Mao-ao palette object');
  const allowed = Array.from(loadedCosmetics.allowedCosmeticsByFighter.porakaneki_male.set).sort(); // Normalized in host realm for stable deep-equality assertions.
  const expectedAllowed = Array.from(windowObject.HobunjiPorakanekiSpecies.allowedCosmeticIds).sort();
  assert.deepEqual(allowed, expectedAllowed, 'runtime clamp must remove all inherited Kenkari cosmetics except the two allowed clothing pieces');
  assert(!loadedCosmetics.allowedCosmeticsByFighter.porakaneki_male.set.has('kenk_eyedisks'));
  assert(!loadedCosmetics.allowedCosmeticsByFighter.porakaneki_male.set.has('tankan_tunic'));
  assert(!loadedCosmetics.allowedCosmeticsByFighter.porakaneki_male.set.has('rugged_poncho'));
  assert.equal(loadedCosmetics.forcedCosmeticsByFighter.porakaneki_male.eyes, 'none');
  assert.equal(loadedCosmetics.forcedCosmeticsByFighter.porakaneki_male.hat, 'none');
  assert.equal(loadedCosmetics.forcedCosmeticsByFighter.porakaneki_male.hood, 'none');

  const porakanekiBootstrapIndex = bootstrapSource.indexOf('porakaneki-species-runtime.js?v=20260924poracolor2');
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
  assert.equal(debug.banditWardrobeGuardInstalled, true);
  assert.equal(debug.paletteInheritanceInstalled, true);
  assert.equal(debug.colorSpecies, 'mashtzarr');
  assert.equal(debug.cosmeticRestrictionsApplied, 1);
  assert.equal(debug.eyeDisksSuppressed, true);
  assert.deepEqual(Array.from(debug.allowedCosmeticIds).sort(), expectedAllowed);
  assert.equal(debug.expectedAssets.bodywrapMale, 'cosmetics/clothes/overwear/portrait/tankanbodywrap_kenk_m.png');
  assert.equal(debug.armMaskProfilesInstalled, 1);
  assert.equal(debug.hairSpecies, 'tletingan');

  console.log('Porakaneki species regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

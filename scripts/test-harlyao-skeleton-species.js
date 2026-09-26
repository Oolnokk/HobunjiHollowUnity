const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const skeleton = JSON.parse(fs.readFileSync('docs/config/species/harlyao-skeleton.json', 'utf8')); // Guards the authored skeleton species record and asset contracts.
const speciesIndex = JSON.parse(fs.readFileSync('docs/config/species/index.json', 'utf8')); // Guards discoverability through the shared species loader.
const runtimeSource = fs.readFileSync('docs/js/harlyao-skeleton-species-runtime.js', 'utf8'); // Executed below in a minimal browser-shaped runtime to verify inheritance wiring.
const portraitSource = fs.readFileSync('docs/js/portrait-utils.js', 'utf8'); // Guards the generic fixed-color/base-tint/structural-slot support required by skeleton portraits.
const scaleSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Verifies the skeleton shares regular Harlyao's authored 1.2x scale.
const bootstrapSource = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8'); // Guards load order before shared whole-rig scale installation.

assert.equal(skeleton.speciesId, 'harlyao-skeleton');
assert.equal(skeleton.parentSpecies, 'engh-sho');
assert.equal(skeleton.npcOnly, true);
assert.equal(skeleton.playerSelectable, false);
assert.equal(skeleton.inheritanceNotes.wardrobeSpecies, 'engh-sho');
assert.equal(skeleton.inheritanceNotes.appearanceCosmetics, false);
assert.equal(skeleton.inheritanceNotes.bodyColorCustomization, false);
assert.equal(skeleton.inheritanceNotes.extremityColor, '#D4D6C9');
assert.equal(skeleton.inheritanceNotes.rigScaleMultiplier, 1.2);
assert.equal(skeleton.male.headSprite, 'fightersprites/engh-sho-m/head_hskel_m.png');
assert.equal(skeleton.female.headSprite, 'fightersprites/engh-sho-f/head_hskel_f.png');
assert.deepEqual(skeleton.male.headUrLayers, []);
assert.deepEqual(skeleton.female.headUrLayers, []);
assert.equal(skeleton.male.baseBodyTint, false);
assert.equal(skeleton.female.baseBodyTint, false);
assert.equal(skeleton.male.bodyColorRanges.fixedHex, '#D4D6C9');
assert.equal(skeleton.female.bodyColorRanges.fixedHex, '#D4D6C9');
assert.equal(skeleton.female.fixedPortraitSlots.pauldron[0].url, 'cosmetics/appearance/harlyao_skeleton/hairdefault-right_hskel_f.png');
assert.equal(skeleton.male.fixedPortraitSlots, undefined);
assert(!skeleton.male.allowedCosmetics.some(id => id.includes('hair') || id.includes('snowgoggles') || id.includes('headband')));
assert(!skeleton.female.allowedCosmetics.some(id => id.includes('hair') || id.includes('snowgoggles') || id.includes('headband')));
assert(speciesIndex.entries.some(entry => entry.speciesId === 'harlyao-skeleton' && entry.path === './harlyao-skeleton.json'));

const expectedAssets = [
  'docs/assets/fightersprites/engh-sho-m/head_hskel_m.png',
  'docs/assets/fightersprites/engh-sho-f/head_hskel_f.png',
  'docs/assets/fightersprites/special_cases/head-behind_hskel_m.png',
  'docs/assets/fightersprites/special_cases/head-behind_hskel_f.png',
  'docs/assets/portraitsprites/arm-L_hskel_m.png',
  'docs/assets/portraitsprites/arm-R_hskel_m.png',
  'docs/assets/portraitsprites/torso_hskel_m.png',
  'docs/assets/portraitsprites/arm-L_hskel_f.png',
  'docs/assets/portraitsprites/arm-R_hskel_f.png',
  'docs/assets/portraitsprites/torso_hskel_f.png',
  'docs/assets/cosmetics/appearance/harlyao_skeleton/hairdefault-right_hskel_f.png',
]; // User-authored source art that must exist before the species is considered wired.
for (const asset of expectedAssets) assert(fs.existsSync(asset), `Missing Harlyao Skeleton asset: ${asset}`);

assert(portraitSource.includes("bodyColorRanges?.fixedHex"), 'Portrait randomization must understand fixed hex body descriptors for procedural extremities');
assert(portraitSource.includes('baseBodyTintEnabled'), 'Portrait renderer must support authored-color base sprites without recoloring them');
assert(portraitSource.includes('fixedPortraitSlots?.pauldron'), 'Portrait renderer must inject the female structural hair in the pauldron render slot');

const fighters = [
  { id: 'harlyao-skeleton_male', speciesId: 'harlyao-skeleton', gender: 'male' },
  { id: 'harlyao-skeleton_female', speciesId: 'harlyao-skeleton', gender: 'female' },
  { id: 'engh_male', speciesId: 'engh-sho', gender: 'male' },
]; // Live-fighter stand-in used by the runtime's post-load restrictions.
const cosmetics = {
  bodyColorRangesByGender: {
    'harlyao-skeleton_male': { A: { source: 'wrong-parent-color' } },
    'harlyao-skeleton_female': { A: { source: 'wrong-parent-color' } },
  },
  allowedCosmeticsByFighter: {
    'harlyao-skeleton_male': { set: new Set(['engh_hairdefault-front', 'engh_snowgoggles', 'fine_hood']) },
    'harlyao-skeleton_female': { set: new Set(['engh_hairdefault-front', 'engh_snowgoggles', 'fine_hood']) },
  },
  forcedCosmeticsByFighter: {
    'harlyao-skeleton_male': {},
    'harlyao-skeleton_female': {},
  },
}; // Deliberately contains inherited appearance options so the runtime must remove them.
const handProfileData = {
  speciesModels: { 'engh-sho': 'feline' },
  speciesScaleOverrides: {},
}; // Confirms the new species resolves the same feline hand model family as Engh-sho.
const windowObject = {
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: { species: {} },
      portrait: {},
      assets: {
        pngPlaneAvatar: {
          proceduralFeet: {
            species: {
              'engh-sho': { glb: 'assets/models/feet/foot_feline.glb', materialRoles: { 'Mat 1': 'body' } },
            },
          },
          behindView: { headUrls: {} },
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
      'engh-sho::male': {
        species: 'engh-sho', gender: 'male',
        anatomy: { portraitScale: 0.95, handScale: 1.2, footScale: 1.1, rigScaleX: 0.8, rigScaleY: 0.845, headScale: 0.7894736842105263, headOffsetY: 0 },
        anchors: { leftHandShoulder: { position: { x: -1, y: 2, z: 0 } } },
      },
      'engh-sho::female': {
        species: 'engh-sho', gender: 'female',
        anatomy: { portraitScale: 0.975, handScale: 1.2, footScale: 1.1, rigScaleX: 0.795, rigScaleY: 0.81, headScale: 0.7894736842105263, headOffsetY: 0 },
        anchors: { leftHandShoulder: { position: { x: -2, y: 3, z: 0 } } },
      },
    },
  },
  applyHobunjiAttachmentRigProfileCorrections: () => true,
  resolveOptionLayers: (_option, fighter) => fighter.speciesId,
  getPortraitFighters: () => fighters,
  loadPortraitCosmetics: async () => cosmetics,
  NpcAvatarPreview: {
    buildProfileFromNpcExport(npc) {
      return { fighter: { speciesId: npc?.appearance?.speciesId }, bodyColors: { ...(npc?.appearance?.bodyColors || {}) } };
    },
  },
}; // Minimal browser-shaped host used to exercise the bridge without loading the full game.
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(runtimeSource, context, { filename: 'harlyao-skeleton-species-runtime.js' });

assert.equal(windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.species['harlyao-skeleton'].npcOnly, true);
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.appearanceEditor.species['harlyao-skeleton'].playerSelectable, false);
assert.equal(windowObject.HobunjiHandModelProfiles.data.speciesModels['harlyao-skeleton'], 'feline');
const skeletonFoot = windowObject.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.species['harlyao-skeleton']; // Field-level checks avoid cross-realm prototype differences.
const enghFoot = windowObject.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.species['engh-sho']; // Canonical donor must remain independently mutable.
assert.equal(skeletonFoot.glb, 'assets/models/feet/foot_feline.glb');
assert.notEqual(skeletonFoot, enghFoot);
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.behindView.headUrls['harlyao-skeleton'].male, 'fightersprites/special_cases/head-behind_hskel_m.png');
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.behindView.headUrls['harlyao-skeleton'].female, 'fightersprites/special_cases/head-behind_hskel_f.png');
assert.equal(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao-skeleton::male'].species, 'harlyao-skeleton');
assert.equal(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao-skeleton::male'].anatomy.rigScaleX, undefined);
assert.equal(windowObject.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['harlyao-skeleton::female'].anatomy.headScale, undefined);
assert.equal(windowObject.resolveOptionLayers({}, fighters[0]), 'engh-sho', 'Skeleton wardrobe variants must resolve through Engh-sho');
assert.equal(windowObject.resolveOptionLayers({}, fighters[2]), 'engh-sho', 'Non-skeleton wardrobe resolution must remain unchanged');
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['harlyao-skeleton:male'].maskYScaleMultiplier, 1.04);
assert.equal(windowObject.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['harlyao-skeleton:female'].maskYScaleMultiplier, 1.15);
const skeletonExportProfile = windowObject.NpcAvatarPreview.buildProfileFromNpcExport({ appearance: { speciesId: 'harlyao-skeleton', bodyColors: { A: { hex: '#000000' } } } }); // Explicitly wrong imported color must be ignored for a colorless skeleton species.
assert.equal(skeletonExportProfile.bodyColors.A.hex, '#D4D6C9');
assert.equal(skeletonExportProfile.bodyColors.B.hex, '#D4D6C9');
assert.equal(skeletonExportProfile.bodyColors.C.hex, '#D4D6C9');
const enghExportProfile = windowObject.NpcAvatarPreview.buildProfileFromNpcExport({ appearance: { speciesId: 'engh-sho', bodyColors: { A: { hex: '#123456' } } } }); // Non-skeleton NPC exports must remain untouched by the guard.
assert.equal(enghExportProfile.bodyColors.A.hex, '#123456');

(async () => {
  const loaded = await windowObject.loadPortraitCosmetics();
  for (const fighterId of ['harlyao-skeleton_male', 'harlyao-skeleton_female']) {
    assert.equal(loaded.bodyColorRangesByGender[fighterId].fixedHex, '#D4D6C9'); // Field-level equality avoids VM-realm prototype differences while still proving the fixed extremity descriptor.
    assert.deepEqual(Array.from(loaded.allowedCosmeticsByFighter[fighterId].set).sort(), ['bandolier1', 'fine_hood', 'fine_poncho', 'rugged_poncho', 'tankan_tunic'].sort());
    for (const slot of ['eyes', 'upperFace', 'facialHair', 'hairFront', 'hairBack', 'hairSide', 'hairSideL', 'hat']) {
      assert.equal(loaded.forcedCosmeticsByFighter[fighterId][slot], 'none');
    }
  }

  vm.runInContext(scaleSource, context, { filename: 'character-rig-scale-defaults.js' });
  for (const gender of ['male', 'female']) {
    const skeletonScale = windowObject.HobunjiCharacterRigScaleDefaults.scaleFor('harlyao-skeleton', gender);
    const harlyaoScale = windowObject.HobunjiCharacterRigScaleDefaults.scaleFor('harlyao', gender);
    assert.equal(skeletonScale.x, harlyaoScale.x);
    assert.equal(skeletonScale.y, harlyaoScale.y);
    assert.equal(skeletonScale.head, harlyaoScale.head);
  }

  const runtimeBootstrapIndex = bootstrapSource.indexOf("harlyao-skeleton-species-runtime.js?v=20260926hskel1");
  const scaleBootstrapIndex = bootstrapSource.indexOf("character-rig-scale.js?v=20260904i");
  assert(runtimeBootstrapIndex >= 0 && scaleBootstrapIndex > runtimeBootstrapIndex,
    'Harlyao Skeleton rig inheritance must load before whole-rig scale installs profile defaults');

  const debug = windowObject.HobunjiHarlyaoSkeletonSpecies.debugSnapshot();
  assert.equal(debug.rigProfilesInstalled, 2);
  assert.equal(debug.handModelKey, 'feline');
  assert.equal(debug.footModelInherited, true);
  assert.equal(debug.behindHeadsInstalled, 2);
  assert.equal(debug.cosmeticRestrictionsApplied, 2);
  assert.equal(debug.fixedColorProfilesApplied, 2);
  assert.equal(debug.profileColorGuardInstalled, true);
  assert.equal(debug.profileColorCorrections, 1);
  assert.equal(debug.extremityColor, '#D4D6C9');

  console.log('Harlyao Skeleton species regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

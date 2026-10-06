const assert = require('node:assert/strict'); // Used for all Nuhongan inheritance, creator and scale regression checks below.
const fs = require('node:fs'); // Reads the exact shipped repository sources exercised by the browser.
const vm = require('node:vm'); // Executes browser modules against lightweight window-shaped test registries.

const read = path => fs.readFileSync(path, 'utf8'); // Keeps repository-source assertions concise.
const species = JSON.parse(read('docs/config/species/nuhongan.json')); // Canonical parent-species record consumed by portrait inheritance.
const speciesIndex = JSON.parse(read('docs/config/species/index.json')); // Shared species-loader registry.
const poseConfig = JSON.parse(read('docs/config/combat/species-pose-orbit-scales.json')); // Weapon-pose reach table does not itself walk parentSpecies.
const runtimeSource = read('docs/js/nuhongan-species-runtime.js'); // Single owner for Nuhongan runtime + creator inheritance.
const redesignSource = read('docs/js/onboarding-character-creation-redesign.js'); // Contains the pre-existing Slagothim/Nuhongan placeholder UI.
const attachmentBootstrap = read('docs/js/attachment-rig-latest-authored-snapshot.js'); // Loads the species bridge after canonical rig data.
const gameIndex = read('docs/index.html'); // Guards held-action/rig bootstrap availability before onboarding.

assert.equal(species.speciesId, 'nuhongan');
assert.equal(species.label, 'Nuhongan');
assert.equal(species.parentSpecies, 'tletingan');
assert.deepEqual(species.genders, ['male', 'female']);
assert(speciesIndex.entries.some(entry => entry.speciesId === 'nuhongan' && entry.path === './nuhongan.json'));
assert.deepEqual(poseConfig.species.nuhongan, poseConfig.species.tletingan, 'Nuhongan weapon-pose orbit must exactly match Tletingan');

// The creator now owns both supported Slagothim subspecies directly. Its UI
// must not depend on a second observer repairing a disabled placeholder.
assert.match(redesignSource, /data-ob-subspecies="nuhongan"/);
assert.doesNotMatch(runtimeSource, /installCreatorSubspeciesUi/);
assert.match(redesignSource, /nuhonganButton.hidden = true/);
assert.match(redesignSource, /coreButton.click\(\)/);
assert(attachmentBootstrap.includes("nuhongan-species-runtime.js?v="), 'attachment bootstrap must load the Nuhongan bridge');
assert(gameIndex.indexOf('js/held-action-animations.js?v=') < gameIndex.indexOf('onboarding.js?v='), 'hand/attachment bootstrap must complete before onboarding scripts install the Slagothim UI');

const scaleWindow = { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: {} } } } } } }; // Executes canonical whole-rig scale defaults without a browser.
vm.runInNewContext(read('docs/config/character-rig-scale-defaults.js'), { window: scaleWindow });
const tletinganMale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('tletingan', 'male'); // Male ratio donor.
const tletinganFemale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('tletingan', 'female'); // Female ratio donor.
const nuhonganMale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('nuhongan', 'male'); // Male Nuhongan proportions.
const nuhonganFemale = scaleWindow.HobunjiCharacterRigScaleDefaults.scaleFor('nuhongan', 'female'); // Female Nuhongan proportions.
assert(Math.abs(nuhonganMale.x - tletinganMale.x * 0.8) < 1e-9);
assert(Math.abs(nuhonganMale.y - tletinganMale.y * 0.75) < 1e-9);
assert.equal(nuhonganMale.head, tletinganMale.head);
assert(Math.abs(nuhonganFemale.x - tletinganFemale.x * 0.8) < 1e-9);
assert(Math.abs(nuhonganFemale.y - tletinganFemale.y * 0.75) < 1e-9);
assert.equal(nuhonganFemale.head, tletinganFemale.head);

const runtimeWindow = { // Models the real inheritance registries closely enough to catch lost hands/feet and direct-lookup systems.
  HobunjiCharacterRigScaleDefaults: scaleWindow.HobunjiCharacterRigScaleDefaults,
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: {
        species: { tletingan: { label: 'Tletingan', genders: ['male', 'female'], male: { slots: [{ slot: 'hairFront' }] }, female: { slots: [{ slot: 'hairBack' }] } } },
        bodyPalettes: { tletingan: { male: ['m'], female: ['f'] } },
      },
      portrait: { armOnlyOpacityMask: { profiles: {} } },
      assets: {
        pngPlaneAvatar: {
          behindView: { headUrls: { tletingan: { male: 'tl-behind-m.png', female: 'tl-behind-f.png' } } },
          proceduralFeet: {
            species: { tletingan: { glb: 'sloth-feet.glb', materialRoles: { claw: 'bone' } } },
            footScale: { tletingan: { male: 1, female: 1.025 } },
            legBend: { tletingan: { male: { x: 1, z: 2 }, female: { x: 3, z: 4 } } },
          },
        },
      },
    },
  },
  ConditionRegistry: { PLAYER_SPECIES: ['mao-ao', 'tletingan', 'kenkari', 'engh-sho', 'rakakoan'] },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    characters: {
      'tletingan::male': { species: 'tletingan', gender: 'male', anchors: { hand: 1 }, anatomy: { rigScaleX: 99, rigScaleY: 99, headScale: 99, headOffsetY: 99, handScale: 0.9, footScale: 1 } },
      'tletingan::female': { species: 'tletingan', gender: 'female', anchors: { hand: 2 }, anatomy: { rigScaleX: 98, rigScaleY: 98, headScale: 98, headOffsetY: 98, handScale: 0.925, footScale: 1.025 } },
    },
  },
  HobunjiSpeciesPoseScale: {
    values: { 'tletingan::male': 0.5, 'tletingan::female': 0.47 },
    resolveScale(speciesId, gender) { return this.values[`${speciesId}::${gender}`]; },
    setScale(speciesId, gender, value) { this.values[`${speciesId}::${gender}`] = value; return true; },
  },
  PortraitArmCloudMask: {
    authoredProfiles: {
      'tletingan:male': { maskYScaleMultiplier: 0.6, seed: 28480 },
      'tletingan:female': { maskYScaleMultiplier: 1.35, seed: 28480 },
    },
  },
  _getMouthSpriteUrl(expression, speciesId, gender) { return `${expression}:${speciesId}:${gender}`; },
  _isMouthMask(speciesId) { return speciesId === 'tletingan'; },
  _getMouthExpressionOpacity(expression, speciesId) { return speciesId === 'tletingan' ? 0.75 : 1; },
  MetalArmorSystem: {
    version: 3,
    spriteForBlueprintAppearance(_blueprintId, rawAppearance) { return `${rawAppearance?.speciesId || rawAppearance?.species}:${rawAppearance?.gender}`; },
    init(injectedDeps) { runtimeWindow._metalArmorDeps = injectedDeps; return true; },
  },
  BanditNameForge: {
    generateCulturalIdentity(options) { return { givenName: `name:${options.speciesId}:${options.gender}` }; },
    cultureIdForSpecies(speciesId) { return `culture:${speciesId}`; },
  },
  HobunjiNameAdvisor: {
    makeIdeaOptions(speciesId, slot, idea) { return [`${speciesId}:${slot}:${idea}`]; },
  },
};
runtimeWindow.HobunjiHandModelProfiles = {
  data: { speciesModels: { tletingan: 'sloth' }, speciesScaleOverrides: {} },
  mutate(fn) { fn(this.data); },
  modelKeyForSpecies(speciesId) {
    return this.data.speciesModels[speciesId]
      || this.data.speciesModels[runtimeWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.species[speciesId]?.parentSpecies]
      || null;
  },
  speciesScaleFor(speciesId, gender) { return this.data.speciesScaleOverrides[speciesId]?.[gender] ?? null; },
  footScaleFor(speciesId, gender) { return runtimeWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale[speciesId]?.[gender] ?? null; },
};
runtimeWindow.applyHobunjiAttachmentRigProfileCorrections = () => { // Simulates the canonical correction pass that publishes profile hand/foot scales.
  for (const profile of Object.values(runtimeWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters)) {
    const { species: speciesId, gender, anatomy = {} } = profile;
    if (Number.isFinite(anatomy.handScale)) {
      runtimeWindow.HobunjiHandModelProfiles.data.speciesScaleOverrides[speciesId] ||= {};
      runtimeWindow.HobunjiHandModelProfiles.data.speciesScaleOverrides[speciesId][gender] = anatomy.handScale;
    }
    if (Number.isFinite(anatomy.footScale)) {
      const feet = runtimeWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale;
      feet[speciesId] ||= {};
      feet[speciesId][gender] = anatomy.footScale;
    }
  }
  return true;
};

vm.runInNewContext(runtimeSource, { window: runtimeWindow, console, MutationObserver: undefined });
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.species.nuhongan.parentSpecies, 'tletingan');
assert.equal(JSON.stringify(runtimeWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.bodyPalettes.nuhongan), JSON.stringify(runtimeWindow.SCRATCHBONES_CONFIG.game.appearanceEditor.bodyPalettes.tletingan));
assert.equal(runtimeWindow.HobunjiHandModelProfiles.modelKeyForSpecies('nuhongan'), 'sloth', 'Nuhongan must resolve the Tletingan/sloth hand model');
assert.equal(runtimeWindow.HobunjiHandModelProfiles.data.speciesScaleOverrides.nuhongan.male, 0.9, 'male hand scale must survive rig cloning');
assert.equal(runtimeWindow.HobunjiHandModelProfiles.data.speciesScaleOverrides.nuhongan.female, 0.925, 'female hand scale must survive rig cloning');
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale.nuhongan.male, 1, 'male foot scale must be published under Nuhongan');
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale.nuhongan.female, 1.025, 'female foot scale must be published under Nuhongan');
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.species.nuhongan.glb, 'sloth-feet.glb', 'Nuhongan must inherit the Tletingan foot model');
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.behindView.headUrls.nuhongan.male, 'tl-behind-m.png', 'rear head must inherit Tletingan direct-lookup art');
assert.equal(runtimeWindow.HobunjiSpeciesPoseScale.values['nuhongan::male'], 0.5);
assert.equal(runtimeWindow.HobunjiSpeciesPoseScale.values['nuhongan::female'], 0.47);
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['nuhongan:male'].maskYScaleMultiplier, 0.6);
assert.equal(runtimeWindow.SCRATCHBONES_CONFIG.game.portrait.armOnlyOpacityMask.profiles['nuhongan:female'].maskYScaleMultiplier, 1.35);
assert.equal(runtimeWindow._getMouthSpriteUrl('talk', 'nuhongan', 'male'), 'talk:tletingan:male', 'mouth expressions must route to Tletingan art');
assert.equal(runtimeWindow._getMouthExpressionOpacity('talk', 'nuhongan'), 0.75, 'mouth opacity tuning must route to Tletingan');
assert(runtimeWindow.ConditionRegistry.PLAYER_SPECIES.includes('nuhongan'), 'shared player-species condition taxonomy must include Nuhongan');

assert.equal(runtimeWindow.MetalArmorSystem.spriteForBlueprintAppearance('rounded_pauldron', { speciesId: 'nuhongan', gender: 'male' }), 'tletingan:male', 'Nuhongan metal armor must use Tletingan-authored sprite variants');
runtimeWindow.MetalArmorSystem.init({ getPlayerData: () => ({ appearance: { speciesId: 'nuhongan', gender: 'female' } }) });
assert.equal(runtimeWindow._metalArmorDeps.getPlayerData().appearance.speciesId, 'tletingan', 'MetalArmorSystem current-player sprite lookup must see the Tletingan donor only inside that module');
assert.equal(runtimeWindow.BanditNameForge.generateCulturalIdentity({ speciesId: 'nuhongan', gender: 'male' }).givenName, 'name:tletingan:male', 'Nuhongan generated names must use Tletingan culture');
assert.equal(runtimeWindow.BanditNameForge.cultureIdForSpecies('nuhongan'), 'culture:tletingan');
assert.equal(runtimeWindow.HobunjiNameAdvisor.makeIdeaOptions('nuhongan', 'first', 'bru')[0], 'slagothim:given:bru', 'Nuhongan lore-name suggestions must use Slagothim phonetics');

for (const gender of ['male', 'female']) {
  const profile = runtimeWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[`nuhongan::${gender}`];
  assert(profile);
  assert.equal(profile.species, 'nuhongan');
  assert.equal(profile.anatomy.rigScaleX, undefined);
  assert.equal(profile.anatomy.rigScaleY, undefined);
  assert.equal(profile.anatomy.headScale, undefined);
  assert.equal(profile.anatomy.headOffsetY, undefined);
  assert(Number.isFinite(profile.anatomy.handScale), `${gender} Nuhongan must retain Tletingan handScale`);
  assert(Number.isFinite(profile.anatomy.footScale), `${gender} Nuhongan must retain Tletingan footScale`);
  assert.equal(JSON.stringify(profile.anatomy.handScaleAxes), JSON.stringify({ x: 1.25, y: 1.3333333333333333, z: 1.25 }));
  assert.equal(JSON.stringify(profile.anatomy.footScaleAxes), JSON.stringify(profile.anatomy.handScaleAxes));
}
const runtimeDebug = runtimeWindow.HobunjiNuhonganSpecies.debugSnapshot();
assert.equal(runtimeDebug.rigHeightMultiplier, 0.75);
assert.equal(runtimeDebug.rigWidthMultiplier, 0.8);
assert.equal(runtimeDebug.handModelKey, 'sloth');
assert.equal(runtimeDebug.handScale.male, 0.9);
assert.equal(runtimeDebug.footScale.female, 1.025);
assert.equal(runtimeDebug.behindHeadInstalled, true);
assert.equal(runtimeDebug.armMaskProfilesInstalled, 2);
assert.equal(runtimeDebug.metalArmorInheritanceInstalled, true);
assert.equal(runtimeDebug.nameForgeInheritanceInstalled, true);
assert.equal(runtimeDebug.nameAdvisorInheritanceInstalled, true);
assert.equal(runtimeDebug.conditionSpeciesRegistered, true);

// onboarding-core's private table must preserve the parent relation so creator
// preview hands/feet can walk Nuhongan -> Tletingan before gameplay starts.
const privateSpeciesTable = {
  'mao-ao': { label: 'Mao-ao' },
  tletingan: { label: 'Tletingan', genders: ['male'], male: { slots: [{ slot: 'hairFront', options: [{ id: 'same' }] }], colorOptions: ['same'] } },
  kenkari: { label: 'Kenkari' },
  'engh-sho': { label: 'Engh-sho' },
};
assert.equal(runtimeWindow.HobunjiNuhonganSpecies.hydrateOnboardingSpeciesTable(privateSpeciesTable), true);
assert.equal(privateSpeciesTable.nuhongan.label, 'Nuhongan');
assert.equal(privateSpeciesTable.nuhongan.parentSpecies, 'tletingan');
assert.deepEqual(Array.from(privateSpeciesTable.nuhongan.genders), privateSpeciesTable.tletingan.genders);
assert.equal(JSON.stringify(privateSpeciesTable.nuhongan.male), JSON.stringify(privateSpeciesTable.tletingan.male));
assert.notEqual(privateSpeciesTable.nuhongan, privateSpeciesTable.tletingan);

// Character Studio's private BASE_SPECIES_DATA contains the actual Tletingan
// cosmetic controls. Verify its hook clones that final table rather than the
// lightweight scratchbones-config species metadata that caused the regression.
const studioWindow = {};
vm.runInNewContext(read('docs/js/character-studio-mammakhbuur-config.js'), { window: studioWindow, console });
studioWindow.SCRATCHBONES_CONFIG = {
  game: {
    appearanceEditor: {
      species: {
        mashtzarr: { label: 'Mashtzarr', male: { slots: [] }, female: { slots: [] } },
        tletingan: { label: 'Tletingan', genders: ['male', 'female'], male: { colorOptions: ['m'] }, female: { colorOptions: ['f'] } },
      },
      bodyPalettes: { mashtzarr: { male: ['m'], female: ['f'] }, tletingan: { male: ['tm'], female: ['tf'] } },
    },
  },
};
const fullStudioTable = {
  'mao-ao': { label: 'Mao-ao', genders: ['male'] },
  kenkari: { label: 'Kenkari', genders: ['male'] },
  tletingan: {
    label: 'Tletingan',
    genders: ['male', 'female'],
    male: { slots: [{ slot: 'hairFront', options: [{ id: 'front' }] }, { slot: 'facialHair', options: [{ id: 'beard' }] }], colorOptions: ['m'] },
    female: { slots: [{ slot: 'hairBack', options: [{ id: 'back' }] }, { slot: 'hairSide', options: [{ id: 'side' }] }], colorOptions: ['f'] },
  },
  nuhongan: { label: 'Nuhongan', parentSpecies: 'tletingan', genders: ['male', 'female'], male: { colorOptions: ['m'] }, female: { colorOptions: ['f'] } },
};
const studioBridge = studioWindow.HobunjiCharacterStudioMammakhbuurConfig;
assert.equal(studioBridge.hydratePrivateSpeciesTable(fullStudioTable), true);
assert.equal(fullStudioTable.nuhongan.parentSpecies, 'tletingan');
assert.equal(JSON.stringify(fullStudioTable.nuhongan.male.slots), JSON.stringify(fullStudioTable.tletingan.male.slots), 'male Studio cosmetics must be complete Tletingan slots');
assert.equal(JSON.stringify(fullStudioTable.nuhongan.female.slots), JSON.stringify(fullStudioTable.tletingan.female.slots), 'female Studio cosmetics must be complete Tletingan slots');
assert.equal(studioBridge.status.nuhonganSlotCount, fullStudioTable.tletingan.male.slots.length);

// Regression for a malformed escaping sequence introduced in the first PR pass:
// parser-time bootstrap must emit a real closing script tag rather than literal backslashes.
assert.match(attachmentBootstrap, /document\.write\(`<script src="\$\{src\}"><\\\/script>`\)/);
assert.doesNotMatch(attachmentBootstrap, /src=\\\\\"/, 'attachment bootstrap must not emit literal escaped quotes');

console.log('Nuhongan serious inheritance review tests passed.');

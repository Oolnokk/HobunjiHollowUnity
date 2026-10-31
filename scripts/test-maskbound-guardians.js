'use strict';
const assert = require('node:assert/strict'); // Verifies guardian config, registration and troop seams without a browser.
const fs = require('node:fs'); // Reads the same committed runtime/config files deployed to Pages.
const vm = require('node:vm'); // Executes isolated browser globals for each seam.
const read = path => fs.readFileSync(path, 'utf8'); // Shared fixture for all source and JSON assertions.
const json = path => JSON.parse(read(path)); // Makes malformed costume/species manifests fail visibly.

const species = json('docs/config/species/maskbound-guardian.json');
const speciesIndex = json('docs/config/species/index.json');
const cosmeticsIndex = json('docs/config/cosmetics/index.json');
const mask = json('docs/config/cosmetics/clothes/masks/hachutu_binding_mask_ii.json');
assert.equal(species.npcOnly, true);
assert.equal(species.playerSelectable, false);
assert.equal(species.male.baseBodyTint, true, 'wooden body pixels must accept recoloring');
assert(species.male.portraitBodyLayers.every(layer => layer.tintSlot === 'A'), 'every wooden torso/arm layer uses the same color input');
assert(species.male.headSprite.includes('maoskel'), 'guardian reuses Mao-ao skeleton head art');
assert(speciesIndex.entries.some(entry => entry.speciesId === 'maskbound-guardian'));
assert(cosmeticsIndex.entries.some(entry => entry.id === 'hachutu_binding_mask_ii'));
assert.equal(mask.slot, 'mask');
for (const [variant,filename] of Object.entries({
  'mao-ao_male': 'bindingmask_2_m.png',
  'maskbound-guardian_male': 'bindingmask_2_m.png',
  'mashtzarr_male': 'bindingmask_2_mashtz_m.png',
})) {
  const actual = mask.speciesVariants[variant]?.parts?.head?.layers?.front?.image?.url;
  assert.equal(actual, './assets/cosmetics/clothes/masks/' + filename);
  assert(fs.existsSync('docs/assets/cosmetics/clothes/masks/' + filename), 'mask sprite must be committed: ' + filename);
}
for (const path of [species.male.headSprite, ...species.male.portraitBodyLayers.map(layer => layer.url)]) {
  assert(fs.existsSync('docs/assets/' + path), 'skeleton sprite must exist: ' + path);
}
for (const file of ['mao-ao', 'mashtzarr']) {
  assert(json('docs/config/species/' + file + '.json').male.allowedCosmetics.includes('hachutu_binding_mask_ii'));
}

const shared = {
  console, Math,
  SCRATCHBONES_CONFIG: { game: { appearanceEditor: { species: {} }, portrait: {}, assets: { pngPlaneAvatar: { proceduralFeet: { species: { 'mao-ao': { glb: 'mao-feet.glb' } } }, behindView: { headUrls: {} } } } } },
  HobunjiHandModelProfiles: { data: { speciesModels: { 'mao-ao': 'canine' } }, mutate(fn) { fn(this.data); } },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'mao-ao::male': { species: 'mao-ao', gender: 'male', anatomy: {} } } },
  PortraitArmCloudMask: { authoredProfiles: { 'mao-ao:male': { seed: 1 } } },
  resolveOptionLayers: (_opt, fighter) => fighter.speciesId,
};
shared.window = shared;
vm.createContext(shared);
vm.runInContext(read('docs/js/skeleton-species-runtime.js'), shared);
vm.runInContext(read('docs/js/maskbound-guardian-species-runtime.js'), shared);
assert.equal(shared.SCRATCHBONES_CONFIG.game.appearanceEditor.species['maskbound-guardian'].bodyColorCustomization, true);
assert.equal(shared.HobunjiHandModelProfiles.data.speciesModels['maskbound-guardian'], 'canine');
assert.equal(shared.resolveOptionLayers({}, { speciesId: 'maskbound-guardian', gender: 'male' }), 'mao-ao');
assert.equal(shared.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['maskbound-guardian::male'].species, 'maskbound-guardian');

const npcProfile = { bodyColors: { A: { hex: '#102030' }, B: { hex: '#0c1620' } } };
shared.NpcAvatarPreview = { buildProfileFromNpcExport() { return { bodyColors: { ...npcProfile.bodyColors } }; } };
shared.HobunjiMaskboundGuardianSpecies.installProfileColorGuard();
const variable = shared.NpcAvatarPreview.buildProfileFromNpcExport({ appearance: { speciesId: 'maskbound-guardian' } });
assert.equal(variable.bodyColors.A.hex, '#102030', 'guardian troop wood shades survive skeleton appearance guard');

let captured; // Last MinionCombat call verifies guardian spawner's explicit class/anatomy/roster forwarding.
const spawnContext = {
  console, Math,
  MinionCombat: {
    rollRoster(speciesId, name) {
      return { name, appearance: { speciesId, gender: 'male' }, equippedCosmetics: [], appliedDyes: {} };
    },
    async makeEntity(opts) { captured = opts; return { enemyClass: opts.enemyClass, def: { weaponKey: 'dummy', weaponShapeKey: 'dummy', banditAbilityLoadout: { tap1:'swingCombo' } }, _banditToolHolder: { visible: true }, rosterRecord: opts.roster, avatarRef: { rigScale: opts.avatarRigScale } }; },
  },
  HobunjiCharacterRigScale: {
    scaleFor(_species,_gender,profile) {
      const a = profile.anatomy;
      return { x: a.rigScaleX, y: a.rigScaleY, head: a.headScale, offsetY: a.headOffsetY };
    },
  },
};
spawnContext.window = spawnContext;
vm.createContext(spawnContext);
vm.runInContext(read('docs/js/combat/combat-maskbound-guardian.js'), spawnContext);
(async () => {
  const combat = spawnContext.MaskboundGuardianCombat;
  for (const type of Object.keys(combat.troopTypes)) {
    const creature = await combat.makeEntity({ troopType: type, x: 10, y: 20 });
    assert.equal(creature.enemyClass, 'maskbound-guardian');
    assert.equal(creature.maskboundTroop, type);
    assert.equal(captured.roster.appearance.speciesId, 'maskbound-guardian');
    assert(captured.roster.equippedCosmetics.includes('hachutu_binding_mask_ii'));
    assert.equal(captured.shamblingFootingFraction, 0);
    assert(captured.avatarRigScale.y > 0);
    assert(combat.formatDebug(creature).includes('mask=yes'));
    if (type === 'headtaker') {
      assert.equal(creature.def.weaponKey, null, 'Headtaker strips Minion default weapons');
      assert.equal(creature._banditToolHolder.visible, false, 'Headtaker hides unused weapon visual');
      assert.equal(creature.def.banditAbilityLoadout.tap1, null, 'Headtaker has no ordinary attack abilities');
    }
  }
  spawnContext.GameRandom = {random:()=>0};
  const hooded = combat.rollRoster('sentinel');
  assert(hooded.equippedCosmetics.includes('ragged_hood'));
  assert.equal(hooded.cosmeticSlots.ragged_hood,'hood');
  assert.equal(hooded.cosmeticSlots.hachutu_binding_mask_ii,'mask');
  spawnContext.GameRandom = {random:()=>0.99};
  assert(!combat.rollRoster('sentinel').equippedCosmetics.includes('ragged_hood'));
  for (const troop of Object.values(combat.troopTypes)) assert.equal(troop.anatomy.headScale,1);
  assert.equal(combat.rigScaleFor({anatomy:{rigScaleX:2,rigScaleY:2,headScale:0.8}}).head,0.8,'authored troop head scale is honored (Character Rig Scale values are the author\'s to control); the shipped troops default to 1');
  const sentinel = combat.troopTypes.sentinel.anatomy;
  const bulwark = combat.troopTypes.bulwark.anatomy;
  const reacher = combat.troopTypes.reacher.anatomy;
  const headtaker = combat.troopTypes.headtaker.anatomy;
  assert(headtaker.rigScaleY < reacher.rigScaleY && headtaker.rigScaleY > sentinel.rigScaleY, 'Headtaker is slightly shorter than Reacher but taller than Sentinel');
  assert.equal(combat.troopTypes.headtaker.weapons.length, 0, 'Headtaker does not hold a weapon');
  assert.notEqual(sentinel.rigScaleY, bulwark.rigScaleY);
  assert.notEqual(reacher.rigScaleX, bulwark.rigScaleX);
  assert.throws(() => combat.troopFor('__proto__'), /Unknown/);

  const banditSource = read('docs/js/combat/combat-bandit.js');
  const from = banditSource.indexOf('  function applyAuthoredHostileRigScale(');
  const to = banditSource.indexOf('  async function makeBanditEntity(', from);
  assert(from >= 0 && to > from, 'hostile scale helper is installed before entity construction');
  const helper = vm.runInNewContext(banditSource.slice(from, to) + ';applyAuthoredHostileRigScale');
  const bone = () => ({ scale: { x: 1, y: 1 }, position: { y: 0.25 }, updateMatrix() {} });
  const front = bone(), back = bone();
  const avatar = {
    modelWidth: 0.9, modelHeight: 0.9, neckJoint: { front, back },
    group: { scale: { x: 1, y: 1, z: 1, set(x,y,z) { Object.assign(this, {x,y,z}); } }, userData: {} },
  };
  assert.equal(helper(avatar, { x: 1.6, y: 1.3, head: 0.9, offsetY: 0.1 }), true);
  assert(Math.abs(avatar.modelWidth - 1.44) < 1e-9, 'collision width matches puppet body');
  assert(Math.abs(avatar.modelHeight - 1.17) < 1e-9, 'grounding height matches puppet body');
  assert(Math.abs(front.scale.x - 0.9 / 1.6) < 1e-9, 'head counters body width');
  assert(Math.abs(back.scale.y - 0.9 / 1.3) < 1e-9, 'back head counters height');
  assert.equal(avatar.rigScale.head, 0.9);
  assert.equal(avatar.group.userData.portraitModelHeight,0.9,'scene hitbox metadata must not double-count the rig scale');
  assert.equal(avatar.poseModelHeight,0.9);
  assert.equal(avatar.poseRigScaleY,1.3);
  console.log('PASS maskbound guardians: sprites, manifest, wood palettes, troop scales, combat and rig geometry');
})().catch(error => { console.error(error); process.exitCode = 1; });

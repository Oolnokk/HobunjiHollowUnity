'use strict';
const assert = require('node:assert/strict'); // Executes the shared hostile wardrobe fallback and explicit equipment restrictions.
const fs = require('node:fs'); // Reads the production modules and species definitions.
const vm = require('node:vm'); // Runs browser modules against minimal host dependencies.
const read = file => fs.readFileSync(file, 'utf8'); // Shared source loader.
const window = { document: {} }; // Production garment and enemy APIs share one global object.
window.window = window;
const context = vm.createContext(window); // Real garment registry avoids duplicating selection logic in test stubs.
for (const file of ['docs/config/pants-rigs.js', 'docs/js/pants-rig-core.js', 'docs/js/pants-garment-renderer.js', 'docs/js/combat/combat-bandit.js']) vm.runInContext(read(file), context);
let roll = 0; // Exercises each of the two permitted hostile pants outcomes.
window.BanditCombat.init({ rnd: () => roll });
for (const speciesId of ['mao-ao', 'ghoul', 'mao-ao-skeleton', 'harlyao-skeleton', 'harlyao', 'tletingan']) {
  for (roll of [0, 0.99]) {
    const roster = { appearance: { speciesId, gender: 'female' }, equippedCosmetics: ['rugged_poncho'], appliedDyes: { CLOTH: 'dye:CLOTH:teal' } }; // Females also get pants rather than the town-NPC skirt fallback.
    const garment = window.BanditCombat.ensureEnemyPants(roster); // Production helper used before every hostile profile build.
    assert.equal(garment, roll === 0 ? 'pants_basic' : 'draped_pants');
    assert.equal(roster.cosmeticSlots[garment], 'pants');
    assert.equal(roster.appliedDyes.PANTS, 'dye:CLOTH:teal');
    assert.equal(window.BanditCombat.TINT_SLOT_BY_SLOT.pants, 'PANTS');
    assert.equal(window.BanditCombat.ensureEnemyPants(roster), garment);
    assert.equal(roster.equippedCosmetics.length, 2, 'rebuilding retains exactly one garment');
  }
}
for (const speciesId of ['omgurku', 'porakaneki']) {
  const roster = { appearance: { speciesId } }; // Exempt species retain their existing wardrobe.
  assert.equal(window.BanditCombat.ensureEnemyPants(roster), null);
  assert.equal(roster.equippedCosmetics, undefined);
}
const source = read('docs/js/combat/combat-bandit.js'); // Exercise the actual candidate filter with authored Omgurku restrictions.
const candidateStart = source.indexOf('  function _banditClothingCandidates('); // Isolate the dependency-free production selector.
const candidateEnd = source.indexOf('  function _banditRollDyeId(', candidateStart); // End of the selector.
vm.runInContext(source.slice(candidateStart, candidateEnd) + ';this.candidates = _banditClothingCandidates;', context);
const species = JSON.parse(read('docs/config/species/omgurku.json')); // Actual hood/hat bans, including all face masks in the hood slot.
assert.equal(Object.keys(context.candidates(species, 'male', 'hood', ['facewrap', 'festivalmask_gar-wolf'], ['facewrap'])).length, 0);

// Explicit saved equipment must obey the same restrictions as random generation.
const cosmetics = { optionCache: new Map([['facewrap', { id: 'facewrap', slot: 'hood' }], ['festivalmask_gar-wolf', { id: 'festivalmask_gar-wolf', slot: 'hood' }]]), exclusiveCosmeticsByFighter: { omgurku_m: species.male.exclusiveSlotCosmetics }, hatOptions: [], hoodOptions: [], torsoPortraitOptions: [], armPortraitOptions: [] }; // Includes bandit-exclusive and shop masks.
const previewWindow = {
  SCRATCHBONES_CONFIG: { game: { account: { shopCatalog: [] } } },
  loadPortraitCosmetics: async () => cosmetics,
  getPortraitFighters: () => [{ id: 'omgurku_m', speciesId: 'omgurku', gender: 'male' }],
  randomPortraitProfileSeeded: (_rng, fighters) => ({ fighter: fighters[0], bodyColors: {} }),
}; // Use the real NPC adapter instead of testing a copy of its hood selection.
vm.runInNewContext(read('docs/js/npc-avatar-preview-utils.js'), { window: previewWindow, document: { currentScript: null }, console, URL });
(async () => {
  await previewWindow.NpcAvatarPreview.ensurePortraitCosmetics();
  for (const id of ['facewrap', 'festivalmask_gar-wolf']) {
    const profile = previewWindow.NpcAvatarPreview.buildProfileFromNpcExport({ appearance: { speciesId: 'omgurku', gender: 'male' }, equippedCosmetics: [id] }); // Old explicit saves must not force masks back onto hybrids.
    assert.equal(profile.hood.id, 'none');
  }
  console.log('Enemy pants and Omgurku mask restrictions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

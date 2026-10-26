#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Validates ghoul-only wardrobe rules and both exported equipment dye channels.
const fs = require('node:fs'); // Reads actual game scripts and cosmetic manifests instead of reproducing wardrobe logic.
const vm = require('node:vm'); // Executes the production wardrobe functions with seeded gameplay RNG.
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Shared humanoid entity generation and wardrobe implementation.
const lootSource = fs.readFileSync('docs/js/bandit-camps.js', 'utf8'); // Corpse clothing converter must preserve the same two dyes.
const cosmeticsIndex = JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json', 'utf8')); // Confirms all outfit choices refer to real garments.
const fineBodyWrap = JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/overwear/fine_bodywrap.json', 'utf8')); // Validates the new two-color wrap and both fitted sprite variants.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Actual mine ghoul spawner starts with empty cosmetic arrays.
const maoao = JSON.parse(fs.readFileSync('docs/config/species/mao-ao.json', 'utf8')); // Ghoul's wardrobe parent, for both genders.
const dyeCatalog = fs.readFileSync('docs/config/colors/config.js', 'utf8'); // Contains actual Pale Blue and Silver catalog dyes.
const tintSlots = { torso: 'TORSO', overwear: 'CLOTH', hat: 'HAT', hood: 'HOOD', pants: 'PANTS' }; // Production dye channel mapping.

for (const id of ['tankan_bodywrap', 'fine_bodywrap', 'rugged_poncho', 'fine_poncho', 'fine_hood', 'pants_basic', 'draped_pants', 'bandolier1']) {
  assert(cosmeticsIndex.entries.some(item => item.id === id), `Ghoul garment ${id} must exist in the cosmetic index`);
}
for (const gender of ['male', 'female']) {
  for (const id of ['tankan_bodywrap', 'fine_bodywrap', 'rugged_poncho', 'fine_poncho', 'fine_hood', 'bandolier1']) {
    assert(maoao[gender].allowedCosmetics.includes(id), `${gender} Ghoul's parent must allow ${id}`);
  }
}
for (const gender of ['mao-ao_male', 'mao-ao_female']) {
  const layers = fineBodyWrap.speciesVariants?.[gender]?.parts?.torso?.layers; // Both genders use fitted A/B sprite layers instead of a missing-art duplicate.
  assert.equal(layers?.back?.layerRole, 'base');
  assert.equal(layers?.back_trim?.layerRole, 'trim');
  assert.deepEqual(layers?.back?.image?.colors, ['A']);
  assert.deepEqual(layers?.back_trim?.image?.colors, ['B']);
}
assert.equal(fineBodyWrap.palette?.layers?.base, 'A');
assert.equal(fineBodyWrap.palette?.layers?.trim, 'B');
assert.match(gameSource, /randomSeed: `mine-ghoul:[^\n]*[\s\S]*?equippedCosmetics: \[\]/, 'Mine spawns really start without clothing and depend on this new outfitter');
assert(dyeCatalog.includes('dye:CLOTH:pale_blue'), 'Pale Blue is an actual dye');
assert(dyeCatalog.includes('dye:CLOTH:silver'), 'Silver is an actual dye');
assert.match(banditSource, /if \(roster\?\.appearance\?\.speciesId === 'ghoul'\) styleGhoulRoster\(roster\)/,
  'Ghoul outfit transformation runs on the actual BanditCombat entity creation path');

const styleStart = banditSource.indexOf('  const GHOUL_OVERWEAR_POOL ='); // First line of the pure production ghoul outfit transform.
const styleEnd = banditSource.indexOf('  // Produces exactly the record shape', styleStart); // End of the extracted production wardrobe block.
assert(styleStart !== -1 && styleEnd > styleStart, 'Ghoul outfit generator remains separately testable');
let seed = 73218; // Fixed LCG seed makes distribution coverage repeatable in CI.
const rnd = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000; }; // Mirrors deterministic uniform samples without changing production RNG.
const wardrobeContext = { deps: { rnd }, BANDIT_TINT_SLOT_BY_SLOT: tintSlots }; // Dependencies read by the real styleGhoulRoster.
vm.runInNewContext(banditSource.slice(styleStart, styleEnd) + ';this.styleGhoulRoster = styleGhoulRoster;', wardrobeContext);
const pantsCounts = { pants_basic: 0, draped_pants: 0 }; // Track the only permitted mutually exclusive pants outcomes.
const wrapsCounts = { tankan_bodywrap: 0, fine_bodywrap: 0, rugged_poncho: 0, fine_poncho: 0 }; // Track all four upper-body choices, including the new Fine Body Wrap.
let fineHoods = 0; // Ensures hoods are actually added to the mix rather than listed but unreachable.
for (let n = 0; n < 1200; n++) {
  const roster = {
    appearance: { speciesId: 'ghoul', gender: n % 2 ? 'female' : 'male' },
    equippedCosmetics: ['bandolier1', 'layered_skirt', 'rugged_poncho', 'ragged_hood'],
    cosmeticSlots: { bandolier1: 'torso', layered_skirt: 'pants', rugged_poncho: 'overwear', ragged_hood: 'hood' },
    appliedDyes: { TORSO: 'dye:CLOTH:brown', PANTS: 'dye:CLOTH:brown' },
  }; // Simulates a mine ghoul with old pieces, so the new single-item choices must replace stale garments.
  wardrobeContext.styleGhoulRoster(roster);
  assert(roster.equippedCosmetics.includes('bandolier1'), 'Bandoliers must survive wardrobe rolls');
  assert(!roster.equippedCosmetics.includes('layered_skirt'), 'Old skirt must be replaced');
  assert(roster.equippedCosmetics.length === new Set(roster.equippedCosmetics).size, 'No duplicate equipment');
  const pants = roster.equippedCosmetics.filter(id => id in pantsCounts); // Exactly one choice, including females.
  const wraps = roster.equippedCosmetics.filter(id => id in wrapsCounts); // Exactly one overwear item.
  assert.equal(pants.length, 1);
  assert.equal(wraps.length, 1);
  pantsCounts[pants[0]]++;
  wrapsCounts[wraps[0]]++;
  if (roster.equippedCosmetics.includes('fine_hood')) fineHoods++;
  for (const slot of Object.values(tintSlots)) {
    assert.equal(roster.appliedDyes[slot], 'dye:CLOTH:pale_blue', `${slot} primary dye`);
    assert.equal(roster.appliedDyes[`${slot}_B`], 'dye:CLOTH:silver', `${slot} secondary dye`);
  }
  for (const cosmeticId of roster.equippedCosmetics) assert(roster.cosmeticSlots[cosmeticId], `${cosmeticId} needs a loot slot`);
}
assert(Math.abs(pantsCounts.pants_basic - pantsCounts.draped_pants) < 150, '1,200 spawns should demonstrate the equal 50/50 pants split');
for (const count of Object.values(wrapsCounts)) assert(count > 230 && count < 370, 'All four upper silhouettes remain similarly represented');
assert(fineHoods > 450 && fineHoods < 750, 'Fine hoods join the existing hood pool roughly half the time');

// Crucial regression: actual mine ghouls have ZERO pre-equipped garments; preserved bandoliers alone never produced a single bandolier.
let blankBandoliers = 0; // Count true 50% bandolier rolls on empty mine-style rosters.
let blankFineHoods = 0; // Check the new fine hoods also appear on fresh, initially bare enemies.
for (let n = 0; n < 1200; n++) {
  const roster = { name: 'Ghoul', appearance: { speciesId: 'ghoul', gender: n % 2 ? 'female' : 'male', cosmetics: {} },
    equippedCosmetics: [], appliedDyes: {} }; // Exact equipment shape passed through game.js's mine-spawn rosterOverride.
  wardrobeContext.styleGhoulRoster(roster);
  assert.equal(roster.equippedCosmetics.filter(id => id in pantsCounts).length, 1, 'Bare mine ghoul gets exactly one pair of pants');
  assert.equal(roster.equippedCosmetics.filter(id => id in wrapsCounts).length, 1, 'Bare mine ghoul gets an authored overwear item');
  if (roster.equippedCosmetics.includes('bandolier1')) {
    blankBandoliers++;
    assert.equal(roster.cosmeticSlots.bandolier1, 'torso');
    assert.equal(roster.appliedDyes.TORSO, 'dye:CLOTH:pale_blue');
    assert.equal(roster.appliedDyes.TORSO_B, 'dye:CLOTH:silver');
  }
  if (roster.equippedCosmetics.includes('fine_hood')) blankFineHoods++;
}
assert(blankBandoliers > 450 && blankBandoliers < 750, 'Fresh mine ghouls must actually receive bandoliers at about 50%');
assert(blankFineHoods > 450 && blankFineHoods < 750, 'Fresh mine ghouls must receive fine hoods at about 50%');

const bandit = { appearance: { speciesId: 'mao-ao' }, equippedCosmetics: ['bandolier1'], appliedDyes: { TORSO: 'dye:CLOTH:brown' } }; // Control: ordinary enemies keep their existing styling.
assert.equal(wardrobeContext.styleGhoulRoster(bandit), bandit);
assert.equal(bandit.appliedDyes.TORSO, 'dye:CLOTH:brown');
assert.deepEqual(bandit.equippedCosmetics, ['bandolier1']);

const lootStart = lootSource.indexOf('  function banditWornClothingItems('); // The real corpse conversion function under test.
const lootEnd = lootSource.indexOf('  function makeBanditCorpseWorldObject(', lootStart); // Extracts only the relevant converter.
assert(lootStart !== -1 && lootEnd > lootStart);
const catalog = [{ id: 'dye:CLOTH:pale_blue', label: 'Pale Blue', hex: '#cddff0' }, { id: 'dye:CLOTH:silver', label: 'Silver', hex: '#cccccc' }]; // Test catalog lookup for both channels.
const lootContext = {
  deps: {
    getDyeCatalog: () => catalog,
    rnd: () => 0.4,
    dyeToClothingColor: dye => dye ? { hex: dye.hex } : null,
    clothingSpriteForCosmetic: id => id,
  },
  window: { BanditCombat: { TINT_SLOT_BY_SLOT: tintSlots }, MetalArmorSystem: {} },
  _banditClothingPiece: (id, category) => ({ id, category, label: id, price: 1 }),
}; // Minimal existing loot boundary; tests serialization without a game canvas.
vm.runInNewContext(lootSource.slice(lootStart, lootEnd) + ';this.convertLoot = banditWornClothingItems;', lootContext);
const corpseItems = lootContext.convertLoot({
  equippedCosmetics: ['bandolier1', 'fine_hood', 'fine_bodywrap', 'draped_pants'],
  cosmeticSlots: { bandolier1: 'torso', fine_hood: 'hood', fine_bodywrap: 'overwear', draped_pants: 'pants' },
  appliedDyes: {
    TORSO: 'dye:CLOTH:pale_blue', TORSO_B: 'dye:CLOTH:silver',
    HOOD: 'dye:CLOTH:pale_blue', HOOD_B: 'dye:CLOTH:silver',
    CLOTH: 'dye:CLOTH:pale_blue', CLOTH_B: 'dye:CLOTH:silver',
    PANTS: 'dye:CLOTH:pale_blue', PANTS_B: 'dye:CLOTH:silver',
  },
}); // Models the actual inventory result after looting all dyeable ghoul parts.
for (const item of corpseItems) {
  assert.equal(item.colorA.hex, '#cddff0', `${item.cosmeticId} loot keeps Pale Blue`);
  assert.equal(item.colorB.hex, '#cccccc', `${item.cosmeticId} loot keeps Silver`);
}
console.log('Ghoul wardrobe and corpse-dye regression checks passed');

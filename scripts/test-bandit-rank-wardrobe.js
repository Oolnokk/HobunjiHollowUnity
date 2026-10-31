// Executes bandit rank clothing: grunts and lieutenants wear no patterns (lieutenants a pauldron, never a circlet); captains a pauldron, a circlet and
// patterned overwear, pants and hood base; flaskers patterned clothes and a face mask sharing the overwear's pattern, but no metal. Rank metal matches
// the weapon metal at the temper its mastery implies.
// Run with: node scripts/test-bandit-rank-wardrobe.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const DYES = [['dusty_red', '#8c4d38'], ['dusty_blue', '#6d628c'], ['muted_green', '#3e5924'], ['pure_orange', '#ff8000']].map(([id, hex]) => ({ id: 'dye:CLOTH:' + id, hex }));
const window = {
  SCRATCHBONES_CONFIG: { game: { dyes: { catalog: DYES } } },
  MetalArmorSystem: {
    TEMPER_XP_THRESHOLDS: [40, 90, 150, 220, 300],
    makeCraftedItem: (id, metalKey) => ({ baseCosmeticId: id, cosmeticId: id + '#smith:x', metalKey, temperXp: 0 }),
    spriteForBlueprintAppearance: (id) => 'sprite:' + id,
  },
  RepoPatternLibrary: { getCachedById: () => null },
  EnchantmentSystem: { DEFINITIONS: {} }, WeaponEnchantmentVFX: { ALIGNMENTS: {} },
};
const context = vm.createContext({ window, fetch: async () => ({ ok: false }), performance, Math, JSON, Object });
vm.runInContext(fs.readFileSync('docs/js/combat/ghoul-special-variants.js', 'utf8'), context); // The shared Harlyao pattern kit.
vm.runInContext(fs.readFileSync('docs/js/combat/bandit-rank-wardrobe.js', 'utf8'), context);
const wardrobe = window.BanditRankWardrobe;

// Temper follows mastery level.
assert.deepEqual([0, 1, 2, 3, 4, 5].map(wardrobe.temperXpForMastery), [0, 40, 90, 150, 220, 300], 'mastery level -> temper (verdigris) exactly like weapon mastery pacing');
assert.equal(wardrobe.temperXpForMastery(99), 300);
assert.equal(wardrobe.temperXpForMastery(-2), 0);

const roster = (extra = {}) => ({ appearance: { speciesId: 'mao-ao', gender: 'male' }, equippedCosmetics: ['tankan_bodywrap', 'appearance::hat::basic_headband', 'fine_hood'], cosmeticSlots: { tankan_bodywrap: 'overwear', 'appearance::hat::basic_headband': 'hat', fine_hood: 'hood' }, appliedDyes: {}, ...extra });
const dyePool = (rnd) => () => DYES[Math.floor(rnd() * DYES.length)].id;
const run = (rank, seed, extra = {}, mastery = 3, metalKey = 'tinBronze') => { const rnd = seeded(seed); return wardrobe.style(roster(extra), { rank, rnd, rollDyeId: dyePool(rnd), metalKey, mastery }); };
const colors = new Set(), frames = new Set();

for (let seed = 1; seed <= 40; seed++) {
  // Grunts: nothing at all.
  const grunt = run('grunt', seed);
  assert.equal(grunt.clothingPatterns, undefined, 'grunts wear no patterns');
  assert.equal((grunt.metalArmorItems || []).length, 0);
  // Lieutenants: a pauldron, never a circlet (even if rolled), and no patterns.
  const lieutenant = run('lieutenant', seed, { equippedCosmetics: ['tangedcirclet', 'fine_hood'], cosmeticSlots: { tangedcirclet: 'hat', fine_hood: 'hood' }, metalArmorItems: [{ baseCosmeticId: 'tangedcirclet' }] });
  assert.deepEqual([...lieutenant.metalArmorItems.map(item => item.baseCosmeticId)], ['rounded_pauldron'], 'lieutenants wear exactly a pauldron');
  assert.ok(lieutenant.equippedCosmetics.includes('rounded_pauldron') && lieutenant.cosmeticSlots.rounded_pauldron === 'pauldron');
  assert.ok(!lieutenant.equippedCosmetics.some(id => /circlet/i.test(id)), 'never a circlet');
  assert.equal(lieutenant.clothingPatterns, undefined, 'lieutenants wear no patterns');
  // Flaskers: patterned clothes, no metal, a face mask that shares the overwear's exact pattern + framing.
  const flasker = run('flasker', seed, { equippedCosmetics: ['tankan_bodywrap', 'facewrap'], cosmeticSlots: { tankan_bodywrap: 'overwear', facewrap: 'hood' } });
  assert.equal((flasker.metalArmorItems || []).length, 0, 'flaskers wear no metal armor');
  assert.ok(!flasker.equippedCosmetics.some(id => /pauldron|circlet/.test(id)));
  const fForced = flasker.clothingPatterns.forcedOverpassBySlot;
  assert.deepEqual([...Object.keys(fForced)].sort(), ['hood', 'overwear', 'pants'], 'flasker pants, overwear and face mask are patterned');
  assert.deepEqual(JSON.parse(JSON.stringify(fForced.hood.pattern)), JSON.parse(JSON.stringify(fForced.overwear.pattern)), 'the face mask shares the overwear’s pattern and framing');
  assert.equal(fForced.hood.fallbackColorC.hex, fForced.overwear.fallbackColorC.hex, '...and its color');
  assert.deepEqual([...fForced.hood.roles], ['base'], 'the mask is patterned on its base sprite');
  const noOverwear = run('flasker', seed, { equippedCosmetics: ['facewrap'], cosmeticSlots: { facewrap: 'hood' } }).clothingPatterns.forcedOverpassBySlot;
  assert.deepEqual([...Object.keys(noOverwear)].sort(), ['hood', 'pants'], 'without overwear the face mask gets its own pattern');
  const poncho = run('flasker', seed, { equippedCosmetics: ['rugged_poncho', 'facewrap'], cosmeticSlots: { rugged_poncho: 'overwear', facewrap: 'hood' } }).clothingPatterns.forcedOverpassBySlot;
  assert.deepEqual([...poncho.overwear.roles], ['wrap'], 'a rugged poncho is patterned on its shoulder sprite');
  assert.deepEqual(JSON.parse(JSON.stringify(poncho.hood.pattern)), JSON.parse(JSON.stringify(poncho.overwear.pattern)), 'and the face mask shares that pattern too');
  // Captains: pauldron + circlet + patterned overwear, pants and hood base.
  const captain = run('captain', seed);
  assert.deepEqual([...captain.metalArmorItems.map(item => item.baseCosmeticId)].sort(), ['rounded_pauldron', 'tangedcirclet']);
  assert.equal(captain.cosmeticSlots.tangedcirclet, 'hat');
  assert.ok(!captain.equippedCosmetics.includes('appearance::hat::basic_headband') && captain.cosmeticSlots['appearance::hat::basic_headband'] === undefined, 'the circlet replaces the rolled hat');
  assert.ok(captain.equippedCosmetics.includes('fine_hood'), 'but not the hood');
  const forced = captain.clothingPatterns.forcedOverpassBySlot;
  assert.deepEqual([...Object.keys(forced)].sort(), ['hood', 'overwear', 'pants'], 'captains pattern their overwear, pants and hood');
  assert.deepEqual([...forced.hood.roles], ['base'], 'a captain’s hood is patterned on its base sprite');
  assert.deepEqual([forced.pants.scale, forced.overwear.scale, forced.hood.scale], [4, 1.05, 1.05]);
  const hoodless = run('captain', seed, { equippedCosmetics: ['tankan_bodywrap'], cosmeticSlots: { tankan_bodywrap: 'overwear' } }).clothingPatterns.forcedOverpassBySlot;
  assert.equal(hoodless.hood, undefined, 'no hood, nothing to pattern');
  for (const entry of [...Object.values(forced), ...Object.values(fForced)]) {
    assert.ok(window.GhoulSpecialVariants.GLYPHS.includes(entry.pattern.repoPatternId), 'a Harlyao pattern');
    assert.equal(entry.pattern.frameShape, 'triangle', 'the frame takes effect');
    assert.ok(DYES.some(dye => dye.hex === entry.fallbackColorC.hex), 'a color from the bandit clothing dye pool');
    colors.add(entry.fallbackColorC.hex);
    frames.add(entry.pattern.frameScale + '/' + entry.pattern.frameRotationDeg);
  }
  // Rank metal matches the weapon metal at mastery-driven temper.
  for (const item of [...lieutenant.metalArmorItems, ...captain.metalArmorItems]) { assert.equal(item.metalKey, 'tinBronze', 'armor is the weapon metal'); assert.equal(item.temperXp, 150, 'mastery 3 -> temper 3'); }
}
assert.ok(colors.size >= 3 && frames.size > 60, 'colors and frames vary between bandits');

// A captain without overwear gets nothing to pattern here (the roster roll force-fills overwear); the pants are still patterned.
const bare = run('captain', 5, { equippedCosmetics: ['fine_hood'], cosmeticSlots: { fine_hood: 'hood' } });
assert.deepEqual([...Object.keys(bare.clothingPatterns.forcedOverpassBySlot)].sort(), ['hood', 'pants'], 'a captain with only a hood patterns the hood and pants');
const naked = run('captain', 5, { equippedCosmetics: [], cosmeticSlots: {} });
assert.deepEqual([...Object.keys(naked.clothingPatterns.forcedOverpassBySlot)], ['pants'], 'a captain with no overwear or hood still has patterned pants');
// Mastery changes temper; no metal key means no rank metal; other ranks/unknown are untouched.
assert.equal(run('captain', 7, {}, 0).metalArmorItems[0].temperXp, 0, 'mastery 0 -> clean metal');
assert.equal(run('captain', 7, {}, 5).metalArmorItems[0].temperXp, 300, 'mastery 5 -> fully oxidized');
assert.equal((run('captain', 7, {}, 5, null).metalArmorItems || []).length, 0, 'no weapon metal known, no rank metal');
const untouched = roster();
assert.equal(wardrobe.style(untouched, { rank: 'porakaneki' }), untouched);
assert.equal(untouched.clothingPatterns, undefined);

// Ghoul knights follow the same mastery rule.
(async () => {
  window.EnchantmentSystem.DEFINITIONS = {};
  for (const mastery of [0, 2, 5]) {
    const knight = await window.GhoulSpecialVariants.style({ appearance: { speciesId: 'ghoul', gender: 'male' }, equippedCosmetics: [], cosmeticSlots: {}, appliedDyes: {} }, { rnd: seeded(9), tier: 3, shadowknight: true, mastery });
    for (const item of knight.metalArmorItems) assert.equal(item.temperXp, [0, 90, 300][[0, 2, 5].indexOf(mastery)], 'knight armor temper follows mastery ' + mastery);
  }
  // Wiring
  const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
  assert.match(bandit, /function rollBanditWeaponMetalKey\(cfg, rank, tier\)/, 'the weapon material roll is shared');
  assert.match(bandit, /if \(wearsRankMetal && !configuredWeaponMetalKey\(cfg\)\) cfg = \{ \.\.\.cfg, weaponMetalKey: rollBanditWeaponMetalKey\(cfg, rank, tier\) \}/, 'the weapon metal is fixed before the armor is baked');
  assert.match(bandit, /window\.BanditRankWardrobe\?\.style\?\.\(roster, \{ rank, rnd: deps\.rnd, rollDyeId: \(\) => _banditRollDyeId\(cfg\)/, 'the bandit roster is dressed for its rank with the ordinary clothing dye pool');
  assert.match(bandit, /rank === 'captain' && !Object\.values\(cosmeticSlots\)\.includes\('overwear'\)\) fillSlot\('overwear'\)/, 'captains always have overwear');
  assert.match(fs.readFileSync('docs/index.html', 'utf8'), /js\/combat\/bandit-rank-wardrobe\.js\?v=/);
  assert.match(fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8'), /js\/combat\/bandit-rank-wardrobe\.js\?v=/);
  console.log('Bandit rank wardrobe: pauldrons, circlets, patterned pants/overwear and mastery-matched metal verified');
})().catch(error => { console.error(error); process.exit(1); });

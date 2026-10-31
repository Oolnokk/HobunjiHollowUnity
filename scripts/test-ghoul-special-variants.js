// Executes the mine ghoul variants: wardrobe, tier metals, random-framed Harlyao patterns, pattern colors, enchanted weapons and their loot.
// Run with: node scripts/test-ghoul-special-variants.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = open + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start, end);
}
const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }; // mulberry32

const mineConfig = JSON.parse(fs.readFileSync('docs/config/town-mine.json', 'utf8'));
const dyes = [['shadow_blue', '#000059'], ['shadow_blue_indigo', '#160059'], ['dark_muted_blue_indigo', '#2b2f5c'], ['shadow_indigo', '#20003a'], ['bright_blue', '#3366ff'], ['pure_blue', '#0000ff'], ['bright_green_blue', '#00ccaa'], ['deep_blue', '#102080']].map(([id, hex]) => ({ id: 'dye:CLOTH:' + id, hex }));
const definitions = {
  burning: { id: 'burning', type: 'Base', alignment: 'Hronal' }, frostbitten: { id: 'frostbitten', type: 'Base', alignment: 'Tothal' },
  sicced: { id: 'sicced', type: 'Flourish', alignment: 'Tothal' }, fury: { id: 'fury', type: 'Flourish', alignment: 'Hronal' },
};
const alignments = { Tothal: { dyeIds: ['dye:CLOTH:a', 'dye:CLOTH:b'], effects: [{ id: 'wind-streak' }, { id: 'sleet-needle' }] }, Hronal: { dyeIds: ['dye:CLOTH:c'], effects: [{ id: 'ember-fall' }] } };
const window = {
  SCRATCHBONES_CONFIG: { game: { dyes: { catalog: dyes } } },
  EnchantmentSystem: { DEFINITIONS: definitions, PLANES: ['Tothal', 'Hronal', 'Kanthic', 'Ohthic'] },
  WeaponEnchantmentVFX: { ALIGNMENTS: alignments },
  MetalArmorSystem: { makeCraftedItem: (id, metalKey) => ({ cosmeticId: id, metalKey, slot: id === 'tangedcirclet' ? 'hat' : 'pauldron' }), spriteForBlueprintAppearance: (id) => 'sprite:' + id },
  RepoPatternLibrary: { getCachedById: () => null },
};
const context = vm.createContext({ window, fetch: async () => ({ ok: true, json: async () => mineConfig }), performance, Math, JSON, Object });
vm.runInContext(fs.readFileSync('docs/js/combat/ghoul-special-variants.js', 'utf8'), context);
const variants = window.GhoulSpecialVariants;

// Tier metals come from the mine's own table.
assert.deepEqual(['nativeCopper', 'lowTinBronze', 'tinBronze', 'highTinBronze', 'arsenicalBronze', 'leadedBronze', 'arsenicalBronze', 'silver', 'silver'].map((metal, index) => variants.tierMetal(mineConfig.ladderMetalKeys, index + 1) === metal), new Array(9).fill(true));
assert.equal(variants.tierMetal(mineConfig.ladderMetalKeys, 99), 'silver', 'deeper than the table clamps to its last metal');
assert.equal(variants.tierMetal([], 3), 'nativeCopper');

const baseRoster = (gender = 'female') => ({ appearance: { speciesId: 'ghoul', gender }, equippedCosmetics: ['bandolier1', 'fine_bodywrap', 'draped_pants', 'appearance::hat::basic_headband'], cosmeticSlots: { bandolier1: 'torso', fine_bodywrap: 'overwear', draped_pants: 'pants' }, appliedDyes: { CLOTH: 'dye:CLOTH:pale_blue', CLOTH_B: 'dye:CLOTH:silver' } });

(async () => {
  // ── Witches ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const witchColors = { 'shadow-wind': new Set(), 'rend-water': new Set() }, witchRolls = new Set();
  for (const type of ['shadow-wind', 'rend-water']) for (let seed = 1; seed <= 24; seed++) {
    const roster = await variants.style(baseRoster(), { rnd: seeded(seed * 13), tier: 5, witchType: type });
    const cos = [...roster.equippedCosmetics];
    assert.ok(cos.includes('fine_hood') && roster.cosmeticSlots.fine_hood === 'hood', 'witches wear fine hoods');
    assert.ok(cos.includes('layered_skirt') && roster.cosmeticSlots.layered_skirt === 'pants', 'witches wear skirts');
    assert.ok(!cos.includes('draped_pants') && !cos.includes('appearance::hat::basic_headband'), 'the rolled pants and headband are replaced');
    assert.ok(cos.includes('fine_bodywrap') && cos.includes('bandolier1'), 'other rolled clothing survives');
    const [circlet] = roster.metalArmorItems;
    assert.equal(roster.metalArmorItems.length, 1);
    assert.deepEqual([circlet.cosmeticId, circlet.metalKey, circlet.smithTreatment.metalKey], ['tangedcirclet', 'silver', 'silver'], 'silver circlets');
    assert.equal(roster.cosmeticSlots.tangedcirclet, 'hat');
    assert.equal(roster.appliedDyes.CLOTH, 'dye:CLOTH:pale_blue', 'main clothing colors stay the ordinary ghoul’s');
    assert.equal(roster.enchantedWeapon, undefined, 'witches carry no enchanted weapon');
    const forced = roster.clothingPatterns.forcedOverpassBySlot;
    assert.deepEqual([...Object.keys(forced)].sort(), ['hood', 'overwear', 'pants']);
    for (const [slot, entry] of Object.entries(forced)) {
      assert.ok(window.GhoulSpecialVariants.GLYPHS.includes(entry.pattern.repoPatternId), 'a Harlyao pattern');
      assert.equal(entry.pattern.frameShape, 'triangle', 'the frame is honored by the weaver');
      assert.ok(entry.pattern.frameScale > 0 && entry.pattern.frameScale <= 1);
      assert.ok(entry.pattern.frameRotationDeg >= 0 && entry.pattern.frameRotationDeg < 360);
      witchRolls.add(slot + entry.pattern.frameScale + '/' + entry.pattern.frameRotationDeg);
    }
    assert.equal(circlet.smithTreatment.paintHex, forced.hood.fallbackColorC.hex, 'the metal is painted in the same magic color');
    assert.deepEqual([forced.pants.scale, forced.overwear.scale, forced.hood.scale], [4, 1.05, 1.05]);
    assert.ok(window.GhoulSpecialVariants.WITCH_MAGIC_DYES[type].includes(roster.ghoulVariant.patternDyeId), type + ' colors come from the dyes closest to its magic');
    witchColors[type].add(roster.ghoulVariant.patternDyeId);
  }
  assert.ok(witchRolls.size > 40, 'frames vary between witches');
  for (const type of Object.keys(witchColors)) assert.ok(witchColors[type].size >= 2, type + ' witches vary in color');
  assert.equal([...witchColors['shadow-wind']].some(id => witchColors['rend-water'].has(id)), false, 'the two magics use different colors');

  // ── Knights ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const enchantSets = new Set();
  let withSecond = 0, runs = 60;
  for (let seed = 1; seed <= runs; seed++) {
    const tier = 1 + (seed % 9);
    const roster = await variants.style(baseRoster('male'), { rnd: seeded(seed * 29), tier, shadowknight: true });
    const cos = [...roster.equippedCosmetics];
    assert.ok(cos.includes('fine_hood') && roster.cosmeticSlots.fine_hood === 'hood', 'knights wear fine hoods');
    assert.ok(cos.includes('rough_cloth_poncho') && roster.cosmeticSlots.rough_cloth_poncho === 'overwear', 'knights wear rough ponchos');
    assert.ok(!cos.includes('fine_bodywrap'), 'the rolled overwear is replaced');
    assert.ok(cos.includes('draped_pants'), 'the rolled pants are kept');
    const expectedMetal = mineConfig.ladderMetalKeys[Math.min(tier, mineConfig.ladderMetalKeys.length) - 1];
    assert.deepEqual([...roster.metalArmorItems.map(item => item.cosmeticId)].sort(), ['rounded_pauldron', 'tangedcirclet'], 'a circlet and a pauldron');
    for (const item of roster.metalArmorItems) {
      assert.equal(item.metalKey, expectedMetal, 'tier ' + tier + ' metal');
      assert.equal(item.smithTreatment.paintHex, '#000059', 'painted shadow-blue');
      assert.equal(item.smithTreatment.pattern.frameShape, 'triangle');
    }
    assert.deepEqual([roster.cosmeticSlots.tangedcirclet, roster.cosmeticSlots.rounded_pauldron], ['hat', 'pauldron']);
    const forced = roster.clothingPatterns.forcedOverpassBySlot;
    assert.deepEqual([...Object.keys(forced)].sort(), ['hood', 'overwear', 'pants'], 'knights pattern their hood, poncho and pants');
    assert.equal(forced.pants.scale, 4);
    for (const entry of Object.values(forced)) assert.equal(entry.fallbackColorC.hex, '#000059', 'knight patterns are shadow-blue');
    assert.equal(roster.appliedDyes.CLOTH_B, 'dye:CLOTH:silver', 'main clothing colors stay the ordinary ghoul’s');
    // Enchanted weapon
    const enchanted = roster.enchantedWeapon;
    assert.equal(enchanted.enchantments.base.length, 1, 'one Base enchantment');
    const flourishes = Object.keys(enchanted.enchantments.flourishes);
    assert.ok(flourishes.length <= 1 && flourishes.every(slot => ['tap1', 'tap2', 'hold1', 'hold2'].includes(slot)));
    if (flourishes.length) withSecond++;
    assert.ok(enchanted.visual && alignments[enchanted.visual.alignment] && alignments[enchanted.visual.colorAlignment], 'a particle alignment');
    assert.ok(alignments[enchanted.visual.colorAlignment].dyeIds.includes(enchanted.visual.dyeId), 'a color from that alignment');
    assert.ok(alignments[enchanted.visual.alignment].effects.some(effect => effect.id === enchanted.visual.effectId), 'an effect from that alignment');
    assert.ok(Object.values(enchanted.counts).reduce((a, b) => a + b, 0) === 1 + flourishes.length);
    enchantSets.add(JSON.stringify([enchanted.enchantments, enchanted.visual]));
  }
  assert.ok(withSecond / runs > 0.7 && withSecond < runs, '"usually" a second enchantment of another type: ' + withSecond + '/' + runs);
  assert.ok(enchantSets.size > 20, 'weapons vary between knights');
  const plain = { appearance: { speciesId: 'ghoul' } };
  assert.equal(await variants.style(plain, {}), plain, 'a plain ghoul is untouched');
  assert.equal(plain.clothingPatterns, undefined);

  // ── Loot: the weapon comes off the body as a bound relic carrying its enchantments and particle choice ────────────────────────────────
  const granted = [];
  window.HarlyaoRelics = { SHAPES: { longsword: { label: 'Harlyao Longsword' } }, makeRelic: (shape) => ({ shape, uid: 'abc123', enchantments: { base: [], flourishes: {} } }), grantBoundRelic: (relic) => { granted.push(relic); return 'harlyaoBound_key'; } };
  const knight = { rosterRecord: { enchantedWeapon: { enchantments: { base: ['burning'], flourishes: { tap1: 'sicced' } }, visual: { alignment: 'Tothal', colorAlignment: 'Hronal', dyeId: 'dye:CLOTH:c', effectId: 'wind-streak' } } } };
  const loot = variants.lootEnchantedWeapon(knight);
  assert.deepEqual({ ...loot }, { key: 'harlyaoBound_key', label: 'Harlyao Longsword' });
  assert.deepEqual(JSON.parse(JSON.stringify(granted[0].enchantments)), { base: ['burning'], flourishes: { tap1: 'sicced' } }, 'the loot carries exactly the knight’s enchantments');
  assert.equal(granted[0].visual.dyeId, 'dye:CLOTH:c', 'and its particle color/effect');
  assert.equal(variants.lootEnchantedWeapon({ rosterRecord: {} }), null, 'an unenchanted ghoul drops no relic');

  // ── Relic key codec keeps the particle choice through unbinding ────────────────────────────────────────────────────────────────────────
  const relics = fs.readFileSync('docs/js/harlyao-relics.js', 'utf8');
  const codec = vm.createContext({ window, BOUND_PREFIX: 'harlyaoBound_', SHAPES: { longsword: {}, warhammer: {}, broadsword: {} }, ES: () => window.EnchantmentSystem, Object, Number, String });
  vm.runInContext(['visualVocabulary', 'encodeVisual', 'decodeVisual', 'encodeBoundKey', 'decodeBoundKey'].map(name => extract(relics, name)).join('\n') + '\nthis.enc = encodeBoundKey; this.dec = decodeBoundKey;', codec);
  const relic = { shape: 'longsword', uid: 'abc123', enchantments: { base: ['burning'], flourishes: { tap1: 'sicced' } }, visual: { alignment: 'Tothal', colorAlignment: 'Hronal', dyeId: 'dye:CLOTH:c', effectId: 'wind-streak' } };
  const key = codec.enc(relic);
  assert.match(key, /^harlyaoBound_longsword_abc123_Bburning_Ftap1\.sicced_V0\.1\.0\.0$/, 'the visual is a compact suffix on the existing key');
  const decoded = codec.dec(key);
  assert.deepEqual(JSON.parse(JSON.stringify(decoded.visual)), relic.visual, 'decoding restores the exact color and effect');
  assert.deepEqual(JSON.parse(JSON.stringify(decoded.enchantments)), relic.enchantments);
  const legacy = codec.dec('harlyaoBound_longsword_abc123_Bburning_Ftap1.sicced');
  assert.equal(legacy.visual, undefined, 'old keys without a visual still decode');
  assert.equal(codec.enc({ ...relic, visual: undefined }), 'harlyaoBound_longsword_abc123_Bburning_Ftap1.sicced', 'relics without a visual encode exactly as before');
  assert.match(relics, /g\.weaponEnchantmentVisuals\[toolKey\] = \{ \.\.\.relic\.visual \}/, 'unbinding hands the visual to the weapon');

  // ── Unarmed shadow-wind witches (rend-water witches and knights keep weapons) ────────────────────────────────────────────────────────
  assert.equal(variants.isUnarmedWitch({ mineWyrmWitchType: 'shadow-wind' }), true, 'shadow-wind witches cast bare-handed');
  assert.equal(variants.isUnarmedWitch({ mineWyrmWitchType: 'rend-water' }), false, 'rend-water witches carry weapons');
  assert.equal(variants.isUnarmedWitch({ isGhoulShadowknight: true }), false);
  assert.equal(variants.isUnarmedWitch(undefined), false);
  assert.equal(variants.castWeaponKey(), 'pickshovel_nativeCopper', 'the lich casting pose weapon by default');
  window.HarlyaoLichCombat = { LICH_CAST_WEAPON_KEY: 'castkey', prepareEmptyCastWeapon: (entity) => { entity.emptied = true; } };
  assert.equal(variants.castWeaponKey(), 'castkey', 'the liches’ own key is the authority');
  const witch = {};
  assert.equal(variants.unarm(witch), witch);
  assert.deepEqual({ ...witch }, { emptied: true, isUnarmedCaster: true }, 'unarming reuses the lich empty-hand socket');
  assert.equal(variants.unarm(null), null);
  const lichSource = fs.readFileSync('docs/js/combat/combat-lich.js', 'utf8');
  assert.match(lichSource, /prepareEmptyCastWeapon, LICH_CAST_WEAPON_KEY,/, 'the lich module shares its empty-hand casting weapon');
  const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
  assert.match(banditSource, /unarmedWitch \? \{ weaponKey: window\.GhoulSpecialVariants\.castWeaponKey\(\), rangedWeaponKey: null \} : \{\}/, 'the witch’s weapon is the casting pose weapon');
  assert.match(banditSource, /if \(unarmedWitch\) window\.GhoulSpecialVariants\.unarm\(c\)/, 'its visible weapon is removed after the entity exists');

  // ── Wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
  assert.match(bandit, /await window\.GhoulSpecialVariants\?\.style\?\.\(roster, \{ rnd: deps\.rnd, tier,/, 'the roster builder dresses the variants');
  assert.match(bandit, /window\.GhoulSpecialVariants\?\.tick\?\.\(c, deps\?\.TOOL_ITEM_DEFS\)/, 'knights’ weapon particles run every frame');
  assert.match(fs.readFileSync('docs/js/bandit-camps.js', 'utf8'), /window\.GhoulSpecialVariants\?\.lootEnchantedWeapon\?\.\(c\)/, 'the corpse hands over the weapon');
  assert.match(fs.readFileSync('docs/index.html', 'utf8'), /js\/combat\/ghoul-special-variants\.js\?v=/, 'the game loads the module');
  assert.match(fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8'), /js\/combat\/ghoul-special-variants\.js\?v=/, 'the Workshop loads the module');
  assert.match(fs.readFileSync('docs/js/combat/weapon-enchantment-vfx.js', 'utf8'), /function createFixedEmitter\(plane, config\)/, 'enemy weapons use the shared particle emitter');
  console.log('Ghoul variants: wardrobe, tier metals, patterns, colors, enchanted weapons, loot and relic codec verified');
})().catch(error => { console.error(error); process.exit(1); });

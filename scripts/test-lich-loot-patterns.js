// Executes: per-spawn random pattern frames, ordinary liches' tradition patterns (same glyph, same-family colors), lootable woven pieces
// that keep the exact random pattern, and the Cursed state (circlets: Garanki; masks: Hunundi, later).
// Run with: node scripts/test-lich-loot-patterns.js
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
const seeded = (seed) => { let n = seed >>> 0; return () => { n = (Math.imul(n ^ (n >>> 15), 1 | n) + 0x6d2b79f5) >>> 0; return (n >>> 0) / 4294967296; }; };
const hue = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, max = Math.max(r, g, b), d = max - Math.min(r, g, b); const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const hueGap = (a, b) => Math.abs(((hue(a) - hue(b) + 540) % 360) - 180);

// ── Rules: random frame ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const window = { PatternLibrary: { getById: () => null } };
vm.runInNewContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), {
  window, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
const rules = window.EnemyLoadoutRules;
const set = (randomFrame) => rules.set({ schema: rules.schema, rules: { ghoul: { clothingPatterns: { overwear: { pattern: { frameScale: 1, frameRotationDeg: 10 }, randomFrame } } } } });
assert.throws(() => set({ rotate: 'yes' }), /rotate must be true\/false/);
assert.throws(() => set({ shrink: { min: 0.01, max: 1 } }), /shrink needs/);
assert.throws(() => set({ shrink: { min: 0.8, max: 0.4 } }), /shrink needs/);
assert.throws(() => set({ spin: true }), /spin is unknown/);
set({ rotate: true, shrink: { min: 0.25, max: 0.75 } });
const frames = new Set();
for (let seed = 1; seed <= 20; seed++) {
  const pattern = rules.applyRoster('ghoul', { appearance: {} }, seeded(seed)).clothingPatterns.forcedOverpassBySlot.overwear.pattern;
  assert.ok(pattern.frameScale >= 0.25 - 1e-9 && pattern.frameScale <= 0.75 + 1e-9, 'the frame only ever shrinks, within the authored range: ' + pattern.frameScale);
  assert.ok(pattern.frameRotationDeg >= 0 && pattern.frameRotationDeg < 360, 'a random rotation');
  frames.add(pattern.frameScale + '/' + pattern.frameRotationDeg);
}
assert.ok(frames.size > 15, 'frames differ between spawns');
assert.deepEqual(rules.applyRoster('ghoul', { appearance: {} }, seeded(7)).clothingPatterns.forcedOverpassBySlot.overwear.pattern, rules.applyRoster('ghoul', { appearance: {} }, seeded(7)).clothingPatterns.forcedOverpassBySlot.overwear.pattern, 'the same seed gives the same frame');
set(undefined);
const plain = rules.applyRoster('ghoul', { appearance: {} }, seeded(3)).clothingPatterns.forcedOverpassBySlot.overwear.pattern;
assert.deepEqual([plain.frameScale, plain.frameRotationDeg], [1, 10], 'without the option the authored frame is untouched');

// ── Special ghoul variants ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
assert.equal(rules.kindFor('grunt', { extra: { isGhoulShadowknight: true } }, null, {}), 'ghoul:shadowknight');
assert.equal(rules.kindFor('grunt', { extra: { mineWyrmWitchType: 'rend-water' } }, null, {}), 'ghoul:wyrm-witch:rend-water');
rules.set({ schema: rules.schema, rules: { ghoul: { rigScale: { x: 1.2 }, flaskCount: 3 } } });
assert.equal(rules.ruleFor('ghoul:shadowknight').flaskCount, 3, 'a special ghoul inherits the base Ghoul rule');
assert.equal(rules.rigScaleFor('ghoul:wyrm-witch:shadow-wind').x, 1.2);
rules.set({ schema: rules.schema, rules: { ghoul: { flaskCount: 3 }, 'ghoul:shadowknight': { flaskCount: 5 } } });
assert.equal(rules.ruleFor('ghoul:shadowknight').flaskCount, 5, 'its own rule wins');
assert.equal(rules.ruleFor('ghoul:wyrm-witch:rend-water').flaskCount, 3);
const sourceData = fs.readFileSync('docs/tools/enemy-loadout-editor/source-data.js', 'utf8');
for (const id of ['ghoul:shadowknight', 'ghoul:wyrm-witch:shadow-wind', 'ghoul:wyrm-witch:rend-water']) assert.ok(sourceData.includes(`'${id}'`), id + ' is in the Workshop enemy library');

// ── Ordinary liches ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const lichWindow = { SCRATCHBONES_CONFIG: { game: { dyes: { catalog: [{ id: 'dye:CLOTH:pure_orange', hex: '#ff8000' }, { id: 'dye:CLOTH:pale_blue', hex: '#a8d0f0' }, { id: 'dye:CLOTH:dark_muted_blue_indigo', hex: '#2b2f5c' }] } } }, PatternLibrary: { getById: () => null }, RepoPatternLibrary: { getCachedById: () => null }, EnemyLoadoutRules: rules };
rules.set({ schema: rules.schema, rules: {} });
const lichContext = vm.createContext({ window: lichWindow, console, document: undefined });
vm.runInContext(fs.readFileSync('docs/js/combat/combat-special-liches.js', 'utf8'), lichContext);
const liches = lichWindow.SpecialHarlyaoLiches;
for (const [type, glyph] of [['hronal', 'harlyao_glyph_entropy'], ['tothal', 'harlyao_glyph_servitude'], ['kanthic', 'harlyao_glyph_ignorance']]) {
  const named = liches.bodyColor3For(type), seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const policy = liches.ordinaryLichPatterns(type, seeded(seed * 97));
    const forced = policy.forcedOverpassBySlot;
    assert.deepEqual(Object.keys(forced).sort(), ['hood', 'mask', 'overwear', 'pants'], type + ' patterned slots');
    for (const [slot, entry] of Object.entries(forced)) {
      assert.equal(entry.pattern.repoPatternId, glyph, type + ' ' + slot + ' wears its own tradition’s glyph (the named lich’s)');
      assert.ok(entry.pattern.frameScale > 0 && entry.pattern.frameScale <= (Number(entry.pattern.frameScale) || 1), 'shrunk frame');
      assert.ok(hueGap(entry.fallbackColorC.hex, named) <= 18.5, type + ' pattern color stays in the named lich’s hue family: ' + entry.fallbackColorC.hex + ' vs ' + named);
      seen.add(entry.fallbackColorC.hex + '|' + entry.pattern.frameRotationDeg + '|' + entry.pattern.frameScale);
    }
    assert.deepEqual([forced.pants.scale, forced.overwear.scale, forced.hood.scale], [4, 1.05, 1.05], 'same per-piece scales as the named liches');
  }
  assert.ok(seen.size > 30, type + ' colors and frames vary between mobs');
}
assert.equal(liches.ordinaryLichPatterns('nope'), null);
const lichSource = fs.readFileSync('docs/js/combat/combat-lich.js', 'utf8');
assert.match(lichSource, /if \(!options\.roster && !special\) \{[\s\S]{0,300}ordinaryLichPatterns\?\.\(def\.id, random\)/, 'ordinary liches get their tradition patterns at spawn');

// ── Loot: patterns retained, circlets and masks cursed ─────────────────────────────────────────────────────────────────────────────────
const camps = fs.readFileSync('docs/js/bandit-camps.js', 'utf8');
const lootWindow = { NpcWardrobe: { forcedPatternForRender: (rec, slot, forced) => ({ ...JSON.parse(JSON.stringify(forced.pattern)), outlineReferenceShortSide: 173, ...(forced.scale ? { usageScaleMultiplier: forced.scale } : {}) }) }, MetalArmorSystem: { baseCosmeticId: (item) => item.cosmeticId }, BanditCombat: { TINT_SLOT_BY_SLOT: { pants: 'PANTS', overwear: 'CLOTH', hood: 'HOOD', mask: 'MASK', hat: 'HAT' } } };
const lootDeps = { getDyeCatalog: () => [{ id: 'dye:CLOTH:pure_orange', hex: '#ff8000', label: 'Orange' }], getStoreClothingPieces: () => [], rnd: () => 0.5, dyeToClothingColor: (dye) => dye && { hex: dye.hex, dyeId: dye.id, label: dye.label }, clothingSpriteForCosmetic: (id) => 'sprite:' + id };
const lootContext = vm.createContext({ window: lootWindow, deps: lootDeps, Date, Math, JSON });
vm.runInContext([extract(camps, '_banditClothingPiece'), extract(camps, 'lootCurseFor'), extract(camps, 'applyLootCurse'), extract(camps, 'applyLootPattern'), extract(camps, 'banditWornClothingItems'), 'this.loot = banditWornClothingItems;'].join('\n'), lootContext);
const frame = { frameScale: 0.4321, frameRotationDeg: 211.7, repoPatternId: 'glyph' };
const roster = {
  lichType: 'hronal', specialLichId: 'azgarlu',
  equippedCosmetics: ['draped_pants', 'tankan_bodywrap', 'facewrap', 'tangedcirclet'],
  cosmeticSlots: { draped_pants: 'pants', tankan_bodywrap: 'overwear', facewrap: 'hood', tangedcirclet: 'hat' },
  appliedDyes: { PANTS: 'dye:CLOTH:pure_orange', CLOTH: 'dye:CLOTH:pure_orange', HOOD: 'dye:CLOTH:pure_orange' },
  metalArmorItems: [{ cosmeticId: 'tangedcirclet', slot: 'hat', label: 'Tanged Circlet', smithTreatment: { mode: 'painted', metalKey: 'silver', paintHex: '#1a8cff', pattern: frame } }],
  clothingPatterns: { forcedOverpassBySlot: {
    overwear: { pattern: frame, fallbackColorC: { hex: '#1a8cff' }, scale: 1.05 },
    pants: { pattern: frame, fallbackColorC: { hex: '#1a8cff' }, scale: 4, roles: ['DRAPE'], baseUsesPatternColor: true },
    hood: { pattern: frame, fallbackColorC: { hex: '#1a8cff' }, scale: 1.05 },
  } },
};
const items = lootContext.loot(roster);
const byCosmetic = Object.fromEntries(items.map(item => [item.cosmeticId, item]));
const robe = byCosmetic.tankan_bodywrap, pants = byCosmetic.draped_pants, wrap = byCosmetic.facewrap, circlet = byCosmetic.tangedcirclet;
for (const piece of [robe, pants, wrap]) {
  assert.equal(piece.weaving.forcedOverpassPattern.frameScale, 0.4321, piece.cosmeticId + ' keeps the exact random frame scale');
  assert.equal(piece.weaving.forcedOverpassPattern.frameRotationDeg, 211.7, piece.cosmeticId + ' keeps the exact random rotation');
  assert.equal(piece.colorC.hex, '#1a8cff', piece.cosmeticId + ' keeps its pattern color');
}
assert.equal(robe.weaving.forcedOverpassPattern.usageScaleMultiplier, 1.05);
assert.equal(pants.weaving.forcedOverpassPattern.usageScaleMultiplier, 4);
assert.deepEqual([...pants.weaving.forcedOverpassRoles], ['DRAPE']);
assert.equal(pants.colorA.hex, '#1a8cff', 'draped pants loot: base is the pattern color');
assert.equal(pants.colorB.hex, '#ff8000', '...and the drape keeps the main color');
assert.equal(robe.cursed, undefined, 'the robe is not cursed');
assert.equal(pants.cursed, undefined);
assert.deepEqual({ ...circlet.cursed }, { kind: 'circlet', dispelBy: 'garanki', originalLabel: 'Tanged Circlet' }, 'lich circlets are looted cursed, to be dispelled by Garanki');
assert.equal(circlet.label, 'Cursed Tanged Circlet');
assert.equal(circlet.smithTreatment.paintHex, '#1a8cff', 'the painted plating is retained');
assert.equal(wrap.cursed, undefined, 'a lich\u2019s face wrap is an ordinary garment: only circlets (and Maskbound masks) are cursed');
assert.equal(wrap.label.startsWith('Cursed'), false);
// Maskbound masks are the cursed masks (Father Hunundi, later) and keep the exact random pattern they were generated with.
lootWindow.isPortraitMaskCosmeticId = (id) => id === 'hachutu_binding_mask_ii';
const maskPatterns = [{ frameScale: 0.3, frameRotationDeg: 77.7, inkColorHex: '#33ddaa', repoPatternId: 'hachutu_a' }, { frameScale: 0.6, frameRotationDeg: 301.2, inkColorHex: '#aa44ff', repoPatternId: 'hachutu_b' }];
const maskbound = lootContext.loot({
  maskboundTroop: 'sentinel', equippedCosmetics: ['hachutu_binding_mask_ii', 'ragged_hood'],
  cosmeticSlots: { hachutu_binding_mask_ii: 'mask', ragged_hood: 'hood' }, appliedDyes: {},
}, { avatarRef: { profile: { bodyColors: { __hobunjiWovenClothing: [{ slot: 'mask', baseCosmeticId: 'hachutu_binding_mask_ii', weaving: { patterns: maskPatterns } }] } } } });
const bindingMask = maskbound.find(item => item.cosmeticId === 'hachutu_binding_mask_ii'), maskHood = maskbound.find(item => item.cosmeticId === 'ragged_hood');
assert.deepEqual({ ...bindingMask.cursed, originalLabel: undefined }, { kind: 'mask', dispelBy: 'hunundi', originalLabel: undefined }, 'a Maskbound\u2019s mask loots cursed, to be lifted by Father Hunundi');
assert.match(bindingMask.label, /^Cursed /);
assert.deepEqual(JSON.parse(JSON.stringify(bindingMask.weaving.patterns)), maskPatterns, 'the looted mask keeps its exact random patterns, frames and ink colors');
assert.equal(maskHood.cursed, undefined, 'a Maskbound\u2019s hood is ordinary');
const wornByBandit = lootContext.loot({ equippedCosmetics: ['hachutu_binding_mask_ii'], cosmeticSlots: { hachutu_binding_mask_ii: 'mask' }, appliedDyes: {} });
assert.equal(wornByBandit[0].cursed, undefined, 'only Maskbound masks are cursed');
const bandit = lootContext.loot({ equippedCosmetics: ['tangedcirclet'], cosmeticSlots: { tangedcirclet: 'hat' }, appliedDyes: {} });
assert.equal(bandit[0].cursed, undefined, 'ordinary enemies’ circlets are not cursed');

// ── Cursed pieces cannot be worn; Garanki dispels circlets ─────────────────────────────────────────────────────────────────────────────
const panel = fs.readFileSync('docs/js/equipment-panel.js', 'utf8');
assert.match(panel, /if \(packClothing\[idx\]\?\.cursed\) \{ deps\.showToast\(cursedMessage\(packClothing\[idx\]\), false\); return; \}/, 'transfer to gear is blocked');
assert.match(panel, /if \(item\.cursed\) \{ deps\.showToast\(cursedMessage\(item\), false\); return; \}/, 'equipping from gear is blocked');
assert.match(panel, /Cursed — cannot be worn/, 'the pack detail shows a disabled button instead of Transfer to Gear');
const relics = fs.readFileSync('docs/js/harlyao-relics.js', 'utf8');
const toasts = [];
const pack = [{ uid: 'a', label: 'Cursed Tanged Circlet', cursed: { kind: 'circlet', dispelBy: 'garanki', originalLabel: 'Tanged Circlet' } }, { uid: 'm', label: 'Cursed Facewrap', cursed: { kind: 'mask', dispelBy: 'hunundi', originalLabel: 'Facewrap' } }];
const dispelContext = vm.createContext({ window: { ArtifactCollection: {}, DelversGuild: undefined }, deps: { getPackClothing: () => pack, inventory: { gold: 100 }, showToast: (text) => toasts.push(text), saveMemberWorldData() {}, buildPackClothingSection() {}, buildInventoryGrid() {} }, render() {}, requireService: () => true, DISPEL_PRICE: 150 });
vm.runInContext(['spendGold', 'cursedCircletsInPack', 'dispelCurse'].map(name => extract(relics.replace('const DISPEL_PRICE = 150;', ''), name)).join('\n') + '\nthis.dispelCurse = dispelCurse; this.cursed = cursedCircletsInPack;', dispelContext);
assert.deepEqual([...dispelContext.cursed()].map(item => item.uid), ['a'], 'Garanki only handles circlets, not masks');
assert.equal(dispelContext.dispelCurse('a').reason, 'gold', 'he wants his fee');
assert.ok(pack[0].cursed, 'a failed dispel changes nothing');
dispelContext.deps.inventory.gold = 500;
assert.equal(dispelContext.dispelCurse('m').reason, 'not-owned', 'masks are not his to dispel');
assert.deepEqual({ ...dispelContext.dispelCurse('a') }, { ok: true });
assert.equal(pack[0].cursed, undefined, 'the curse is lifted');
assert.equal(pack[0].label, 'Tanged Circlet', 'and the name restored');
assert.equal(dispelContext.deps.inventory.gold, 350, 'for 150 gold');
assert.ok(pack[1].cursed, 'the mask stays cursed');
assert.match(relics, /getPackClothing: \(\) => packClothing/.test(fs.readFileSync('docs/game.js', 'utf8')) ? /Cursed circlets/ : /impossible/, 'Garanki’s panel lists cursed circlets and game.js supplies the pack');
// ── Exorcism: souls, priests and glowing eyes ─────────────────────────────────────────────────────────────────────────────────────────
const panelContext = vm.createContext({});
vm.runInContext(extract(panel, 'cursedMessage') + extract(panel, 'dispelCurse') + 'this.msg = cursedMessage; this.dispel = dispelCurse;', panelContext);
assert.match(panelContext.msg({ cursed: { kind: 'mask', dispelBy: 'hunundi' } }), /soul is bound inside.*priest.*a mage cannot/, 'a cursed mask holds a soul: it needs a priest, not a mage');
assert.match(panelContext.msg({ cursed: { kind: 'circlet', dispelBy: 'garanki' } }), /Garanki/);
const freedMask = { label: 'Cursed Mask', cursed: { kind: 'mask', dispelBy: 'hunundi', originalLabel: 'Mask' } };
assert.equal(panelContext.dispel(freedMask), true);
assert.deepEqual({ ...freedMask }, { label: 'Mask', exorcised: true }, 'an exorcised mask is flagged so its eyes stay dark, and the curse is gone');
const freedCirclet = { label: 'Cursed Circlet', cursed: { kind: 'circlet', dispelBy: 'garanki', originalLabel: 'Circlet' } };
panelContext.dispel(freedCirclet);
assert.deepEqual({ ...freedCirclet }, { label: 'Circlet' }, 'a dispelled circlet carries no flags that could emit fire');
assert.equal(panelContext.dispel({ label: 'plain' }), false);
const avatarUtils = fs.readFileSync('docs/js/npc-avatar-preview-utils.js', 'utf8');
const glowContext = vm.createContext({});
vm.runInContext(extract(avatarUtils, 'stripExorcisedMaskGlow') + 'this.strip = stripExorcisedMaskGlow;', glowContext);
const glowingMask = () => ({ layers: [{ url: 'a.png', pixelDye: { sourceHex: '#7F00FF', glow: { radius: 0.65 } } }, { url: 'b.png' }] });
const exorcisedProfile = glowContext.strip({ bodyColors: { __hobunjiWovenClothing: [{ slot: 'mask', exorcised: true }] }, mask: glowingMask() });
assert.equal(exorcisedProfile.mask.layers[0].pixelDye.glow, null, 'an exorcised mask’s eyes do not glow');
assert.equal(exorcisedProfile.mask.layers[0].pixelDye.sourceHex, '#7F00FF', 'its eye dye/color is otherwise unchanged');
const stillGlowing = glowContext.strip({ bodyColors: { __hobunjiWovenClothing: [{ slot: 'mask' }] }, mask: glowingMask() });
assert.ok(stillGlowing.mask.layers[0].pixelDye.glow, 'a Maskbound’s own mask still glows');
assert.ok(glowContext.strip({ bodyColors: {}, mask: glowingMask() }).mask.layers[0].pixelDye.glow);
assert.match(fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8'), /item\?\.exorcised === true \? \{ exorcised: true \}/, 'the worn-item descriptor carries the exorcised flag to the portrait');
assert.match(relics, /window\.EquipmentPanel\?\.dispelCurse/, 'Garanki lifts curses through the shared helper');
// Lich fire comes only from the lich avatar's hidden headband; looted/dispelled circlets never carry or request any.
assert.doesNotMatch(camps, /headFire|specialHeadFire|flameHeadband/, 'loot never carries fire data');
assert.match(fs.readFileSync('docs/js/combat/combat-special-liches.js', 'utf8'), /const root=actor\.avatarRef\?\.group, data=root\?\.userData\?\.specialHeadFire/, 'flames are read from the lich avatar only');
assert.equal(Object.keys(circlet).some(key => /fire|flame/i.test(key)), false);

console.log('Lich patterns and loot: random frames, tradition patterns, retained loot patterns and curses verified');

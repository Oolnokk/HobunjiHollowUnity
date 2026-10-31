// Executes the named-boss pattern authoring path: rule validation and the runtime lookup that the Workshop's Pattern editor feeds.
// Run with: node scripts/test-boss-patterns.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
const context = vm.createContext({
  window, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
vm.runInContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), context);
const rules = window.EnemyLoadoutRules;
const kind = 'lich:hronal:azgarlu';
const set = (bossAppearance) => rules.set({ schema: rules.schema, rules: { [kind]: { bossAppearance } } });

set({ weaponPattern: { pattern: { motifScale: 1, tiling: true } }, clothingPattern: { patternLibraryId: 'repo:blessed_blossom' } });
assert.throws(() => set({ weaponPattern: {} }), /needs a pattern or a library id/);
assert.throws(() => set({ weaponPattern: { patternLibraryId: 'bad id!' } }), /library id/);
assert.throws(() => set({ weaponPattern: { pattern: [] } }), /pattern object/);
assert.throws(() => set({ weaponPattern: { pattern: {}, extra: 1 } }), /extra is unknown/);
assert.throws(() => set({ weaponPattern: { pattern: { blob: 'x'.repeat(950000) } } }), /under 900 KB/);

// Runtime lookup: an authored inline pattern, an authored library id, then the canonical glyph.
const lookup = new Map([['repo:blessed_blossom', { repoPatternId: 'blossom', motifScale: 2 }]]);
Object.assign(window, { SCRATCHBONES_CONFIG: { game: { dyes: { catalog: [{ id: 'dye:CLOTH:pure_orange', hex: '#ff8000' }, { id: 'dye:CLOTH:pale_blue', hex: '#a8d0f0' }, { id: 'dye:CLOTH:dark_muted_blue_indigo', hex: '#2b2f5c' }] } } }, PatternLibrary: { getById: (id) => lookup.get(id) || null }, RepoPatternLibrary: { getCachedById: () => null }, EnemyLoadoutRules: rules });
vm.runInContext(fs.readFileSync('docs/js/combat/combat-special-liches.js', 'utf8'), context);
const liches = window.SpecialHarlyaoLiches;
assert.ok(liches?.patternFor, 'patternFor is exported');
set({ weaponPattern: { pattern: { custom: true } }, clothingPattern: { patternLibraryId: 'repo:blessed_blossom' } });
assert.deepEqual(JSON.parse(JSON.stringify(liches.patternFor('hronal', 'weaponPattern'))), { custom: true }, 'inline weapon pattern wins');
assert.equal(liches.patternFor('hronal', 'clothingPattern').repoPatternId, 'blossom', 'library id resolves through PatternLibrary');
rules.set({ schema: rules.schema, rules: {} });
assert.equal(liches.patternFor('hronal', 'weaponPattern').repoPatternId, 'harlyao_glyph_entropy', 'unset falls back to the canonical entropy glyph');

// Body Color 3 defaults to the hue opposite the primary robe color (never the same family), still overridable.
const hue = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, max = Math.max(r, g, b), d = max - Math.min(r, g, b); const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const opposed = (a, b) => Math.abs(((hue(a) - hue(b) + 360) % 360) - 180);
for (const [type, robe] of [['hronal', '#ff8000'], ['tothal', '#a8d0f0'], ['kanthic', '#2b2f5c']]) {
  const c = liches.bodyColor3For(type);
  assert.match(c, /^#[0-9a-f]{6}$/, type + ' Body Color 3 is a hex color');
  assert.ok(opposed(c, robe) < 8, type + ' Body Color 3 is the opposite hue of its robe (' + c + ' vs ' + robe + ')');
}
set({ ink: '#123456' });
assert.equal(liches.bodyColor3For('hronal'), '#123456', 'a Workshop override still wins');
rules.set({ schema: rules.schema, rules: {} });

// Every named guardian's pants carry the woven pattern, not only the hammer wielder's.
for (const type of ['hronal', 'tothal', 'kanthic']) {
  const forced = liches.specialRoster(type).clothingPatterns.forcedOverpassBySlot;
  assert.ok(forced.overwear.pattern && forced.pants.pattern, type + ' robe and pants are both patterned');
  assert.equal(forced.pants.fallbackColorC.hex, liches.bodyColor3For(type), type + ' pants use Body Color 3 for the pattern');
}

// Armor and weapon: silver plating painted with the pattern (never verdigris removal), carried on the lootable items; circlets for all three.
window.MetalArmorSystem = {
  MAX_TEMPER_XP: 999, spriteForBlueprintAppearance: (id) => 'sprite:' + id,
  makeCraftedItem: (id, metal) => ({ cosmeticId: id, slot: id === 'tangedcirclet' ? 'hat' : 'pauldron', metalKey: metal }),
};
for (const type of ['hronal', 'tothal', 'kanthic']) {
  const roster = liches.specialRoster(type);
  assert.ok(roster.equippedCosmetics.includes('tangedcirclet') && roster.cosmeticSlots.tangedcirclet === 'hat', type + ' wears a tanged circlet');
  const items = roster.metalArmorItems;
  assert.deepEqual([...items.map(item => item.cosmeticId)], type === 'hronal' ? ['rounded_pauldron', 'tangedcirclet'] : ['tangedcirclet']);
  for (const item of items) {
    assert.equal(item.smithTreatment.mode, 'painted', type + ' ' + item.cosmeticId + ' is painted');
    assert.equal(item.smithTreatment.metalKey, 'silver', 'silver plating, not verdigris removal');
    assert.equal(item.smithTreatment.paintHex, liches.bodyColor3For(type), 'paint defaults to Body Color 3 and is its own redye-able field');
    assert.ok(item.smithTreatment.pattern, 'the pattern travels with the loot');
  }
}
const armorSource = fs.readFileSync('docs/js/metal-armor-system.js', 'utf8');
assert.match(armorSource, /active\?\.mode === 'painted'/, 'MetalArmorSystem renders painted plating');
assert.match(armorSource, /cannot be reworked at the smithy/, 'painted plating cannot be reworked');
assert.match(armorSource, /cannot be re-patterned/, 'painted plating cannot be re-authored');

// Flame headband: an invisible marker-dyed headband supplies emitter pixels; the circlet alone becomes the overlay drawn above the flames.
(async () => {
  const calls = [];
  window.HobunjiLayeredWeaponEffects = { sourcePixels: (canvas, hex, kind) => { assert.equal(hex, '#7F00FF'); assert.equal(kind, 'marker'); return canvas.markers || []; } };
  const circlet = { id: 'tangedcirclet', tintSlot: 'HAT', layers: [{ url: 'cosmetics/clothes/hat/tangedcirclet_m.png', ax: -0.2, sx: 2.55, sy: 2.55, xformPreset: 'B' }] };
  const profile = { bodyColors: { C: { hex: '#123456' } }, hat: circlet, hood: { id: 'ragged_hood', layers: [{ url: 'hood.png' }] }, eyes: { id: 'eyes', layers: [{ url: 'eyes.png' }] }, pauldron: { id: 'p', layers: [{ url: 'p.png' }] }, hairFront: { id: 'hair', layers: [{ url: 'hair.png' }] } };
  const render = async (rendered, options) => { const canvas = { rendered, options, markers: rendered.hat.id === 'special_flame_headband' ? [0, 1, 200 * 10 + 5, 200 * 199 + 199] : [] }; calls.push(canvas); return canvas; };
  const roster = liches.specialRoster('hronal');
  assert.deepEqual({ ...roster.flameHeadband }, { cosmeticId: 'basic_headband', hex: '#7F00FF', hidden: true }, 'the headband is recorded as a hidden marker-dyed item');
  const fire = await liches.prepareHeadFire(profile, roster, render, 200);
  const [band, overlay] = calls;
  assert.equal(band.rendered.hat.layers[0].url, 'cosmetics/clothes/hat/headband.png', 'a regular headband stands in under the circlet');
  assert.equal(band.rendered.bodyColors.HAT.hex, '#7F00FF', 'the headband is dyed the marker hex');
  assert.equal(band.rendered.bodyColors.C.hex, '#123456', 'other body colors are untouched');
  for (const slot of ['hood', 'eyes', 'pauldron', 'hairFront']) assert.equal(band.rendered[slot].id, 'none', slot + ' is not part of the emitter render');
  assert.ok(band.options.headCosmeticsOnly && band.options.skipHeadSprite, 'only hat layers are rendered');
  assert.equal(overlay.rendered.hat.id, 'tangedcirclet', 'the overlay carries only the circlet');
  assert.equal(fire.sources.length, 4);
  assert.deepEqual({ ...fire.sources[2] }, { x: 5.5 / 200, y: 10.5 / 200 }, 'emitters are normalized portrait coordinates');
  assert.equal(fire.overlayCanvas, overlay);
  assert.equal(await liches.prepareHeadFire({ ...profile, hat: { id: 'none', layers: [] } }, roster, render, 200), null, 'no circlet, no flames');
  assert.equal(await liches.prepareHeadFire(profile, roster, async (rendered) => ({ markers: [] }), 200), null, 'no marker pixels, no flames');
  assert.equal(await liches.prepareHeadFire(profile, { name: 'bandit' }, render, 200), null, 'only named guardians');
  const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
  assert.match(bandit, /group\.userData\.specialHeadFire = await window\.SpecialHarlyaoLiches\.prepareHeadFire/, 'the hostile builder requests the emitter data');
  assert.match(bandit, /appearance: pantsAppearanceWithForcedPattern\(window\.PantsGarmentRenderer\.appearanceFromBodyColors\(profile\.bodyColors\), roster\)/, 'the hostile pants renderer receives the forced woven pattern');
  assert.match(bandit, /forcedOverpassPattern: JSON\.parse\(JSON\.stringify\(forced\.pattern\)\)/, 'pants weave data carries the guardian pattern');
  assert.match(fs.readFileSync('docs/js/combat/combat-special-liches.js', 'utf8'), /trackPortraitTexture\?\.\(THREE,texture,'front'\)/, 'the circlet overlay follows the portrait flip setting');
  assert.match(fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8'), /js\/weapon-layer-effects\.js\?v=/, 'the Workshop loads the marker-pixel scanner');
  console.log('Flame headband: emitter pixels, hidden headband and circlet overlay verified');
})().catch(error => { console.error(error); process.exit(1); });

// Wired into the Workshop: shared Pattern editor scripts and both editor entry points.
const preview = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8');
for (const file of ['pattern-authoring', 'pattern-library', 'repo-pattern-library', 'furniture-pattern-surfaces']) assert.match(preview, new RegExp(`js/${file}\\.js\\?v=`), file + ' loads in the Workshop');
const app = fs.readFileSync('docs/tools/enemy-loadout-editor/app.js', 'utf8');
assert.match(app, /openBossPatternEditor\(special, patternKind\)/);
assert.match(app, /PatternAuthoring\.openEditor/);
console.log('Boss patterns: rule validation, runtime lookup and Workshop wiring verified');

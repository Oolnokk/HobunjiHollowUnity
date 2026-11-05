'use strict';
const assert = require('node:assert/strict'); // Checks the shipped JS modules and actual game renderer branches.
const fs = require('node:fs'); // Loads real sources/assets, so missing uploads fail before gameplay.
const vm = require('node:vm'); // Executes the new browser modules without requiring WebGL or a console.

const read = path => fs.readFileSync(path, 'utf8'); // Shared fixture loader for live source rather than duplicated algorithms.
const loadModule = (path, window) => {
  vm.runInNewContext(read(path), { window, console }); // Both new modules initialize lazily and have no DOM dependencies.
  return window;
};

const window = {
  Combat: { abilities: { get: id => ({ category: ({
    blinkDodge: 'defensiveHold', chargedBreaker: 'offensiveHold', exhaustCutter: 'quickAttack',
  })[id] || 'quickAttack' }) } },
}; // Actual category mapping for these named game abilities.
loadModule('docs/js/object-sprite-catalog.js', window);
loadModule('docs/js/roadside-koma-hedges.js', window);
const catalog = window.ObjectSpriteCatalog; // Tests public live API exposed to inventory and game.js.
const roadside = window.RoadsideKomaHedges; // Tests map/row authority exposed to the foliage renderer.
assert.equal(catalog.SLOT_COLORS.defensiveHold, 0x7CFF4F);
const manualArt = abilityId => catalog.classify('combatManual' + abilityId, { combatManualAbilityId: abilityId });
assert.equal(manualArt('blinkDodge').spriteMode, 'layered-scroll:7cff4f', 'defensive held uses green Held Action 2, regardless of offensive held availability');
assert.equal(manualArt('chargedBreaker').spriteMode, 'layered-scroll:ff4fd8');
assert.equal(manualArt('exhaustCutter').spriteMode, 'layered-scroll:ffd23f');
assert.equal(catalog.classify('techniqueScrollTier1', { techniqueScrollTier: 1 }).spriteMode, 'layered-scroll:7cff4f');
assert.equal(catalog.classify('techniqueScrollTier2', { techniqueScrollTier: 2 }).spriteMode, 'layered-scroll:ffd23f');
assert.equal(catalog.classify('techniqueScrollTier3', { techniqueScrollTier: 3 }).spriteMode, 'layered-scroll:ff4fd8');
assert.equal(catalog.classify('masteryScroll:sharp:1:bleed', { masteryUnlock: { type: 'sharp', rank: 1 } }).spriteMode, 'layered-scroll:00d9ff');
assert.equal(catalog.classify('masteryTablet:sharp:1:bleed', { masteryUnlock: { type: 'sharp', rank: 1 } }).spriteIcon, 'stone_tablet.png');
for (const [key, def, expected] of [
  ['oreCopper', { label: 'Copper Ore' }, 'ore.png'],
  ['bar_tinBronze', { label: 'Tin Bronze Bar' }, 'ingot.png'],
  ['blueberry', { label: 'Blueberry' }, 'berries.png'],
  ['komaPowder', { label: 'Iridescent Koma Powder' }, 'powder.png'],
  ['groundFlour', { label: 'Ground Flour' }, 'powder.png'],
  ['dryHerb', { label: 'Dry Herb Leaves' }, '../leaves/speartip_leaf.png'],
]) assert.equal(catalog.classify(key, def).spriteIcon, expected, 'object art for ' + key);
assert.equal(catalog.classify('komaPowder', { label: 'Koma Powder' }).spriteMode, 'direct-sheen');
assert.equal(catalog.classify('gold', { label: 'Gold' }), null, 'Currency must not become a gold ingot');
assert.equal(catalog.classify('garlink', { label: 'Garlink Herb', spriteIcon: 'garlink_bunch.png' }), null, 'Specialized authored crops retain their existing sprite');
const definitions = { combatManualBlinkDodge: { combatManualAbilityId: 'blinkDodge' }, copperOre: { label: 'Copper Ore' } };
const inventoryItems = [{ key: 'combatManualBlinkDodge' }, { key: 'copperOre' }];
assert.equal(catalog.applyAll({ ITEM_DEFS: definitions, inventoryItems }), 2);
assert.equal(definitions.combatManualBlinkDodge.spriteMode, 'layered-scroll:7cff4f');
assert.equal(inventoryItems[0].spriteIcon, 'scroll.png');
assert.equal(inventoryItems[1].spriteIcon, 'ore.png');
const tierDefs = { techniqueScrollTier1: { label: 'Tier 1 Technique Scroll', techniqueScrollTier: 1 } };
const tierEntries = [{ key: 'techniqueScrollTier1', label: 'Tier 1 Technique Scroll' }];
catalog.applyAll({ ITEM_DEFS: tierDefs, inventoryItems: tierEntries });
assert.equal(tierDefs.techniqueScrollTier1.spriteMode, 'layered-scroll:7cff4f');
assert.equal(tierEntries[0].spriteMode, 'layered-scroll:7cff4f', 'Metadata-light item entry must inherit canonical defensive-held binding color');
assert.equal(catalog.ensure('techniqueScrollTier1', tierEntries[0]).spriteMode, 'layered-scroll:7cff4f', 'Repainting a Pack/arch cell must not overwrite canonical binding tint');
assert.ok(catalog.getDebug().patched >= 4, 'Mobile debug snapshot records registered art');

const grid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({ type: 'grass' })));
for (let row = 0; row < 20; row++) grid[row][10] = { type: 'path' };
for (let row = 4; row <= 12; row++) for (const col of [8, 12]) grid[row][col] = { type: 'shrub', floraKind: 'bush' };
grid[17][9] = { type: 'shrub', floraKind: 'bush' }; // Isolated roadside bush must keep the original leaf.
grid[8][7] = { type: 'shrub', floraKind: 'copse' }; // Real trees must never be replaced by Koma hedges.
grid[5][2] = { type: 'shrub', floraKind: 'bush' }; // Ordinary wilderness bushes away from roads keep old leaves.
for (const zone of ['map_southern_cloud_forest', 'map_northern_cliffs', 'map_eastern_mire'])
  assert.equal(roadside.isHedgeBush(grid, 8, 8, zone), true, zone + ' has caravan-path hedge');
assert.equal(roadside.isHedgeBush(grid, 8, 8, 'map_western_slope'), false, 'Leafless Western Slope is excluded');
assert.equal(roadside.isHedgeBush(grid, 9, 17, 'map_southern_cloud_forest'), false);
assert.equal(roadside.isHedgeBush(grid, 2, 5, 'map_southern_cloud_forest'), false);
assert.equal(roadside.isHedgeBush(grid, 7, 8, 'map_southern_cloud_forest'), false);
assert.ok(roadside.getDebug().hits >= 3, 'Mobile roadside debug probe records rendered hedge eligibility');

const game = read('docs/game.js'); // Executes the real zone vegetation dispatch, not a reimplemented test copy.
const dispatch = game.slice(game.indexOf('              const isDeadTree ='), game.indexOf('              if (isDeadTree || isCrownedPine || isShadewood)'));
assert.ok(dispatch.includes('isKomaHedge') && dispatch.includes('buildKomaHedgeBushMesh'));
const funcs = ['buildDeadTreeMesh', 'buildDeadBushMesh', 'buildCrownedPineMesh', 'buildShadewoodMesh', 'buildKomaHedgeBushMesh', 'buildWildernessBushMesh', 'buildStumpMesh', 'buildShrubMesh'];
const FoliageGenerator = Object.fromEntries(funcs.map(name => [name, () => name]));
const render = new Function('window', 'mapId', 'tile', 'EXTERIOR_ZONES', 'c', 'r', 'zGrid', dispatch + '; return vegGroup;');
const runtime = { FoliageGenerator, RoadsideKomaHedges: roadside };
assert.equal(render(runtime, 'map_southern_cloud_forest', grid[8][8], { map_southern_cloud_forest: { cloudForest: true } }, 8, 8, grid), 'buildKomaHedgeBushMesh');
assert.equal(render(runtime, 'map_southern_cloud_forest', grid[17][9], { map_southern_cloud_forest: { cloudForest: true } }, 9, 17, grid), 'buildWildernessBushMesh');
assert.equal(render(runtime, 'map_western_slope', grid[8][8], {}, 8, 8, grid), 'buildDeadBushMesh');
assert.equal(render(runtime, 'map_southern_cloud_forest', { floraKind: 'copse' }, { map_southern_cloud_forest: { cloudForest: true } }, 8, 8, grid), 'buildShadewoodMesh');
assert.ok(game.includes('window.ObjectSpriteCatalog?.ensure?.(key, def)'), 'All inventory HUD/Pack icons use the live item art resolver');

const reticle = read('docs/js/combat/melee-hud-reticle.js'); // Canonical slot palette remains the only color authority.
for (const hex of ['#00D9FF', '#FFD23F', '#FF4FD8', '#7CFF4F']) assert.ok(reticle.includes(hex));
const html = read('docs/index.html'); // Parser-time dependencies must appear ahead of game boot.
assert.ok(html.indexOf('object-sprite-catalog.js') < html.indexOf('game.js?v='));
assert.ok(html.indexOf('roadside-koma-hedges.js') < html.indexOf('game.js?v='));
const sourceRecolor = read('docs/js/sprite-recolor.js');
assert.ok(sourceRecolor.includes("assets/objectsprites/scroll_binding.png"));
assert.ok(sourceRecolor.includes("assets/objectsprites/iridescent_sheen.png"));
assert.ok(sourceRecolor.includes('source-atop'), 'Iridescent overlay cannot fill transparent image areas');
for (const name of ['scroll.png', 'scroll_binding.png', 'powder.png', 'ore.png', 'ingot.png', 'berries.png', 'stone_tablet.png', 'speartip_leaf.png']) {
  const dir = name === 'speartip_leaf.png' ? 'leaves' : 'objectsprites';
  assert.ok(fs.existsSync('docs/assets/' + dir + '/' + name), 'Missing uploaded object art: ' + name);
}
const scroll = fs.readFileSync('docs/assets/objectsprites/scroll.png'); // Verify the two layer canvases fit without scaling or cropping.
const binding = fs.readFileSync('docs/assets/objectsprites/scroll_binding.png');
assert.equal(scroll.readUInt32BE(16), binding.readUInt32BE(16));
assert.equal(scroll.readUInt32BE(20), binding.readUInt32BE(20));
for (const path of [
  'docs/js/object-sprite-catalog.js', 'docs/js/roadside-koma-hedges.js', 'docs/js/sprite-recolor.js',
  'docs/js/foliage-generator.js', 'docs/js/combat/combat-progression.js', 'docs/js/combat/technique-scrolls.js',
]) new vm.Script(read(path)); // Module syntax validation runs without a browser.
console.log('Koma roadside vegetation, registered inventory sprites, scroll bindings and uploaded PNG alignment passed.');

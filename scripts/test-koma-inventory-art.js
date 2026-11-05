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
const berryColors = { redberries: 0xD93A3A, blueberries: 0x3F63D9, yellowberries: 0xE0C93A, whiteberries: 0xF2EFE6, blackberries: 0x241A2E }; // Mirrors the canonical ItemProcessing pigment table, which runs before this catalogue.
window.ItemProcessing = { BERRY_COLORS: berryColors };
for (const [berry, color] of Object.entries(berryColors)) {
  assert.equal(catalog.classify(berry, { label: berry }).spriteColor, color, 'Raw berry tint: ' + berry);
  assert.equal(catalog.classify(berry + 'Dried', { label: 'Dried ' + berry }).spriteColor, color, 'Dried berry tint: ' + berry);
  assert.equal(catalog.classify(berry + 'Jam', { label: berry + ' Jam', spriteIcon: 'jar_liquid.png' }), null, 'Jar artwork stays on jam');
  assert.equal(catalog.classify(berry + 'Juice', { label: berry + ' Juice', spriteIcon: 'jar_liquid.png' }), null, 'Liquid artwork stays on juice');
  assert.equal(catalog.classify(berry + 'Wine', { label: berry + ' Wine', spriteIcon: 'bottle_wine.png' }), null, 'Bottle artwork stays on wine');
}
assert.equal(catalog.classify('bar_tinBronze', { label: 'Tin Bronze Bar' }).spriteColor, 0xAA8050, 'Tin bronze must have bronze rather than tin pigment');
assert.equal(catalog.classify('bar_platinum', { label: 'Platinum Bar' }).spriteColor, 0xCAD0D4, 'Platinum must not accidentally match tin');
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
grid[8][6] = { type: 'shrub', floraKind: 'fruitBush' }; // Resource-bearing bushes cannot be silently restyled as decorative hedges.
grid[5][2] = { type: 'shrub', floraKind: 'bush' }; // Ordinary wilderness bushes away from roads keep old leaves.
for (const zone of ['map_southern_cloud_forest', 'map_northern_cliffs', 'map_eastern_mire'])
  assert.equal(roadside.isHedgeBush(grid, 8, 8, zone), true, zone + ' has caravan-path hedge');
assert.equal(roadside.isHedgeBush(grid, 8, 8, 'map_western_slope'), false, 'Leafless Western Slope is excluded');
assert.equal(roadside.isHedgeBush(grid, 9, 17, 'map_southern_cloud_forest'), false);
assert.equal(roadside.isHedgeBush(grid, 2, 5, 'map_southern_cloud_forest'), false);
assert.equal(roadside.isHedgeBush(grid, 7, 8, 'map_southern_cloud_forest'), false);
assert.equal(roadside.isHedgeBush(grid, 6, 8, 'map_southern_cloud_forest'), false, 'Resource bushes retain harvestable appearance');
assert.ok(roadside.getDebug().hits >= 3, 'Mobile roadside debug probe records rendered hedge eligibility');
const decorative = roadside.hedgePlan(grid, 'map_southern_cloud_forest'); // Unlike opportunistic bush reskin, this must guarantee actual rows on both sides.
assert.ok(decorative.size >= 10, 'A sufficiently long straight caravan road gets real cosmetic hedge rows');
assert.ok(decorative.has('9,8') && decorative.has('11,8'), 'Hedges are placed on both exterior shoulders, not down the middle of the road');
assert.equal(grid[8][9].type, 'grass', 'Decorative Koma bushes do not change the walkable terrain');
assert.strictEqual(roadside.hedgePlan(grid, 'map_southern_cloud_forest'), decorative, 'Streaming chunks share one cached full-zone plan');
assert.ok(roadside.hedgePlan(grid, 'map_western_slope').size >= 10, 'Optional Slagothim routes through the Western Slope also receive cosmetic hedges, without reviving its dead bushes');

const generator = require('../docs/js/wilderness-map-generator.js'); // This is the actual V44 generation pipeline, not a mocked shrub pattern.
const generatedWorkspace = generator.generateWorkspace('review-one', {
  width: 50, height: 50, entrySide: 'north', tradeExitSide: 'south', trees: 20, bushes: 100,
  rivers: 0, ponds: 0, plateaus: 0, ramps: 0, animalDens: 0, caves: 0,
  secretCaves: 0, logs: 0, boulders: 0,
});
const generatedMap = generatedWorkspace.maps.find(map => !map.isSubmap);
const generatedGrid = Array.from({ length: generatedMap.rows }, (_, row) =>
  Array.from({ length: generatedMap.cols }, (_, col) => generatedMap.tiles[col + ',' + row] || { type: 'grass' }));
const actualSites = roadside.hedgePlan(generatedGrid, 'map_southern_cloud_forest');
assert.ok(actualSites.size >= 12, 'The real generated road must produce visible contiguous hedges, not zero random bush matches');
for (const location of actualSites) {
  const [col, row] = location.split(',').map(Number); // Verify the real map retains the underlying walkable tile.
  assert.equal(generatedGrid[row][col].type, 'grass', 'Hedge must not replace a road, resource, cliff, or water tile');
}
assert.ok(roadside.getDebug().lastPlan.runs >= 2, 'Procedural hedge detection should find separate real-world roadside stretches');

const game = read('docs/game.js'); // Executes the real zone vegetation dispatch, not a reimplemented test copy.
const dispatch = game.slice(game.indexOf('              const isDeadTree ='), game.indexOf('              if (isDeadTree || isCrownedPine || isShadewood)'));
assert.ok(dispatch.includes('isKomaHedge') && dispatch.includes('buildKomaHedgeBushMesh'));
assert.match(read('docs/js/foliage-generator.js'), /TREE_PRESETS\.komaHedge\s*=\s*\{[^}]*leafTintS:\s*0,\s*leafTintL:\s*1/, 'Neutral Koma material preserves iridescent source colors');
const funcs = ['buildDeadTreeMesh', 'buildDeadBushMesh', 'buildCrownedPineMesh', 'buildShadewoodMesh', 'buildKomaHedgeBushMesh', 'buildWildernessBushMesh', 'buildStumpMesh', 'buildShrubMesh'];
const FoliageGenerator = Object.fromEntries(funcs.map(name => [name, () => name]));
const render = new Function('window', 'mapId', 'tile', 'EXTERIOR_ZONES', 'c', 'r', 'zGrid', dispatch + '; return vegGroup;');
const runtime = { FoliageGenerator, RoadsideKomaHedges: roadside };
assert.equal(render(runtime, 'map_southern_cloud_forest', grid[8][8], { map_southern_cloud_forest: { cloudForest: true } }, 8, 8, grid), 'buildKomaHedgeBushMesh');
assert.equal(render(runtime, 'map_southern_cloud_forest', grid[17][9], { map_southern_cloud_forest: { cloudForest: true } }, 9, 17, grid), 'buildWildernessBushMesh');
assert.equal(render(runtime, 'map_western_slope', grid[8][8], {}, 8, 8, grid), 'buildDeadBushMesh');
assert.equal(render(runtime, 'map_southern_cloud_forest', { floraKind: 'copse' }, { map_southern_cloud_forest: { cloudForest: true } }, 8, 8, grid), 'buildShadewoodMesh');
assert.ok(game.includes('window.ObjectSpriteCatalog?.ensure?.(key, def)'), 'All inventory HUD/Pack icons use the live item art resolver');
assert.ok(game.includes('window.ObjectSpriteCatalog?.ensure?.(item.key, def)'), 'Held item planes use the same dynamic item-art resolver');
assert.ok(game.includes('window.RoadsideKomaHedges?.hedgePlan?.(zGrid, mapId)'), 'Chunk renderer consumes the deterministic road hedgerow plan');
assert.ok(game.includes('komaBush.userData.roadsideKomaCosmetic = true'), 'Decorative bushes expose their ownership to mobile Pixel Probe');
assert.match(game, /komaCosmeticSites\?\.has\(c \+ ',' \+ r\)/, 'Only planned grid cells render the road bushes');
assert.ok(game.indexOf('komaCosmeticSites?.has(c +') < game.indexOf('if (tile.skipFloor && !CARVED_TILE_TYPES'), 'Roadside plants must not vanish on flat mesa-owned ground');

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

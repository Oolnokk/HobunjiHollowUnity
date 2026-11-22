#!/usr/bin/env node
'use strict';

// Checks the real alchemy, cave and sprite-recolor owners without requiring
// mushroom.png to be uploaded yet. That asset is intentionally user-authored.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || path.join(__dirname, '..'); // Source root used to execute each production module.
const WINDOW = { __farmLog() {} }; // One shared window namespace mirrors browser script ordering in an isolated context.
const context = vm.createContext({ window: WINDOW, console, localStorage: { getItem: () => null } }); // Browser APIs not relevant to these pure generation/recolor paths.
const load = file => vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js', file), 'utf8'), context, { filename: file }); // Execute real source, not copies.
load('alchemy-system.js');
load('cave-site-system.js');
load('color-fill.js');
load('sprite-recolor.js');
load('reagent-plants.js');

const alchemy = WINDOW.AlchemySystem; // Production reagent and trait catalog.
const caves = WINDOW.CaveSiteSystem; // Production biome-aware cave mushroom allocator.
const plants = WINDOW.ReagentPlants; // Production world mushroom sprite constructor.
const reagents = Object.entries(alchemy.REAGENT_DEFS); // Catalog shared by wilderness scatter, cave harvesting and inventory.
const mushrooms = reagents.filter(([, def]) => def.form === 'mushroom');
assert.equal(reagents.length, 28, 'the original 20 ingredients and eight new mushrooms remain');
assert.equal(mushrooms.length, 10, 'Duskcap and Sporecluster plus eight added varieties');
const zones = ['map_northern_cliffs','map_southern_cloud_forest','map_western_slope','map_eastern_mire']; // All four wilderness habitats.
for (const zone of zones) {
  const local = mushrooms.filter(([, def]) => def.zone === zone).map(([key]) => key);
  assert(local.length >= 2, zone + ' must contain at least two mushrooms');
  for (const key of local) {
    assert(alchemy.nativeRecipeForReagent(key), key + ' must have an authored native alchemy reaction');
    assert(['treeRoots','rockEdge','cliffBase','shrubEdge','waterEdge'].includes(alchemy.REAGENT_DEFS[key].habitat),
      key + ' must use the existing habitat placement engine');
  }
  const picks = caves.__test.caveMushroomKeys(zone, zone + ':fixture', 10);
  assert.equal(picks.length, 10);
  assert(picks.every(key => local.includes(key)), 'caves must never spawn a mushroom from another biome');
  assert.deepEqual([...new Set(picks)].sort(), local.sort(), zone + ' cave patches cover every native species');
  assert.deepEqual(caves.__test.caveMushroomKeys(zone, zone + ':fixture', 10), picks, 'stable cave species from seed');
}

const items = {}; // Newly generated reagent item definitions feed the established inventory system.
alchemy.init({ ITEM_DEFS: items });
for (const [key, definition] of mushrooms) {
  assert.equal(items[key].spriteIcon, 'mushroom.png', key + ' shares the user-authored sprite');
  assert.equal(items[key].spriteColor, definition.color, key + ' cap pigment comes from its alchemy reagent');
  assert.equal(items[key].spriteMode, 'mushroom', key + ' selects cap-only keyed recoloring');
  assert(items[key].tags.includes('Reagent') && items[key].tags.includes('Consumable'), key + ' is a normal alchemy item');
}

const original = [0x98,0xe3,0xc7,255, 0xf4,0xf1,0xe5,255, 0x06,0x06,0x06,255, 0x55,0xb9,0x99,128]; // Mint cap, off-white stalk, black ink, shaded cap.
const pixels = new Uint8ClampedArray(original); // SpriteRecolor operates in-place on real RGBA pixel buffers.
WINDOW.SpriteRecolor.recolorImageData(pixels, 0xb34d69, 'mushroom');
assert.notDeepEqual([...pixels.slice(0,3)], original.slice(0,3), 'mint cap recolors to mushroom pigment');
assert.deepEqual([...pixels.slice(4,12)], original.slice(4,12), 'off-white stalk and black outline do not recolor');
assert.deepEqual([...pixels.filter((_, i) => i % 4 === 3)], [255,255,255,128], 'authored alpha remains unchanged');
assert.notDeepEqual([...pixels.slice(12,15)], original.slice(12,15), 'mint shadowed cap pixels also recolor');

class Group { constructor() { this.children = []; this.userData = {}; } add(mesh) { this.children.push(mesh); } } // Lightweight world-card aggregate.
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.rotation = { y: 0 }; this.scale = { set: (...values) => { this.scaling = values; } }; } } // Exposes the same mesh mutation API used by the real world art.
class Geometry { translate() { return this; } } // Reusable ground-anchored plane geometry.
class CanvasTexture { constructor(canvas) { this.canvas = canvas; } } // Shared texture must refer to the returned recolored canvas.
class MeshBasicMaterial { constructor(config) { this.config = config; this.userData = {}; } } // Shared static sprite material.
context.THREE = { Group, Mesh, PlaneGeometry: Geometry, CanvasTexture, MeshBasicMaterial, DoubleSide: 2, NearestFilter: 8 };
let loadCount = 0; // Counts successful recolored canvas requests, independent of mushroom instances.
WINDOW.SpriteRecolor.getRecoloredCanvas = async (spritePath, color, mode) => {
  assert.equal(spritePath, 'assets/objectsprites/mushroom.png');
  assert.equal(mode, 'mushroom');
  assert(Number.isInteger(color));
  loadCount++;
  return { width: 24, height: 32 };
};
plants.init({ _grassBladeGeo: 'legacy-grass', getReagentPlantMaterial: color => ({ color, userData: {} }) });
const a = plants.buildReagentPlantMesh('frostgillMushroom');
const b = plants.buildReagentPlantMesh('frostgillMushroom');
const c = plants.buildReagentPlantMesh('flintcapMushroom');
assert.equal(a.children.length, 2, 'two crossed PNG cards per mushroom plant, without a 3D outline');
assert.equal(a.children[0].geometry, 'legacy-grass', 'missing/pending asset keeps the existing safe grass silhouette');
(async () => {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // Flush the real shared asynchronous material setup.
  assert.equal(loadCount, 2, 'two different mushroom colors cause only two loads, not one per instance');
  assert(a.children.every(mesh => mesh.geometry instanceof Geometry), 'loaded mushroom artwork replaces the grass plane');
  assert(a.children.every(mesh => mesh.material === b.children[0].material), 'same-colored mushroom cards reuse one material');
  assert.notEqual(a.children[0].material, c.children[0].material, 'different species retain different cap pigments');
  assert.equal(plants.diagnosticsSnapshot(zones[0]).mushroomArt.status, 'ready', 'mobile diagnostics expose sprite readiness');
  console.log('PASS mushroom reagents: ten native fungi, cave biodiversity, alchemy, cap-only recolor, shared world art');
})().catch(error => { console.error(error); process.exitCode = 1; });

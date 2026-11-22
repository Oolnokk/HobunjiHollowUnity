#!/usr/bin/env node
'use strict';

// Checks the real alchemy, cave and sprite-recolor owners against the
// user-uploaded mushroom.png as well as the world-mesh material flow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib'); // The uploaded PNG's IDAT stream is decoded for real cap/stalk pixel regression.

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

const original = [0x6b,0x86,0x6b,255, 0xba,0xb9,0xa5,255, 0x06,0x06,0x06,255, 0x99,0xbf,0x99,128]; // Uploaded cap, ivory stalk, ink, pale cap highlight.
const pixels = new Uint8ClampedArray(original); // SpriteRecolor operates in-place on real RGBA pixel buffers.
WINDOW.SpriteRecolor.recolorImageData(pixels, 0xb34d69, 'mushroom');
assert.notDeepEqual([...pixels.slice(0,3)], original.slice(0,3), 'mint cap recolors to mushroom pigment');
assert.deepEqual([...pixels.slice(4,12)], original.slice(4,12), 'off-white stalk and black outline do not recolor');
assert.deepEqual([...pixels.filter((_, i) => i % 4 === 3)], [255,255,255,128], 'authored alpha remains unchanged');
assert.notDeepEqual([...pixels.slice(12,15)], original.slice(12,15), 'pale green cap highlight also recolors');

function decodeAuthoredPng(file) {
  const png = fs.readFileSync(file); // Real artwork, not synthetic fixture pixels or a screenshot from the preview.
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20); // Used to index the exact uploaded cap and stalk.
  assert.equal(png[24], 8, 'mushroom sprite must use 8-bit components');
  assert.equal(png[25], 6, 'mushroom sprite must have true RGBA transparency');
  assert.equal(png[28], 0, 'mushroom sprite must be non-interlaced');
  const parts = []; // PNG can split its DEFLATE stream across multiple IDAT chunks.
  for (let pos = 8; pos + 12 <= png.length;) {
    const length = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') parts.push(png.subarray(pos + 8, pos + 8 + length));
    pos += length + 12;
    if (type === 'IEND') break;
  }
  const packed = zlib.inflateSync(Buffer.concat(parts)); // Reconstruct all PNG scanlines with their original alpha.
  const stride = width * 4, rgba = new Uint8ClampedArray(stride * height); // One contiguous source buffer for production SpriteRecolor.
  let offset = 0; // Current IDAT decompression byte offset.
  for (let row = 0; row < height; row++) {
    const filter = packed[offset++];
    assert(filter >= 0 && filter <= 4, 'supported PNG filter type');
    const rowOffset = row * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[rowOffset + i - 4] : 0;
      const up = row ? rgba[rowOffset + i - stride] : 0;
      const corner = row && i >= 4 ? rgba[rowOffset + i - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - corner;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        predictor = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      rgba[rowOffset + i] = (packed[offset + i] + predictor) & 255;
    }
    offset += stride;
  }
  assert.equal(offset, packed.length, 'every mushroom PNG scanline decoded');
  return { width, height, rgba,
    at: (x, y) => [...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4)] }; // Exact authored color at a known cap, ink or stem pixel.
}
const authored = decodeAuthoredPng(path.join(ROOT, 'docs/assets/objectsprites/mushroom.png')); // User-selected final sprite, not the discarded version.
assert.equal(authored.width, 378);
assert.equal(authored.height, 378);
const capBase = authored.at(180, 50), capLight = authored.at(180, 100); // Dark and highlighted regions of the authored cap.
const ivoryStalk = authored.at(150, 205), stalkHighlight = authored.at(180, 255); // Original neutral stalk pixels.
const ink = authored.at(180, 153), empty = authored.at(20, 40); // Thick black authored outline and transparent world background.
assert(capBase[1] > capBase[0] && capLight[1] > capLight[0], 'both source cap regions must still be green');
assert(ivoryStalk[0] > ivoryStalk[2] && stalkHighlight[0] > stalkHighlight[2], 'source stem retains authored ivory shade');
assert.deepEqual(ink, [0, 0, 0, 255], 'the black negative-space outline remains authored');
assert.equal(empty[3], 0, 'background is really transparent, not a painted black rectangle');
const dyed = new Uint8ClampedArray(authored.rgba); // One actual production-sized recolor: tests cap, stalk, ink and soft-alpha pixels.
WINDOW.SpriteRecolor.recolorImageData(dyed, 0xb34d69, 'mushroom');
const tintedAt = (x, y) => [...dyed.slice((y * authored.width + x) * 4, (y * authored.width + x) * 4 + 4)];
assert.notDeepEqual(tintedAt(180, 50), capBase, 'actual cap base recolors');
assert.notDeepEqual(tintedAt(180, 100), capLight, 'actual cap highlight recolors, not just the shadow');
assert.deepEqual(tintedAt(150, 205), ivoryStalk, 'actual ivory stalk pixels are left unchanged');
assert.deepEqual(tintedAt(180, 255), stalkHighlight, 'stalk highlight is not recolored');
assert.deepEqual(tintedAt(180, 153), ink, 'actual black outline is left unchanged');
assert.deepEqual(tintedAt(20, 40), empty, 'transparent backdrop remains transparent');
let capPixels = 0, tintedCapPixels = 0; // Measures full-cap coverage so a future hue threshold cannot silently miss highlights again.
for (let y = 15; y < 148; y++) for (let x = 25; x < authored.width - 25; x++) {
  const i = (y * authored.width + x) * 4;
  const r = authored.rgba[i], g = authored.rgba[i+1], b = authored.rgba[i+2];
  if (authored.rgba[i+3] < 240 || g <= r * 1.10 || g <= b * 1.10) continue;
  capPixels++;
  if (dyed[i] !== r || dyed[i+1] !== g || dyed[i+2] !== b) tintedCapPixels++;
}
assert(capPixels > 10000 && tintedCapPixels / capPixels > .95,
  'at least 95% of actual colored cap pixels, including the highlight, must accept dye');

// Verify the real SpriteRecolor image-loading path downscales mushroom
// renders only; other authored sprites must keep their established dimensions.
let decodedImages = 0; // The ordinary SpriteRecolor image cache should load one source across multiple tint modes.
class SourceImage {
  constructor() { this.naturalWidth = 378; this.naturalHeight = 378; decodedImages++; }
  set src(path) { assert.equal(path, 'assets/objectsprites/mushroom.png'); queueMicrotask(() => this.onload?.()); }
}
context.Image = SourceImage; // VM Image stand-in provides only source dimensions and async readiness.
context.document = { createElement: tag => {
  assert.equal(tag, 'canvas');
  const canvas = { width: 0, height: 0 };
  canvas.getContext = () => ({
    imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }),
    putImageData: () => {},
  }); // Workload remains bounded to 128px for mushrooms in the actual async canvas creation code.
  return canvas;
} };
const resizeTest = Promise.all([
  WINDOW.SpriteRecolor.getRecoloredCanvas('assets/objectsprites/mushroom.png', 0xb34d69, 'mushroom'),
  WINDOW.SpriteRecolor.getRecoloredCanvas('assets/objectsprites/mushroom.png', 0xb34d69, 'keyed'),
]).then(([mushroomCanvas, otherCanvas]) => {
  assert.equal(mushroomCanvas.width, 128, 'mushroom renders use a small runtime bitmap');
  assert.equal(mushroomCanvas.height, 128, 'the authored square aspect ratio is retained');
  assert.equal(otherCanvas.width, 378, 'non-mushroom sprite modes keep their original resolution');
  assert.equal(otherCanvas.height, 378, 'other item artwork is unaffected');
  assert.equal(decodedImages, 1, 'multiple recolor modes share one source image decode');
});

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
  await resizeTest; // Verify the real async canvas and image cache in addition to the mesh/mat substitutes.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // Flush the real shared asynchronous material setup.
  assert.equal(loadCount, 2, 'two different mushroom colors cause only two loads, not one per instance');
  assert(a.children.every(mesh => mesh.geometry instanceof Geometry), 'loaded mushroom artwork replaces the grass plane');
  assert(a.children.every(mesh => mesh.material === b.children[0].material), 'same-colored mushroom cards reuse one material');
  assert.notEqual(a.children[0].material, c.children[0].material, 'different species retain different cap pigments');
  assert.equal(plants.diagnosticsSnapshot(zones[0]).mushroomArt.status, 'ready', 'mobile diagnostics expose sprite readiness');
  console.log('PASS mushroom reagents: ten native fungi, cave biodiversity, alchemy, cap-only recolor, shared world art');
})().catch(error => { console.error(error); process.exitCode = 1; });

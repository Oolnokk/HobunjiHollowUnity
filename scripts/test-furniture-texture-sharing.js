#!/usr/bin/env node
'use strict';

// three r128 uploads one GPU texture per Texture object. Furniture parts used to
// clone their texture per part per instance, so four identical crate stacks held
// twelve GPU copies of the same 1378x1378 image (~116 MB). Parts that agree on
// file, rotation, repeat and fill must now share one texture, and oversized
// tiling art is scaled once at load.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// ---- minimal fakes ---------------------------------------------------------
class FakeTexture {
  constructor() {
    this.image = null; this.rotation = 0; this.format = 1; this.needsUpdate = false;
    this.wrapS = 0; this.wrapT = 0; this.userData = undefined; this.disposed = false;
    this.repeat = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } };
    this.center = { set() {} };
  }
  clone() { const t = new FakeTexture(); t.image = this.image; t.wrapS = this.wrapS; t.wrapT = this.wrapT; return t; } // r128: shares the image, separate Texture object.
  dispose() { this.disposed = true; }
}
const loads = [];
class FakeLoader { load(url, onLoad) { const texture = new FakeTexture(); loads.push({ url, onLoad, texture }); return texture; } }
const canvasesMade = [];
const document = {
  createElement() {
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
    canvasesMade.push(canvas); return canvas;
  },
};
const window = { getShadeFillCanvas: image => ({ filled: true, width: image.width, height: image.height }) };
const context = vm.createContext({ window, document, performance: { now: () => 0 }, THREE: { TextureLoader: FakeLoader, RepeatWrapping: 1000 }, DEG: Math.PI / 180 });

vm.runInContext(read('docs/js/creature-texture-cache.js'), context, { filename: 'creature-texture-cache.js' });
const cache = window.CreatureTextureCache;

// Run the real texture block: loader cache, finishPartTexture, shared-texture map, applyPartTexture.
const furniture = read('docs/js/procedural-furniture.js');
const start = furniture.indexOf('const _texLoader = new THREE.TextureLoader();');
const end = furniture.indexOf('function buildFurnitureGroup');
assert.ok(start > 0 && end > start, 'found the authored-texture block');
const api = vm.runInContext(`${furniture.slice(start, end)}\n;({ applyPartTexture, shared: typeof _sharedPartTextures === 'undefined' ? null : _sharedPartTextures });`, context, { filename: 'procedural-furniture-textures.js' });

const part = (extra = {}) => ({ materialTexture: 'crate_side.png', ...extra });
const material = () => ({ color: { set() {} }, transparent: false, needsUpdate: false });
const apply = p => { const m = material(); api.applyPartTexture(m, p); return m; };
const bigImage = { width: 1378, height: 1378 };

// ---- sharing, before the base image has loaded -----------------------------
const a = apply(part()), b = apply(part()), c = apply(part());
assert.equal(loads.length, 1, 'the file is requested once');
assert.equal(a.map, b.map, 'identical parts share one texture');
assert.equal(a.map, c.map);
assert.equal(api.shared?.size, 1, 'one shared clone exists');

const rotated = apply(part({ materialRotationDeg: 90 }));
const repeated = apply(part({ materialRepeatU: 3 }));
const repeatedV = apply(part({ materialRepeatV: 2 }));
const filled = apply(part({ materialFillEnabled: true, materialFillColor: '#aa5500' }));
const otherFile = apply({ materialTexture: 'carved_smooth.png' });
const distinct = new Set([a.map, rotated.map, repeated.map, repeatedV.map, filled.map, otherFile.map]);
assert.equal(distinct.size, 6, 'a different rotation, repeat, fill or file gets its own texture');
assert.equal(apply(part({ materialRotationDeg: 90 })).map, rotated.map, 'same rotation shares');
assert.equal(apply(part({ materialRepeatU: 3 })).map, repeated.map, 'same repeat shares');
assert.equal(a.map.repeat.x, 1);
assert.equal(repeated.map.repeat.x, 3, 'per-part repeat is preserved');
assert.ok(Math.abs(rotated.map.rotation - Math.PI / 2) < 1e-9, 'per-part rotation is preserved');
assert.equal(filled.map.userData.furnitureFill, '#aa5500', 'fill metadata is preserved');
assert.equal(a.map.userData.furnitureTexture, 'crate_side.png');
assert.equal(a.map.userData.furnitureShared, true);
assert.equal(a.color && a.needsUpdate, true, 'the material is flagged for update');

// ---- cap and back-fill when the image finally loads ------------------------
const crateLoad = loads.find(l => l.url.endsWith('crate_side.png'));
crateLoad.texture.image = bigImage;
crateLoad.onLoad(crateLoad.texture);
assert.equal(crateLoad.texture.image.width, 512, 'the base image is capped to the furniture bound');
assert.equal(crateLoad.texture.image.height, 512);
for (const m of [a, rotated, repeated, repeatedV]) {
  assert.equal(m.map.image.width, 512, 'every pending clone receives the capped image');
}
assert.equal(filled.map.image.filled, true, 'fill textures are built from the capped image');
assert.equal(filled.map.image.width, 512);

// A part created after the load shares the same texture and is already capped.
const late = apply(part());
assert.equal(late.map, a.map, 'late parts share the texture too');
assert.equal(late.map.image.width, 512);
assert.equal(loads.filter(l => l.url.endsWith('crate_side.png')).length, 1, 'still only one request');

// ---- removing one instance must not free the others' GPU copy --------------
a.map.dispose();
assert.equal(a.map.disposed, false, 'dispose on a shared texture is a no-op');

// ---- the cap itself --------------------------------------------------------
assert.equal(cache.furnitureTextureMaxEdge(), 512, 'default furniture bound');
const small = { image: { width: 250, height: 250 }, needsUpdate: false };
cache.capFurnitureTexture(small);
assert.equal(small.image.width, 250, 'small textures are untouched');
assert.equal(small.needsUpdate, false);
const wide = { image: { width: 2000, height: 1000 }, needsUpdate: false };
cache.capFurnitureTexture(wide);
assert.deepEqual([wide.image.width, wide.image.height], [512, 256], 'aspect ratio is preserved');
assert.equal(wide.needsUpdate, true);
window.SCRATCHBONES_CONFIG = { game: { assets: { furnitureTextureMaxEdge: 256 } } };
assert.equal(cache.furnitureTextureMaxEdge(), 256, 'furnitureTextureMaxEdge config is honored');
window.SCRATCHBONES_CONFIG = { game: { assets: { furnitureTextureMaxEdge: 8 } } };
assert.equal(cache.furnitureTextureMaxEdge(), 512, 'an absurdly small bound is ignored');

// ---- wiring: every crate_side.png loader uses the cap ----------------------
assert.match(read('docs/js/crate-piles.js'), /crate_side\.png',window\.CreatureTextureCache\?\.capFurnitureTexture\)/, 'crate shards are capped');
assert.match(read('docs/js/wild-treasure.js'), /TREASURE_CHEST_TEXTURE_PATH, window\.CreatureTextureCache\?\.capFurnitureTexture\)/, 'treasure chests are capped');
assert.match(read('docs/js/shipping-box-world.js'), /capFurnitureTexture\?\.\(texture\)/, 'the shipping box is capped');
assert.match(furniture, /capFurnitureTexture\?\.\(entry\.base\)/, 'authored furniture is capped');

console.log('furniture texture sharing regression passed');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Color {
  constructor(value = 0x607050) { this.value = value instanceof Color ? value.value : value; }
  clone() { return new Color(this.value); }
  multiplyScalar() { return this; }
  getHex() { return Number(this.value) || 0x607050; }
  set(value) { this.value = value; return this; }
}
class Material {
  constructor(options) {
    this.color = options.color;
    this.emissive = options.emissive;
    this.userData = {};
    this.map = null;
    this.needsUpdate = false;
  }
}
class Basic extends Material {}
class Lambert extends Material {}
class CanvasTexture {
  constructor(image) {
    this.image = image;
    this.repeat = { set: (x, y) => { this.repeat.x = x; this.repeat.y = y; } };
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}
const loads = []; // Records all actual TextureLoader operations before asynchronously resolving them.
let shadeFills = 0; // Verifies that a shared source/color is shade-filled only once.
class Loader {
  load(url, onSuccess, _progress, onError) {
    const texture = new CanvasTexture({ src: url }); // The stubbed decoded source passed to each callback.
    loads.push({ url, onSuccess, onError, texture });
    return texture;
  }
}
const THREE = {
  Color, MeshBasicMaterial: Basic, MeshLambertMaterial: Lambert,
  CanvasTexture, TextureLoader: Loader, RepeatWrapping: 1000, DoubleSide: 2,
};
const tintedMaterials = []; // Verifies that both asynchronous loads and cached texture hits receive seasonal material tint.
const window = {
  SeasonalVegetationTint: {
    tintMaterial(material) {
      tintedMaterials.push(material);
      material.color.set(0x96745a);
    },
  },
};
vm.runInNewContext(fs.readFileSync('docs/js/terrain-tile-materials.js', 'utf8'), {
  window, THREE, console,
  parseHexColor: hex => hex ? { r: 110, g: 120, b: 130 } : null,
  getPortraitTintingConfig: () => ({}),
  getShadeFillCanvas: (_image, id) => { shadeFills++; return { src: id }; },
});
const keys = ['grass', 'weeds', 'shrub', 'trench', 'rock'];
const base = Object.fromEntries(keys.map(key => [key, { color: new Color(0x607050), userData: {} }]));
const finish = {
  grass: { texture: 'wavy_surface.png', tileSize: 8, fillColor: '#d8d8d8' },
  weeds: { texture: 'wavy_surface.png', tileSize: 8, fillColor: '#d8d8d8' },
  shrub: { texture: 'wavy_surface.png', tileSize: 8, fillColor: '#d8d8d8' },
  trench: { texture: 'canvas.png', tileSize: 4, fillColor: '#423d35' },
  rock: { texture: 'wavy_surface.png', tileSize: 4, fillColor: '#d8d8d8' },
};
window.TerrainTileMaterials.init({
  TILE_EMISSIVE_FLOOR: 0.3,
  tileMats: base,
  TileType: { GRASS: 'grass', WEEDS: 'weeds', SHRUB: 'shrub' },
  getTerrainMaterialConfig: () => ({ byMap: { '*': finish } }),
});
const resolver = window.TerrainTileMaterials.resolveTileMat;
const plains = resolver('map_western_slope', 'grass');
const shrubs = resolver('map_western_slope', 'shrub');
const weeds = resolver('map_other_zone', 'weeds');
const trench = resolver('map_other_zone', 'trench');
const rock = resolver('map_other_zone', 'rock');
assert.equal(loads.length, 3, 'three identical grass samplers trigger one load, different PNG/span trigger separate loads');
assert.equal(window.TerrainTileMaterials.debugSnapshot().savedLoads, 2, 'duplicate in-flight requests are counted');
assert.equal(window.TerrainTileMaterials.debugSnapshot().pending, 3);
assert.equal(plains.userData.hobunjiTerrainTextureStatus, 'loading');

for (const request of loads) request.onSuccess(request.texture);
assert.equal(shadeFills, 3, 'the PNG is shade-filled once per source/color/span instead of per map-material');
assert.equal(tintedMaterials.length, 5, 'all new map materials get season-tinted when their shared PNG resolves');
assert.equal(plains.color.value, 0x96745a, 'shared PNG load never leaves a grass material permanently white');
assert.equal(plains.map, shrubs.map, 'grass and shrub share one GPU texture');
assert.equal(plains.map, weeds.map, 'another wilderness zone reuses the same GPU texture');
assert.notEqual(plains.map, rock.map, 'different tile span requires an independent texture sampler');
assert.notEqual(plains.map, trench.map, 'different substrate artwork remains distinct');
assert.equal(plains.map.repeat.x, 1 / 8);
assert.equal(rock.map.repeat.x, 1 / 4);
assert.equal(window.TerrainTileMaterials.debugSnapshot().pending, 0);
assert.equal(window.TerrainTileMaterials.debugSnapshot().sharedTextures, 3);
assert.equal(window.TerrainTileMaterials.isSharedTexture(plains.map), true);
assert.equal(window.TerrainTileMaterials.isCachedMaterial(plains), true);
assert.equal(window.TerrainTileMaterials.isCachedMaterial(base.grass), true,
  'shared native grass fallback survives a zone eviction before the PNG override finishes loading');
assert.equal(window.TerrainTileMaterials.isCachedMaterial(weeds), true);
assert.equal(plains instanceof Basic, true, 'grass uses unlit base material');
assert.equal(weeds instanceof Basic, true, 'vegetation cover uses unlit base material');
assert.equal(trench instanceof Lambert, true, 'soil retains its lit material model');
const subsequent = resolver('map_eastern_mire', 'grass');
assert.equal(subsequent.map, plains.map, 'new zones immediately reuse a completed sampler');
assert.equal(subsequent.color.value, 0x96745a, 'completed texture cache hits apply seasonal tint without a second loader event');
assert.equal(tintedMaterials.length, 6, 'newly attached pooled PNG receives one targeted tint rather than a global rescan');
assert.equal(loads.length, 3, 'already-loaded samplers never re-download');
assert.equal(window.TerrainTileMaterials.debugSnapshot().sourceLoadsStarted, 3);

const raw = window.TerrainTileMaterials.loadTerrainTileTexture('assets/textures/missing.png', 0x604020, 1);
assert.equal(raw.userData.hobunjiTerrainTextureStatus, 'loading');
assert.equal(loads.length, 4);
loads[3].onError(new Error('expected 404'));
assert.equal(raw.userData.hobunjiTerrainTextureStatus, 'failed');
assert.equal(raw.map, null, 'failed artwork preserves the readable fallback material');
const sameFailed = window.TerrainTileMaterials.loadTerrainTileTexture('assets/textures/missing.png', 0x604020, 1);
assert.equal(sameFailed.userData.hobunjiTerrainTextureStatus, 'failed');
assert.equal(loads.length, 4, 'failed source does not create a repeated loading loop');

const game = fs.readFileSync('docs/game.js', 'utf8');
assert.match(game, /TerrainTileMaterials\?\.isCachedMaterial\?\.\(material\)/,
  'zone eviction protects cached per-map materials from disposal');
assert.match(game, /TerrainTileMaterials\?\.isSharedTexture\?\.\(texture\)/,
  'zone eviction protects shared terrain samplers from disposal');
console.log('Terrain texture pooling and zone-eviction contracts passed.');

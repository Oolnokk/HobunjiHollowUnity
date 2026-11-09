'use strict';
const assert = require('node:assert/strict'); // Verifies shared generated texture lifetime during army rig retirement.
const fs = require('node:fs'); // Production module source.
const vm = require('node:vm'); // Browser-shaped test host.
const textures = []; // Captures real allocation/disposal decisions without a GPU.
class Color { constructor() { this.r = 0.3; this.g = 0.8; this.b = 0.7; } getHexString() { return '4fd9c6'; } }
class CanvasTexture { constructor(image) { this.image = image; this.disposals = 0; textures.push(this); } dispose() { this.disposals++; } }
const document = { createElement() { return { getContext() { return { drawImage() {}, getImageData() { return { data: new Uint8ClampedArray([255, 255, 255, 255]) }; }, putImageData() {} }; } }; } }; // Origin-clean one-pixel canvas.
const window = { THREE: { Color, CanvasTexture, Vector3: class {} } }; // Only the material pipeline is exercised.
vm.runInNewContext(fs.readFileSync('docs/js/ghostify.js', 'utf8'), { window, document, console });
const image = { width: 1, height: 1 }; // Shared authored source image, as with species hand/foot textures.
function actor() {
  const original = { map: { image }, onBeforeCompile() {}, customProgramCacheKey() { return "pantsOverlayMask"; }, dispose() {}, clone() { return { map: this.map, color: { set() {}, copy() {} }, dispose() {} }; } }; // Source material must remain owned by the normal avatar disposer.
  const mesh = { isMesh: true, material: original }; // Mesh whose material is replaced and restored.
  const root = { userData: {}, traverse(callback) { callback(mesh); } }; // Independent actor render root.
  return { original, mesh, root };
}
const a = actor(), b = actor(); // Two characters share the recolored map but not materials.
window.Ghostify.apply(a.root); window.Ghostify.apply(b.root);
assert.equal(textures.length, 1); assert.equal(a.mesh.material.map, b.mesh.material.map);
assert.equal(a.mesh.material.onBeforeCompile, a.original.onBeforeCompile, "spectral clothes preserve garment shaders");
assert.equal(a.mesh.material.customProgramCacheKey, a.original.customProgramCacheKey);
window.Ghostify.restore(a.root, { disposeTextures: true });
assert.equal(textures[0].disposals, 0, 'another ghost still owns the generated texture');
assert.equal(a.mesh.material, a.original);
window.Ghostify.restore(b.root, { disposeTextures: true });
assert.equal(textures[0].disposals, 1, 'last retiring actor releases the GPU map');
const c = actor(); // Rematerialization must not resurrect a disposed texture from the cache.
window.Ghostify.apply(c.root); assert.equal(textures.length, 2); assert.equal(c.mesh.material.map, textures[1]);
window.Ghostify.restore(c.root); // Ordinary reversible treatment intentionally retains its reusable cache.
assert.equal(textures[1].disposals, 0);
window.Ghostify.apply(c.root); assert.equal(textures.length, 2);
window.Ghostify.restore(c.root, { disposeTextures: true }); assert.equal(textures[1].disposals, 1);
window.Ghostify.restore(c.root, { disposeTextures: true }); assert.equal(textures[1].disposals, 1, 'repeated disposal is harmless');
console.log('Ghostify shared texture references, eviction, rematerialization and reversible cache passed.');

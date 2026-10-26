#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CUTOFF = 0.35; // Configured minimum alpha coverage that may occlude another rendered surface.
const original = () => ({ map: { isTexture: true }, transparent: true, alphaTest: 0.001, depthWrite: false, depthTest: true, depthFunc: 7, colorWrite: true }); // A soft visible PNG face which needs a solid depth-only silhouette.

{
  const window = { HobunjiSpritePngSurface: { maskAlphaTest: () => CUTOFF } }; // Supplies the real exported PNG mask contract to the depth replay.
  const THREE = { LessEqualDepth: 3 }; // Only the renderer's depth function constant is needed.
  const source = fs.readFileSync('docs/js/png-plane-outline-occluder.js', 'utf8');
  vm.runInNewContext(source, { window, THREE });
  const scene = { isScene: true };
  const material = original();
  const mesh = {
    isMesh: true, userData: {}, visible: true, parent: scene, material,
    layers: { mask: 1, enable(bit) { this.mask |= 1 << bit; }, disable(bit) { this.mask &= ~(1 << bit); } },
    traverse(fn) { fn(this); },
  }; // Minimal live PNG-plane object that reaches the registry and replay.
  let depthDraws = 0; // Records depth calls so tests cannot pass without executing the replay.
  const renderer = { render() {
    depthDraws++;
    assert.equal(material.alphaTest, CUTOFF, 'outline depth uses solid sprite coverage');
    assert.equal(material.depthWrite, true);
    assert.equal(material.colorWrite, false);
  } };
  const camera = { layers: { mask: 1, set(bit) { this.mask = 1 << bit; } } }; // Simulates THREE.Layers during a temporary outline-only camera pass.
  window.PngPlaneOutlineOccluder.markPngPlane(mesh);
  window.PngPlaneOutlineOccluder.init({ renderer, camera });
  window.PngPlaneOutlineOccluder.renderDepth(scene);
  assert.equal(depthDraws, 1, 'the registered sprite is replayed exactly once');
  assert.equal(material.alphaTest, 0.001, 'depth cutoff must not leak into the visible soft-edge draw');
  assert.equal(material.depthWrite, false);
  assert.equal(material.colorWrite, true);
  assert.equal(material.depthFunc, 7);
  assert.equal(camera.layers.mask, 1, 'camera layer state is restored');
}
{
  const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');
  const start = source.indexOf('  function saveMaterialState(');
  const end = source.indexOf('  function prepareHeldStencilMaterials(', start);
  assert(start > 0 && end > start, 'the held compositor retains its material replay utilities');
  const window = { HobunjiSpritePngSurface: { maskAlphaTest: () => CUTOFF } };
  const PNG_OCCLUDER_LAYER = 4; // Mirrors the real renderer's layer constant.
  const context = {
    window, PNG_OCCLUDER_LAYER,
    hasLayer: (object, layer) => !!(object.layers.mask & (1 << layer)),
    isProtectedCover: object => object.protectedCover === true,
    forEachMaterial: (material, fn) => (Array.isArray(material) ? material : [material]).forEach(fn),
  }; // Production helpers are evaluated directly while unrelated renderer/scene setup is stubbed.
  const helpers = vm.runInNewContext(source.slice(start, end) +
    '\n({ prepareCutoutDepthMaterials, prepareNonGroundDepthMaterials, restoreMaterialStates })', context);

  const portraitMaterial = original();
  const portrait = { isMesh: true, layers: { mask: 1 << PNG_OCCLUDER_LAYER }, material: portraitMaterial };
  const coverMaterial = { map: { isTexture: true }, alphaTest: 0.02, depthWrite: false };
  const cover = { isMesh: true, layers: { mask: 1 }, protectedCover: true, material: coverMaterial };
  let states = helpers.prepareCutoutDepthMaterials([portrait], [cover]);
  assert.equal(portraitMaterial.alphaTest, CUTOFF, 'fast-path held depth reconstruction ignores translucent fringe');
  assert.equal(portraitMaterial.depthWrite, true);
  assert.equal(coverMaterial.alphaTest, 0.02, 'water/slush/foliage retain their own depth alpha coverage');
  helpers.restoreMaterialStates(states);
  assert.equal(portraitMaterial.alphaTest, 0.001, 'fast-path cutoff must be restored');
  assert.equal(portraitMaterial.depthWrite, false);
  assert.equal(coverMaterial.depthWrite, false);

  const scene = { traverseVisible: callback => { callback(portrait); callback(cover); } }; // Forces the fallback compositor path without the optimized color-write lock.
  states = helpers.prepareNonGroundDepthMaterials(scene);
  assert.equal(portraitMaterial.alphaTest, CUTOFF, 'fallback held depth reconstruction also rejects fringe');
  assert.equal(coverMaterial.alphaTest, 0.02, 'fallback cover cutoff remains authored');
  helpers.restoreMaterialStates(states);
  assert.equal(portraitMaterial.alphaTest, 0.001, 'fallback cutoff must be restored');
  assert.equal(portraitMaterial.depthWrite, false);
  assert.equal(portraitMaterial.colorWrite, true);
}
console.log('PNG depth-only outline and held-overlay alpha masks passed.');

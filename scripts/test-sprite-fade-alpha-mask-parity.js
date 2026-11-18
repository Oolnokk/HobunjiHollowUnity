#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const softSurface = { alphaTest: () => 0.001 }; // Normal sprite alpha test for color-only translucent effects.
const makeSourceMaterial = () => ({
  name: 'npc_avatar_front_material', map: { id: 'png' }, alphaTest: 0.35,
  opacity: 1, depthWrite: true, depthTest: true, transparent: true,
  clone() { return { ...this, dispose() {} }; },
}); // Models a portrait created by the shared 35% solid-depth material factory.

{
  const source = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8');
  const start = source.indexOf('  function cloneAfterimageMaterial(');
  const end = source.indexOf('  function disposeAfterimage(', start);
  assert(start >= 0 && end > start, 'Blink Dodge keeps its afterimage material builder');
  const build = vm.runInNewContext(source.slice(start, end) + '\ncloneAfterimageMaterial', {
    window: { HobunjiSpritePngSurface: softSurface },
    AFTERIMAGE_BASE_OPACITY: 0.34, // The real afterimage opacity, below the solid sprite mask threshold.
    freezeAfterimageTexture: texture => ({ ...texture, dispose() {} }), // Supplies an independent map as the production afterimage freeze does.
  });
  const record = build(makeSourceMaterial());
  assert(record && record.material.map, 'the afterimage retains its frozen PNG map');
  assert.equal(record.material.opacity, 0.34);
  assert.equal(record.material.depthWrite, false);
  assert.equal(record.material.alphaTest, 0.001, 'afterimage fragments remain visible below the solid-mask threshold');
}
{
  const source = fs.readFileSync('docs/js/cinematic-camera-runtime.js', 'utf8');
  const start = source.indexOf('  function captureFadeMaterials(');
  const end = source.indexOf('  function restorePetMaterials(', start);
  assert(start >= 0 && end > start, 'cinematic pet fade helpers remain available');
  const initial = makeSourceMaterial();
  const mesh = { isMesh: true, parent: {}, material: initial }; // A live pet PNG mesh that fades for a cinematic shot.
  const root = { traverse(fn) { fn(mesh); } };
  const fadedMaterials = new Map(); // Captures temporary clones and their exact pre-fade material states.
  const api = vm.runInNewContext(source.slice(start, end) + '\n({ applyPetOpacity, restoreFadeEntry })', {
    window: { HobunjiSpritePngSurface: softSurface },
    fadedMaterials, capturedRoots: new Set(), petRoots: () => [root],
  });
  api.applyPetOpacity(0.5);
  assert.equal(mesh.material.depthWrite, false, 'faded pets stop stamping depth');
  assert.equal(mesh.material.alphaTest, 0.001, 'faded pets retain their semi-transparent pixels');
  assert.equal(mesh.material.opacity, 0.5);
  api.applyPetOpacity(1);
  assert.equal(mesh.material.alphaTest, 0.35, 'fully visible pets regain solid PNG depth masks');
  assert.equal(mesh.material.depthWrite, true);
  api.restoreFadeEntry(mesh, fadedMaterials.get(mesh));
  assert.equal(mesh.material, initial, 'cinematic cleanup restores the original non-clone material');
}
console.log('Blink afterimages and cinematic pet-fade PNG alpha thresholds passed.');

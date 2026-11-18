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
  const start = source.indexOf('  function makeSmearMaterial(');
  const end = source.indexOf('  function disposeSmear(', start);
  assert(start >= 0 && end > start, 'Blink Dodge exposes its color-preserving smear material builder');
  const build = vm.runInNewContext(source.slice(start, end) + '\nmakeSmearMaterial');
  const original = makeSourceMaterial(); // Retains the live source map and opaque alpha-mask settings.
  const record = build(original);
  assert(record && record.material.map, 'the smear has the character source PNG map');
  assert.strictEqual(record.material.map, original.map, 'color and patterns share the live source map instead of being re-uploaded');
  assert.equal(original.alphaTest, 0.35, 'the character material is never mutated');
  assert.equal(record.material.opacity, 1, 'RGBA fade is a shader uniform, not an RGB multiplier');
  assert.equal(record.material.depthWrite, false);
  assert.equal(record.material.alphaTest, 0.001, 'soft, semitransparent silhouette pixels survive the solid sprite threshold');

  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <skinning_vertex>',
    fragmentShader: '#include <common>\n#include <premultiplied_alpha_fragment>',
  }; // Calls the real compiler hook with representative r128 shader chunks.
  record.material.onBeforeCompile(shader, {});
  assert.strictEqual(shader.uniforms.uSmearOpacity, record.uniforms.opacity);
  assert.match(shader.fragmentShader, /gl_FragColor\.a \*= uSmearOpacity \* smoothstep/,
    'the soft silhouette fades the output alpha channel only');
  assert(
    shader.fragmentShader.indexOf('gl_FragColor.a *=') < shader.fragmentShader.indexOf('#include <premultiplied_alpha_fragment>'),
    'alpha fade precedes RGB premultiplication to avoid color halos'
  );
  assert.doesNotMatch(shader.fragmentShader, /gl_FragColor\.rgb\s*=/, 'source RGB is never replaced');
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

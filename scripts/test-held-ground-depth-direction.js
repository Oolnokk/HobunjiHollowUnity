#!/usr/bin/env node
'use strict';

// A ground material can be colored in the wilderness but have depthWrite:false.
// That is allowed in the base world pass, but must not make held tools x-ray
// through the floor: held parts always use ordinary solid-world depth.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');

const start = source.indexOf('  function forceGroundDepthForHeldReplay(');
const end = source.indexOf('  function hideOrdinaryDepthRedraws(', start);
assert(start >= 0 && end > start, 'real held ground-depth helper is present');
const saveMaterialState = (saved, material) => {
  if (!saved.has(material)) saved.set(material, { depthWrite: material.depthWrite });
};
const force = new Function('saveMaterialState', source.slice(start, end) +
  '\nreturn forceGroundDepthForHeldReplay;')(saveMaterialState);
const restore = saved => {
  for (const [material, state] of saved) material.depthWrite = state.depthWrite;
};

const eligible = { depthWrite: false, userData: { hobunjiXrayElevationShader: { supported: true } } };
const alreadySolid = { depthWrite: true, userData: { hobunjiXrayElevationShader: { supported: true } } };
const unsupported = { depthWrite: false, userData: { hobunjiXrayElevationShader: { supported: false, compileAttempted: true } } };
const coldCompile = { depthWrite: false, userData: { hobunjiXrayElevationShader: { supported: false, compileAttempted: false } } }; // Shader not yet compiled during first world frame.
const unrelated = { depthWrite: false, userData: {} };
const materials = new Set([eligible, alreadySolid, unsupported, coldCompile]); // This set comes exclusively from the registered ground meshes.
const saved = new Map();
assert.equal(force(materials, saved), 3,
  'all registered ground without depth writes is repaired, even on the first frame or after shader fallback');
assert.equal(eligible.depthWrite, true, 'visible wilderness floor participates in the held depth-only replay');
assert.equal(saved.get(eligible).depthWrite, false, 'the original material depth flag is saved');
assert.equal(unsupported.depthWrite, true,
  'unsupported shaders fail closed with ordinary ground occlusion, not accidental x-ray outside the circle');
assert.equal(coldCompile.depthWrite, true,
  'first-frame ground depth does not depend on an already compiled elevation shader');
assert.equal(unrelated.depthWrite, false, 'unregistered transparent materials are not passed to the ground-only override');
assert.equal(alreadySolid.depthWrite, true, 'already solid materials remain unchanged');
assert.equal(force(materials, saved), 0, 'multiple groups do not save/rewrite an already repaired material');
restore(saved);
assert.equal(eligible.depthWrite, false, 'the original wilderness material is restored for regular rendering');
assert.equal(unsupported.depthWrite, false, 'fallback material recovers its original world draw setting');
assert.equal(coldCompile.depthWrite, false, 'uncompiled material recovers its original world draw setting');

// The replay's source wiring: every held part is ordinary, and missing ground depth is repaired for it.
assert.match(source, /if \(ordinaryGroundMaterials\.size\) lastForcedGroundDepthMaterials \+= forceGroundDepthForHeldReplay\(ordinaryGroundMaterials, depthMaterialStates\);/,
  'ordinary above-floor equipment rebuilds missing ground depth instead of x-raying through the floor');
assert.match(source, /hideOrdinaryDepthRedraws\(scene, cutoutDepthMeshes, protectedDepthMeshes, ordinaryGroundMeshes, ordinarySnapshot, originalCameraMask\)/,
  'the optimized ordinary replay retains the precise ground leaves whose base material omitted depth');
assert.match(source, /restoreMaterialStates\(depthMaterialStates\);/,
  'material state returns to normal after the colorless depth draw');
assert.match(source, /forcedGroundDepthMaterials: lastForcedGroundDepthMaterials/,
  'the mobile debug snapshot exposes whether any missing ground depth was repaired');

console.log('held ground depth: ordinary gear never sees through the floor; missing wilderness ground depth is repaired and restored');

#!/usr/bin/env node
'use strict';

// A ground material can be colored in the wilderness but have depthWrite:false.
// That is allowed in the base world pass, but must not make held tools x-ray
// through the floor OUTSIDE the actor's local ground exception.
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

// The filter's actual two modes remain directional: a ground fragment within
// the circle is omitted from depth rebuilding; outside the circle it writes.
const shaderStart = source.indexOf('  function installGroundElevationShader(');
const shaderEnd = source.indexOf('  function isRoadXrayMesh(', shaderStart);
assert(shaderStart >= 0 && shaderEnd > shaderStart);
const shaderCode = source.slice(shaderStart, shaderEnd);
assert.ok(shaderCode.includes('dot(offsetFromActor, offsetFromActor) <= ${(XRAY_CIRCLE_RADIUS * XRAY_CIRCLE_RADIUS).toFixed(6)}'),
  'the authored three-tile circle has not been expanded or inverted');
assert.match(shaderCode, /if \(uHobunjiXrayElevationEnabled > 1\.5\) \{ if \(hobunjiXrayNearFloor < 0\.5\) discard; \}/,
  'mode 2 still isolates the local floor for stencil punching');
assert.match(shaderCode, /else if \(hobunjiXrayNearFloor > 0\.5\) discard;/,
  'mode 1 removes the local floor when reconstructing depth for held gear');
const testDistance = (x, z) => x * x + z * z <= 2.25;
assert.equal(!testDistance(0.5, 0.5), false, 'inside ground is excluded from the depth rebuild');
assert.equal(!testDistance(2.5, 0.5), true, 'outside ground must be able to occlude the weapon');

assert.match(source, /if \(group\.regions\.length\) lastForcedGroundDepthMaterials \+= forceGroundDepthForHeldReplay\(groundMaterials, depthMaterialStates\);/,
  'the local floor-exception path rebuilds its registered ground depth');
assert.match(source, /else if \(ordinaryGroundMaterials\.size\) lastForcedGroundDepthMaterials \+= forceGroundDepthForHeldReplay\(ordinaryGroundMaterials, depthMaterialStates\);/,
  'ordinary above-floor equipment also rebuilds missing ground depth instead of x-raying outside the circle');
assert.match(source, /hideOrdinaryDepthRedraws\(scene, cutoutDepthMeshes, protectedDepthMeshes, ordinaryGroundMeshes, ordinarySnapshot, originalCameraMask\)/,
  'the optimized ordinary replay retains the precise ground leaves whose base material omitted depth');
assert.match(source, /restoreMaterialStates\(depthMaterialStates\);/,
  'material state returns to normal after the colorless depth draw');
assert.match(source, /forcedGroundDepthMaterials: lastForcedGroundDepthMaterials/,
  'the mobile debug snapshot exposes whether any missing ground depth was repaired');

console.log('held ground x-ray direction: outside has real ground depth, inside keeps the authored floor exception');

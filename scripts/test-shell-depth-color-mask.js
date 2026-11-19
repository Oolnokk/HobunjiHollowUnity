#!/usr/bin/env node
'use strict';

// Execute the actual shell depth-preparation and GL color-mask helpers.
// Ordinary shell passes and interrupted draws must retain their old behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/js/held-object-render-order.js'), 'utf8');
function section(begin, end) {
  const first = source.indexOf(begin), last = source.indexOf(end, first + begin.length);
  assert(first >= 0 && last > first, 'production section exists: ' + begin);
  return source.slice(first, last);
}

const customBeforeDraw = function customBeforeDraw() {}; // Hook that recognizes colorWrite:false as a depth replay.
const originalBeforeDraw = function originalBeforeDraw() {}; // Object3D default, not an authored callback.
const dependency = {
  objectProto: { onBeforeRender: originalBeforeDraw },
  hasLayer: (object, layer) => !!(object.layers.mask & (1 << layer)),
  PNG_OCCLUDER_LAYER: 4,
  forEachMaterial: (material, callback) => (Array.isArray(material) ? material : [material]).forEach(callback),
  saveMaterialState(states, material) {
    if (!states.has(material)) states.set(material, {
      colorWrite: material.colorWrite, depthWrite: material.depthWrite,
    });
  },
  setSurfaceOcclusionDepthOnly: (material, enabled) => { material.depthOnly = enabled; },
  isProtectedCover: object => object.kind === 'cover',
  useSpriteOcclusionCutout: (object, material) => { material.cutoutSeen = true; },
};

const runtime = new Function('d', [
  'const {objectProto,hasLayer,PNG_OCCLUDER_LAYER,forEachMaterial,saveMaterialState,setSurfaceOcclusionDepthOnly,isProtectedCover,useSpriteOcclusionCutout}=d;',
  'let shellOpaqueMaterialWritesAvoided=0, shellMaskedDepthDraws=0;',
  section('  function isStillVisibleForShellReplay(', '  function collectShellReplayCandidates('),
  section('  function prepareNonGroundDepthMaterials(', '  function prepareCutoutDepthMaterials('),
  section('  function withShellDepthColorMask(', '  // Replays shell outlines for the same meshes'),
  'return {prepareNonGroundDepthMaterials,withShellDepthColorMask,counts:()=>({shellOpaqueMaterialWritesAvoided,shellMaskedDepthDraws})};',
].join('\n'))(dependency);

const makeMesh = (material, extra = {}) => ({
  isMesh: true, visible: true, layers: { mask: 1 }, material,
  onBeforeRender: originalBeforeDraw, userData: {}, ...extra,
});
const opaque = { colorWrite: true, depthWrite: true, alphaTest: 0 };
const cutout = { colorWrite: true, depthWrite: false, alphaTest: 0.35 };
const covered = { colorWrite: true, depthWrite: false, alphaTest: 0 };
const hooked = { colorWrite: true, depthWrite: true, alphaTest: 0 };
const star = { colorWrite: true, depthWrite: false, alphaTest: 0 };
const sky = { isSprite: true, visible: true, layers: { mask: 1 }, material: star,
  onBeforeRender: originalBeforeDraw, userData: { hobunjiNoOutline: true } };
const nodes = [
  makeMesh(opaque),
  makeMesh(cutout, { layers: { mask: 1 | (1 << 4) } }),
  makeMesh(covered, { kind: 'cover' }),
  makeMesh(hooked, { onBeforeRender: customBeforeDraw }),
  sky,
];
const scene = { visible: true, traverseVisible(callback) {
  for (const node of nodes) callback(node);
} };
for (const node of nodes) node.parent = scene;
function restore(states) {
  for (const [material, state] of states) Object.assign(material, state);
}

const fast = runtime.prepareNonGroundDepthMaterials(scene, nodes, true);
assert(!fast.has(opaque), 'ordinary opaque material is never snapshotted or rewritten');
assert(!fast.has(star), 'celestial sprite uses the GPU color mask, not a material transaction');
assert.equal(opaque.colorWrite, true);
assert.equal(star.colorWrite, true);
assert.equal(cutout.colorWrite, false, 'PNG cutout still receives depth-only parity state');
assert.equal(cutout.depthWrite, true, 'PNG cutout still blocks held parts');
assert.equal(cutout.cutoutSeen, true, 'sprite cutout mask policy still runs');
assert.equal(covered.depthWrite, true, 'protected covers still write depth');
assert.equal(covered.depthOnly, true, 'surface depth-only shader still runs');
assert.equal(hooked.colorWrite, false, 'custom rendering hooks still see colorWrite:false');
assert.equal(runtime.counts().shellOpaqueMaterialWritesAvoided, 2);
restore(fast);

const legacy = runtime.prepareNonGroundDepthMaterials(scene, nodes);
assert(legacy.has(opaque) && legacy.has(star), 'unsupported GPUs retain every original material transaction');
assert.equal(opaque.colorWrite, false);
assert.equal(star.colorWrite, false);
restore(legacy);

const calls = [];
let mask = true, locked = false;
const color = {
  setMask(value) { mask = value; calls.push('mask:' + value); },
  setLocked(value) { locked = value; calls.push('locked:' + value); },
};
assert.equal(runtime.withShellDepthColorMask(color, () => {
  assert.equal(mask, false);
  assert.equal(locked, true);
  return 'masked';
}), 'masked');
assert.equal(mask, true);
assert.equal(locked, false);
assert.deepEqual(calls, ['mask:false','locked:true','locked:false','mask:true']);

assert.throws(() => runtime.withShellDepthColorMask(color, () => { throw Error('interrupted depth'); }), /interrupted depth/);
assert.equal(mask, true, 'GPU color writes restored after an exception');
assert.equal(locked, false, 'GPU color state unlocked after an exception');
assert.equal(runtime.withShellDepthColorMask(null, () => 'fallback'), 'fallback');
assert.equal(runtime.counts().shellMaskedDepthDraws, 1, 'only completed GPU-masked draws increment the counter');

const shell = section('  function replayShellOutlineXray(', '  function wrappedRender(');
assert.match(shell, /prepareNonGroundDepthMaterials\(scene, replayCandidates\.depth, canMaskShellColor\)/);
assert.equal((shell.match(/withShellDepthColorMask\(canMaskShellColor \? shellColorBuffer : null,/g) || []).length, 3,
  'all three shell depth submission paths (group, snapshot, fallback) are color-masked');
assert.equal((shell.match(/rawRender\.call\(renderer, scene, camera\)/g) || []).length, 4,
  'the outline color pass stays unmasked while all three depth paths are wrapped');
assert.match(source, /shellMaskedDepthDraws, shellOpaqueMaterialWritesAvoided/, 'counters are available on mobile');

console.log('shell GPU color-mask, custom draw hooks, legacy fallback and interrupted draw tests passed');

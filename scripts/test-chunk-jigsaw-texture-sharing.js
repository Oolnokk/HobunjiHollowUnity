'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let textureClones = 0;
function vector() { return { set(x, y) { this.x = x; this.y = y; } }; }
function texture(image = { width: 2048, height: 2048 }) {
  return { image, userData: {}, repeat: vector(), offset: vector(), center: vector(), disposals: 0,
    clone() { textureClones++; return texture(this.image); }, dispose() { this.disposals++; },
  };
}
function material(map) {
  const listeners = [];
  return { map, userData: {}, clone() { return material(this.map); },
    addEventListener(name, fn) { assert.equal(name, 'dispose'); listeners.push(fn); },
    dispose() { for (const fn of listeners) fn(); },
  };
}
const source = fs.readFileSync('docs/js/terrain-render-chunks.js', 'utf8');
const a = source.indexOf('  const chunkJigsawTextures'), b = source.indexOf('  class MinHeap', a);
const context = { THREE: { RepeatWrapping: 1000, ClampToEdgeWrapping: 1001 }, WeakMap, Map };
vm.runInNewContext(source.slice(a, b) + '\nthis.clone = cloneJigsawMaterial; this.stats = () => ({ textures: chunkJigsawTextureCount, refs: chunkJigsawTextureRefs });', context);
const original = texture(), mat = material(original);
const floors = Array.from({ length: 1000 }, () => context.clone(mat, false, true));
assert.equal(textureClones, 1, 'one thousand chunk meshes use one texture clone');
assert.equal(context.stats().refs, 1000);
assert.equal(floors[0].map.image, original.image, 'native source pixels remain unchanged');
assert.equal(floors[0].map.repeat.x, 1); assert.equal(floors[0].map.offset.x, 0);
const wall = context.clone(mat, true, true);
assert.notEqual(wall.map, floors[0].map, 'different wrapping keeps a separate sampler');
assert.equal(wall.map.wrapS, 1000); assert.equal(floors[0].map.wrapS, 1001);
for (let i = 0; i < 999; i++) { floors[i].dispose(); floors[i].dispose(); }
assert.equal(floors[999].map.disposals, 0, 'unloading earlier chunks cannot dispose a remaining chunk map');
floors[999].dispose();
assert.equal(floors[999].map.disposals, 1);
assert.equal(original.disposals, 0, 'the shared source cache retains ownership of the original');
wall.dispose(); assert.equal(context.stats().textures, 0); assert.equal(context.stats().refs, 0);
const rebuilt = context.clone(mat, false, true);
assert.notEqual(rebuilt.map, floors[0].map, 'returning to an unloaded region gets a fresh live sampler');
rebuilt.dispose();
const standaloneA = context.clone(mat, false), standaloneB = context.clone(mat, false);
assert.notEqual(standaloneA.map, standaloneB.map, 'tools and non-chunk callers retain independent ownership');

// Execute both actual chunk cleanup owners, which must release shared maps via their materials.
for (const file of ['docs/game.js', 'docs/js/wilderness-chunks.js']) {
  const code = fs.readFileSync(file, 'utf8');
  const start = file === 'docs/game.js' ? code.indexOf('        const disposeRuntimeChunk = record => {') : code.indexOf('  function disposeTaggedChunkObjects(group)');
  const end = file === 'docs/game.js' ? code.indexOf('        const arrivalCol', start) : code.indexOf('  function makeDebugCage', start);
  const setup = { window: {}, group: null };
  vm.runInNewContext(code.slice(start, end) + (file === 'docs/game.js' ? '\nthis.clean = record => disposeRuntimeChunk(record);' : '\nthis.clean = record => disposeTaggedChunkObjects(record.group);'), setup);
  const sharedA = context.clone(mat, false, true), sharedB = context.clone(mat, false, true);
  const sharedMap = sharedA.map;
  const mesh = { userData: { wildernessChunkOwnsGeometry: true, wildernessChunkOwnsMaterial: true }, geometry: { dispose() {} }, material: sharedA };
  setup.clean({ group: { traverse(fn) { fn(mesh); } } });
  assert.equal(sharedMap.disposals, 0, `${file} preserves a map owned by another chunk`);
  sharedB.dispose(); assert.equal(sharedMap.disposals, 1);
}
console.log('shared chunk jigsaw samplers, native pixels, final-owner release and cleanup wiring passed');

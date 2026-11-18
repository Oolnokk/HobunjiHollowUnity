#!/usr/bin/env node
'use strict';
// The actual corpse-only rasterizer must use the FINAL skinned pants grid,
// not the spread-leg authoring PNG, and never change live pants mesh budgets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/corpse-posed-pants-snapshot.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const corpse = fs.readFileSync(path.join(root, 'docs/js/bandit-corpse-retirement.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'docs/js/pants-garment-renderer.js'), 'utf8');
const avatar = fs.readFileSync(path.join(root, 'docs/js/png-plane-avatar.js'), 'utf8');

assert(index.indexOf('js/corpse-posed-pants-snapshot.js?v=') >= 0, 'corpse compositor is included in the shipped game');
assert(index.indexOf('js/corpse-posed-pants-snapshot.js?v=') < index.indexOf('js/bandit-corpse-retirement.js?v='), 'compositor loads before retirement');
assert(corpse.includes('CorpsePosedPantsSnapshot?.capture?.(canvas, rig)'), 'the real retirement path paints posed pants');
assert.match(avatar, /pantsSegments: 64\b/, 'living player pants are unchanged');
assert.match(avatar, /pantsSegments: 32\b/, 'living NPC pants are unchanged');
assert.match(renderer, /const DEFAULT_SEGMENTS = 64;/, 'renderer full grid is unchanged');
assert.match(renderer, /const NPC_SEGMENTS = 32;/, 'renderer NPC grid is unchanged');

class Vector3 {
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  applyMatrix4(matrix) {
    const shift = matrix.shift || { x: 0, y: 0 };
    this.x += shift.x || 0; this.y += shift.y || 0;
    return this;
  }
}
class Matrix4 {
  copy(matrix) { this.shift = matrix.shift || { x: 0, y: 0 }; return this; }
  invert() { this.shift = { x: -(this.shift.x || 0), y: -(this.shift.y || 0) }; return this; }
  multiply(other) { this.shift.x += other.shift?.x || 0; this.shift.y += other.shift?.y || 0; return this; }
}
function testCanvas() {
  const drawing = { draws: [], transforms: [], composites: [] }; // Verifies each triangle uses the authored fabric texture at a posed destination.
  let operation = 'source-over'; // Tracks torso/hood mask subtraction on the garment layer.
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
    transform(...args) { drawing.transforms.push(args); },
    drawImage(...args) { drawing.draws.push({ source: args[0], operation }); },
    get globalCompositeOperation() { return operation; },
    set globalCompositeOperation(value) { operation = value; drawing.composites.push(value); },
  };
  return { width: 256, height: 256, getContext: () => ctx, drawing };
}

const canvases = []; // Holds the one temporary garment layer used by each captured corpse.
const environment = {
  window: { THREE: { Vector3, Matrix4 } },
  document: { createElement(tag) {
    assert.equal(tag, 'canvas');
    const c = testCanvas();
    canvases.push(c);
    return c;
  } },
};
vm.runInNewContext(source, environment, { filename: 'corpse-posed-pants-snapshot.js' });
const painter = environment.window.CorpsePosedPantsSnapshot;
assert(painter?.capture && painter?.rasterize, 'standalone helper is installed');

const SEGMENTS = 32; // The unmodified NPC pants grid that the corpse-only 14x14 sample reduces.
const clothing = { width: 100, height: 100, id: 'spread-leg-source-png' }; // The same image must be warped instead of drawn flat.
const overpass = { width: 256, height: 256, id: 'upper-body-mask' }; // Cloth beneath torso/arms/hood stays correctly occluded.

function buildRig(poseScale) {
  const xyz = new Float32Array((SEGMENTS + 1) ** 2 * 3);
  const uv = new Float32Array((SEGMENTS + 1) ** 2 * 2);
  for (let row = 0; row <= SEGMENTS; row++) {
    for (let col = 0; col <= SEGMENTS; col++) {
      const i = row * (SEGMENTS + 1) + col;
      xyz[i * 3] = col / SEGMENTS - 0.5;
      xyz[i * 3 + 1] = 0.5 - row / SEGMENTS;
      uv[i * 2] = col / SEGMENTS;
      uv[i * 2 + 1] = 1 - row / SEGMENTS;
    }
  }
  const calls = []; // Records the per-corpse CPU skin and GPU restoration, never a global living rig setting.
  const pants = {
    mesh: { matrixWorld: {}, updateWorldMatrix() {} },
    texture: { image: clothing }, maskTexture: { image: overpass },
    geometry: { getAttribute(name) { return name === 'position' ? { array: xyz } : { array: uv }; } },
    segments: SEGMENTS, disposed: false, ready: true, gpuSkinOption: true, gpuSkinActive: true, dirty: false,
    update() {
      calls.push(this.gpuSkinOption);
      this.gpuSkinActive = this.gpuSkinOption;
      // The test's fake skinner moves each vertex into the ACTUAL death pose
      // only after its GPU path has been disabled on this one corpse.
      if (!this.gpuSkinOption) {
        for (let row = 0; row <= SEGMENTS; row++) for (let col = 0; col <= SEGMENTS; col++) {
          const i = row * (SEGMENTS + 1) + col;
          xyz[i * 3] = (col / SEGMENTS - 0.5) * poseScale;
          xyz[i * 3 + 1] = (0.5 - row / SEGMENTS) * poseScale;
        }
      }
      this.dirty = false;
    },
  };
  const front = { isMesh: true, name: 'npc_avatar_front_plane', matrixWorld: {}, geometry: { parameters: { width: 1, height: 1 } }, updateWorldMatrix() {} };
  const rig = {
    modelWidth: 1, modelHeight: 1,
    frontPlane: { traverse(fn) { fn(front); } },
    legs: { pants },
  };
  return { rig, pants, calls };
}

{
  const dest = testCanvas();
  const { rig, pants, calls } = buildRig(0.6);
  const result = painter.capture(dest, rig);
  assert.equal(result.ok, true, 'a ready corpse pants rig creates one baked texture');
  assert.equal(result.segments, 14, '32x32 original grid reduces to 14x14 ONLY for corpse capture');
  assert.equal(result.originalTriangles, 2048);
  assert.equal(result.triangles, 392, '19.1% of original cloth triangles are drawn into the corpse canvas');
  assert.deepEqual(calls, [false, true], 'CPU pose is sampled then the original per-handle GPU setting restored');
  assert.equal(pants.gpuSkinOption, true);
  const layer = canvases.at(-1);
  assert.equal(layer.drawing.transforms.length, 392, 'the cloth is rasterized as posed triangles');
  assert.equal(layer.drawing.draws.filter(x => x.source === clothing).length, 392, 'the spread-leg art is warped, not drawn flat');
  assert(layer.drawing.draws.some(x => x.source === overpass && x.operation === 'destination-out'), 'the original upper-body mask is respected');
  assert.equal(dest.drawing.draws.length, 1, 'the entire fitted pants layer is added once to the corpse portrait');
  assert.equal(dest.drawing.draws[0].source, layer);
}

{
  const dest = testCanvas();
  const before = canvases.length;
  const { rig } = buildRig(0.25);
  const second = painter.capture(dest, rig);
  assert.equal(second.ok, true);
  assert.equal(canvases.length, before + 1);
  const secondTransform = canvases.at(-1).drawing.transforms[0][0];
  const firstDest = testCanvas();
  const a = buildRig(0.6);
  painter.capture(firstDest, a.rig);
  const firstTransform = canvases.at(-1).drawing.transforms[0][0];
  assert.notEqual(secondTransform, firstTransform, 'bake follows different settled poses instead of reusing the jumping-jack geometry');
}

{
  const dest = testCanvas();
  const rig = { legs: { pants: { disposed: false } } };
  const prev = canvases.length;
  assert.equal(painter.capture(dest, rig).ok, false, 'not-yet-built corpse pants do not block retirement');
  assert.equal(canvases.length, prev, 'unavailable pants do not allocate a canvas');
}

console.log('corpse posed pants snapshot: ok');

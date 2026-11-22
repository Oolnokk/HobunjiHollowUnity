#!/usr/bin/env node
'use strict';

// Preview-only spine visualization and head-scale/neck/hunch ordering.
// Run: node scripts/run-tests.js animation-author-spine-preview
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const spineSource = fs.readFileSync('docs/js/character-spine.js', 'utf8'); // Shared gameplay spline and guide, not a copy made for this test.
const scaleSource = fs.readFileSync('docs/js/character-rig-scale.js', 'utf8'); // Head scale and subsequent neck recalculation.
const authorSource = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Full Character Scale author UI and call order.

function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing production function: ' + name);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, 'Unclosed production function: ' + name);
  return source.slice(start, end);
}

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(source) { return this.set(source.x, source.y, source.z); }
  add(source) { return this.set(this.x + source.x, this.y + source.y, this.z + source.z); }
  sub(source) { return this.set(this.x - source.x, this.y - source.y, this.z - source.z); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  length() { return Math.hypot(this.x, this.y, this.z); }
}
class Group {
  constructor() { this.children = []; this.position = new Vec3(); this.visible = true; this.isObject3D = true; }
  add(...items) { for (const item of items) { this.children.push(item); item.parent = this; } }
  remove(item) { this.children = this.children.filter(child => child !== item); item.parent = null; }
}
class Geometry { dispose() { this.disposed = true; } }
class Mesh extends Group {
  constructor(geometry, material) {
    super(); this.geometry = geometry; this.material = material;
    this.scale = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
    this.quaternion = { setFromUnitVectors() {} };
    this.up = new Vec3(0, 1, 0);
  }
}
class Material { dispose() { this.disposed = true; } }
const THREE = { Group, Mesh, CylinderGeometry: Geometry, SphereGeometry: Geometry, MeshBasicMaterial: Material, Vector3: Vec3 };
const makeGuide = vm.runInNewContext('(' + extract(spineSource, 'makeBoneGuides') + ')',
  { SPLINE_NODES: 7, SEGMENTS: 6 }); // Run the same shared debug renderer the actual game uses.
const plane = new Group();
plane.geometry = { boundingBox: { min: { y: -.5 }, max: { y: .5 } }, computeBoundingBox() {} };
const nodes = Array.from({ length: 7 }, (_, index) => ({
  position: new Vec3(0, index === 0 ? -.4 : .09, 0),
})); // Local actual spine-bone offsets; not seven fake independently animated points.
const rig = {
  skinnedPlane: plane, splineNodes: nodes,
  headOffsetJoint: { position: new Vec3(0, .08, 0) },
  neckJoint: { position: new Vec3(0, 0, 0) },
};
const guide = makeGuide(THREE, rig);
assert.ok(guide, 'actual 7-bone rig creates a spine guide');
const pivot = guide.group.children.find(child => child.name === 'spine_scaled_head_attachment');
const connector = guide.group.children.find(child => child.name === 'spine_neck_connection');
assert.ok(pivot && connector, 'cyan head attachment and physical spine connector are present');
guide.sync(true);
assert.equal(guide.group.visible, true);
assert.ok(Math.abs(pivot.position.y - .22) < 1e-9, 'head marker attaches to the last spine node + original neck placement');
rig.headOffsetJoint.position.y = -.03; // A larger centered head moves its lowest pixel and neck joint down.
guide.sync(true);
assert.ok(Math.abs(pivot.position.y - .11) < 1e-9, 'guide reacts to the new post-scale neck pivot without rebuilding geometry');
nodes[3].position.y = .19; // Hunch deformation shifts a real spine bone, not the marker alone.
guide.sync(true);
assert.ok(Math.abs(pivot.position.y - .21) < 1e-9, 'hunch moves the spine path and physical head connector together');
guide.sync(false);
assert.equal(guide.group.visible, false, 'visibility toggle hides the whole overlay');
guide.dispose();
assert.ok(!plane.children.includes(guide.group), 'preview teardown removes the spine overlay and releases resources');

const adjustedNeck = vm.runInNewContext('(' + extract(scaleSource, 'scaledNeckAdjustment') + ')');
const scaleRig = {
  headScaleJoint: {}, headOffsetJoint: {},
  neckLocal: { x: 0, y: -.08 }, headCentroidLocal: { x: 0, y: .14 },
}; // Head centroid lies above the last sprite pixel in the same portrait-local coordinate space.
assert.equal(adjustedNeck(scaleRig, 1), 0, 'neutral head scale preserves the original sprite-bottom neck pivot');
assert.ok(Math.abs(adjustedNeck(scaleRig, 1.5) + .11) < 1e-9, 'larger head lowers the recalculated neck contact');
assert.ok(Math.abs(adjustedNeck(scaleRig, .5) - .11) < 1e-9, 'smaller head raises the recalculated neck contact');
assert.equal(adjustedNeck({ neckLocal: { y: 0 } }, 2), 0, 'unrigged actors remain unaffected');

const compensation = extract(scaleSource, 'applyHeadCompensation');
const scaleAt = compensation.indexOf('target.scale.set(');
const recalcAt = compensation.indexOf('scaledNeckAdjustment(rig, relativeHeadY)');
const offsetAt = compensation.indexOf('applyHeadYOffset(offsetTarget');
assert.ok(scaleAt >= 0 && scaleAt < recalcAt && recalcAt < offsetAt,
  'head-scale → neck-recalculation → placement is explicitly ordered');
const refresh = extract(authorSource, 'refreshLongoranSpine');
assert.ok(refresh.indexOf('applyToParent?.(') < refresh.indexOf('applyToRig?.('),
  'Longoran hunch generation follows the real post-scaled neck computation');
assert.match(authorSource, /id="maaFullScaleShowSpine"/, 'the mobile author exposes its own Show spine toggle');
assert.match(authorSource, /makeBoneGuides\?\.\(THREE, selected\.model\.userData\.neckRig\)/,
  'Full Character Scale reuses the exact shared rig guide only for the selected character');
assert.match(authorSource, /spineGuide: null, profile:/, 'lineup creation never eagerly allocates fourteen-mesh guides for every avatar');
assert.match(authorSource, /entry\.spineGuide\.dispose\(\);/, 'previously selected guide is disposed when the user picks another NPC');
assert.match(authorSource, /entry\.spineGuide\?\.dispose\?\.\(\)/,
  'leaving the editor disposes its diagnostic mesh');
console.log('Spine preview: seven real joints, scaled-neck endpoint, live hunch, toggle, disposal and update order PASS');

// Nov 22: the 10-bone head-scale joint pivots at the chin (child of the neck joint), so head
// size must not stretch the spine. Adding the centroid chin delta lifted 200%-height Longoran
// heads by ~8% of their height in Full Character Scale screenshots.
{
  const spinePath = compensation.slice(compensation.indexOf('if (distributeToSpine) {'), compensation.indexOf('} else {', compensation.indexOf('if (distributeToSpine) {')));
  assert.match(spinePath, /const reachY = clampOffset\(baseOffset\) \* modelHeight;/, 'spine reach comes only from the authored head height');
  assert.doesNotMatch(spinePath, /reachY[^;]*scaledNeckDeltaY/, 'head scale never stretches the spine on chin-pivoted rigs');
}

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Execute both shipped landmark resolvers with a diagonal affine rig fixture.
const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const paritySource = fs.readFileSync('docs/js/portrait-plane-outline-parity.js', 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}
class Matrix4 {
  constructor(s = 1, y = 0) { this.s = s; this.y = y; }
  clone() { return new Matrix4(this.s, this.y); }
  fromArray(a, offset) { this.s = a[offset]; this.y = a[offset + 13]; return this; }
  multiplyMatrices(a, b) { this.s = a.s * b.s; this.y = a.s * b.y + a.y; return this; }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { Object.assign(this, v); return this; }
  applyMatrix4(m) { this.x *= m.s; this.y = this.y * m.s + m.y; this.z *= m.s; return this; }
  addScaledVector(v, w) { this.x += v.x * w; this.y += v.y * w; this.z += v.z * w; return this; }
}
const context = vm.createContext({ pixelPositionScratch: null, // Extracted production functions share this stand-in for their enclosing reusable scratch.
  THREE: { Vector3, Matrix4 }, portraitsFlipped: false,
  mirrorShoulderPerchWithPortrait: true, resolveSkinnedPortraitRoot: root => root,
  smoothstep01: t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); },
});
vm.runInContext(extract(avatarSource, 'headScaleGateAtPixel'), context);
vm.runInContext(extract(avatarSource, 'headScaleWeightAt'), context);
context.avatarApi = { resolveSkinnedPortraitRoot: root => root,
  headScaleGateAtPixel: context.headScaleGateAtPixel, headScaleWeightAt:context.headScaleWeightAt, getPortraitsFlipped: () => context.portraitsFlipped };
vm.runInContext(extract(avatarSource, 'resolveSkinnedPixelWorldPosition'), context);
vm.runInContext(extract(paritySource, 'resolvePosition'), context);

function fixture(bodyScale, floorY, headScale, cachedMatrices = true, legacy = false) {
  const world = new Matrix4(bodyScale, floorY);
  const headWorld = new Matrix4(bodyScale * headScale, floorY + bodyScale * .2 * (1 - headScale));
  const matrices = legacy ? [world, world] : [world, world, headWorld];
  const skeleton = { bones: matrices.map(matrixWorld => ({ matrixWorld })),
    boneInverses: matrices.map(() => new Matrix4()), update() {} };
  if (cachedMatrices) skeleton.boneMatrices = matrices.flatMap(m => {
    const a = Array(16).fill(0); a[0] = a[5] = a[10] = m.s; a[13] = m.y; a[15] = 1; return a;
  });
  const skinnedPlane = { isSkinnedMesh: true, skeleton, geometry: { userData: { blendHeight: .3 } },
    bindMatrix: new Matrix4(), bindMatrixInverse: new Matrix4(),
    updateMatrixWorld() { this.bindMatrixInverse = new Matrix4(1 / bodyScale, -floorY / bodyScale); },
    localToWorld(v) { return v.applyMatrix4(world); } };
  return { updateMatrixWorld() {}, userData: { sourceCanvas: { width: 100, height: 100 },
    portraitModelWidth: 1, portraitModelHeight: 1, neckRig: { available: true, skinnedPlane,
      neckLocal: { y: .2 }, headScaleJoint: legacy ? null : {}, headBoundsPx: { left: 40, right: 60 } } } };
}
function near(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`); }
for (const resolve of [context.resolveSkinnedPixelWorldPosition, context.resolvePosition]) {
  for (const cached of [true, false]) {
    for (const bodyScale of [.6375, 1.1]) {
      for (const headScale of [.5, 1, 2]) {
        const root = fixture(bodyScale, 2.5, headScale, cached);
        near(resolve(root, { x: 50, y: 10 }).y, 2.5 + bodyScale * (.2 + .2 * headScale), 'head includes authored scale once above elevated floor');
        near(resolve(root, { x: 90, y: 10 }).y, 2.5 + bodyScale * .4, 'outer shoulder keeps head rotation without head scale');
        const gate = context.headScaleGateAtPixel(70, { left: 40, right: 60 });
        near(resolve(root, { x: 70, y: 10 }).y, 2.5 + bodyScale * (.4 + gate * .2 * (headScale - 1)), 'edge landmark shares rendered smooth scale gate');
      }
    }
    near(resolve(fixture(.8, 3, 2, cached, true), { x: 50, y: 10 }).y, 3 + .8 * .4, 'legacy two-bone rig remains supported');
  }
  const output = new Vector3(); // The new hot-path overload must preserve caller-owned vector identity.
  assert.strictEqual(resolve(fixture(1, 0, 2), { x: 50, y: 10 }, output), output);
  near(output.y, .6, 'caller-owned output includes compensated head scale');
  context.portraitsFlipped = true;
  const root = fixture(1, 0, 2); root.userData.neckRig.headBoundsPx = { left: 15, right: 25 };
  near(resolve(root, { x: 80, y: 10 }).y, .6, 'mirrored landmark uses rendered X for head-scale gate');
  context.portraitsFlipped = false;
}
// Current skeleton (spline nodes 0-6, head-turn 7, head-scale 8): body pixels follow the two spline nodes either side of their height, taken from
// the spline module's own weights; a point at the posterior rides the pinned node 0 and a point above the neck base the last node.
context.window = context; // The resolver reads window.HobunjiCharacterSpine, installed by the spine module in this same realm.
vm.runInContext(fs.readFileSync('docs/js/character-spine.js', 'utf8'), context);
function splineFixture(nodeShift) {
  const world = new Matrix4(1, 0);
  const matrices = Array.from({ length: 9 }, (_, k) => (k >= 1 && k <= 6 ? new Matrix4(1, nodeShift[k]) : world)); // Nodes 1-6 displaced, node 0 pinned, neck/head bones at rest.
  const skeleton = { bones: matrices.map(matrixWorld => ({ matrixWorld })), boneInverses: matrices.map(() => new Matrix4()), update() {} };
  const skinnedPlane = { isSkinnedMesh: true, skeleton, geometry: { userData: { blendHeight: .3 } }, bindMatrix: new Matrix4(), bindMatrixInverse: new Matrix4(),
    updateMatrixWorld() {}, localToWorld(v) { return v; } };
  return { updateMatrixWorld() {}, userData: { sourceCanvas: { width: 100, height: 100 }, portraitModelWidth: 1, portraitModelHeight: 1,
    neckRig: { available: true, skinnedPlane, neckLocal: { y: .2 }, spineBase: { y: .1 }, spinePosteriorY: -.3, headScaleJoint: {}, headBoundsPx: { left: 40, right: 60 } } } };
}
for (const resolve of [context.resolveSkinnedPixelWorldPosition, context.resolvePosition]) {
  const nodes = [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24]; // Each node displaced a little more than the one below it.
  const root = splineFixture(nodes);
  const weights = context.window.HobunjiCharacterSpine.nodeWeightsAt(.035, .1, 1, -.3, {});
  const expected = .035 + nodes[weights.a] * (1 - weights.wb) + nodes[weights.b] * weights.wb;
  near(resolve(root, { x: 90, y: 46.5 }).y, expected, 'a body pixel (outside the head) follows its two neighbouring spline nodes');
  near(resolve(root, { x: 90, y: 80 }).y, -.3, 'a pixel at the posterior stays on the pinned node 0');
  near(resolve(splineFixture([0, 0, 0, 0, 0, 0, 0]), { x: 90, y: 46.5 }).y, .035, 'an upright skeleton leaves the pixel where it was');
}
console.log('head centroid skinning regression passed');

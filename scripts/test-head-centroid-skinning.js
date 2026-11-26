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
  constructor(s = 1, y = 0, z = 0) { this.s = s; this.y = y; this.z = z; }
  clone() { return new Matrix4(this.s, this.y, this.z); }
  fromArray(a, offset) { this.s = a[offset]; this.y = a[offset + 13]; this.z = a[offset + 14]; return this; }
  multiplyMatrices(a, b) { this.s = a.s * b.s; this.y = a.s * b.y + a.y; this.z = a.s * b.z + a.z; return this; }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { Object.assign(this, v); return this; }
  applyMatrix4(m) { this.x *= m.s; this.y = this.y * m.s + m.y; this.z = this.z * m.s + m.z; return this; }
  addScaledVector(v, w) { this.x += v.x * w; this.y += v.y * w; this.z += v.z * w; return this; }
}
const context = vm.createContext({ pixelPositionScratch: null, // Extracted production functions share this stand-in for their enclosing reusable scratch.
  THREE: { Vector3, Matrix4 }, portraitsFlipped: false,
  mirrorShoulderPerchWithPortrait: true, resolveSkinnedPortraitRoot: root => root,
  smoothstep01: t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); },
});
vm.runInContext(extract(avatarSource, 'neckBlendBand'), context);
vm.runInContext(extract(avatarSource, 'neckBlendWeight'), context);
vm.runInContext(extract(avatarSource, 'headOffsetWeightAt'), context);
vm.runInContext(extract(avatarSource, 'headScaleGateAtPixel'), context);
vm.runInContext(extract(avatarSource, 'headScaleWeightAt'), context);
context.avatarApi = { resolveSkinnedPortraitRoot: root => root,
  neckBlendBand: context.neckBlendBand, neckBlendWeight: context.neckBlendWeight, headOffsetWeightAt: context.headOffsetWeightAt, // The outline/parity adapter reads both identical neck and independent head-placement weights.
  headScaleGateAtPixel: context.headScaleGateAtPixel, headScaleWeightAt:context.headScaleWeightAt, getPortraitsFlipped: () => context.portraitsFlipped };
vm.runInContext(extract(avatarSource, 'sampleSkinnedPortraitSurface'), context);
vm.runInContext(extract(avatarSource, 'resolveSkinnedPixelWorldPosition'), context);
assert(!/avatarApi\.resolveSkinnedPixelWorldPosition\s*=/.test(paritySource), 'outline adapter must not replace the shared resolver');
context.resolvePosition = context.resolveSkinnedPixelWorldPosition; // Both game and preview now use the same function.

function fixture(bodyScale, floorY, headScale, cachedMatrices = true, legacy = false) {
  const world = new Matrix4(bodyScale, floorY);
  const headWorld = new Matrix4(bodyScale * headScale, floorY + bodyScale * .2 * (1 - headScale));
  const matrices = legacy ? [world, world] : [world, world, headWorld];
  const skeleton = { bones: matrices.map(matrixWorld => ({ matrixWorld })),
    boneInverses: matrices.map(() => new Matrix4()), update() {} };
  if (cachedMatrices) skeleton.boneMatrices = matrices.flatMap(m => {
    const a = Array(16).fill(0); a[0] = a[5] = a[10] = m.s; a[13] = m.y; a[15] = 1; return a;
  });
  const skinnedPlane = { isSkinnedMesh: true, skeleton, geometry: { userData: { blendHeight: .012 } },
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
  const skinnedPlane = { isSkinnedMesh: true, skeleton, geometry: { userData: { blendHeight: .012 } }, bindMatrix: new Matrix4(), bindMatrixInverse: new Matrix4(),
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
// The production 10-bone rig carries head-height displacement across all seven
// real spine bones, reaching the tip before the tiny nonrotating neck contact.
// Both pixel resolvers must reproduce these weights for shoulder pet attachment.
function offsetFixture(offset) {
  const raw = new Matrix4(1, 0);
  const placed = new Matrix4(1, offset);
  const matrices = Array.from({ length: 10 }, (_, i) => i >= 7 ? placed : new Matrix4(1, offset * i / 6)); // Lower torso rides the evenly extended spine; the short neck follows its tip.
  const skeleton = {
    bones: matrices.map(matrixWorld => ({ matrixWorld })),
    boneInverses: matrices.map(() => new Matrix4()),
    boneMatrices: matrices.flatMap(m => { const a = Array(16).fill(0); a[0] = a[5] = a[10] = m.s; a[13] = m.y; a[15] = 1; return a; }),
    update() {},
  };
  const skinnedPlane = { isSkinnedMesh: true, skeleton, geometry: { userData: { blendHeight: .012 } },
    bindMatrix: new Matrix4(), bindMatrixInverse: new Matrix4(),
    updateMatrixWorld() {}, localToWorld(v) { return v; } };
  return { updateMatrixWorld() {}, userData: {
    sourceCanvas: { width: 100, height: 100 }, portraitModelWidth: 1, portraitModelHeight: 1,
    neckRig: { available: true, skinnedPlane, headOffsetJoint: {}, headScaleJoint: {}, neckLocal: { y: .2 },
      spineBase: { y: .175 }, spinePosteriorY: -.3, headBoundsPx: { left: 40, right: 60 } }, // Last spine node is 2.5 original 100px sprite rows below the head.
  } };
}
for (const placement of [-.095, .12]) {
  const root = offsetFixture(placement);
  const samples = [{ x: 50, y: 25 }, { x: 50, y: 30.5 }, { x: 50, y: 35 }, { x: 50, y: 50 }, { x: 50, y: 80 }];
  for (const pixel of samples) {
    const y = .5 - pixel.y / 100;
    const spline = context.window.HobunjiCharacterSpine.nodeWeightsAt(y, .175, 1, -.3, {});
    const translationWeight = y > .2 - .012 ? 1 : (spline.a * (1 - spline.wb) + spline.b * spline.wb) / 6; // Below the neck ALL movement comes from actual spine weights, not placement bone 7.
    const expected = y + placement * translationWeight;
    for (const resolve of [context.resolveSkinnedPixelWorldPosition, context.resolvePosition])
      near(resolve(root, pixel).y, expected, 'runtime and x-ray CPU skinning match real seven-node spine stretch and short-neck placement');
  }
}
// The Animation Author uses a different three-bone layout: body 0, offset 1,
// rotating neck 2. Spouse Kiss translates the actual neck joint forward in Z,
// so both skinned-pixel mouth probes must see that bone's motion immediately.
function authorNeckFixture(headForward, headPlacement) {
  const body = new Matrix4();
  const offset = new Matrix4(1, 0, headPlacement);
  const neck = new Matrix4(1, 0, headPlacement + headForward);
  const matrices = [body, offset, neck];
  const skeleton = {
    bones: matrices.map(matrixWorld => ({ matrixWorld })),
    boneInverses: matrices.map(() => new Matrix4()),
    boneMatrices: matrices.flatMap(m => {
      const a = Array(16).fill(0);
      a[0] = a[5] = a[10] = m.s;
      a[13] = m.y; a[14] = m.z; a[15] = 1;
      return a;
    }),
    update() {},
  };
  const skinnedPlane = { isSkinnedMesh: true, skeleton, geometry: { userData: { blendHeight: .012 } },
    bindMatrix: new Matrix4(), bindMatrixInverse: new Matrix4(),
    updateMatrixWorld() {}, localToWorld(v) { return v; } };
  return { updateMatrixWorld() {}, userData: {
    sourceCanvas: { width: 100, height: 100 }, portraitModelWidth: 1, portraitModelHeight: 1,
    neckRig: { available: true, skinnedPlane, headOffsetJoint: {}, neckJoint: {}, neckLocal: { y: .2 } },
  } };
}
for (const resolve of [context.resolveSkinnedPixelWorldPosition, context.resolvePosition]) {
  for (const placement of [-.04, .05]) {
    const root = authorNeckFixture(.10, placement); // Same forward neck move the kiss's contact solver applies in world space.
    near(resolve(root, { x: 50, y: 10 }).z, .10 + placement,
      'author head pixels follow bone 2 movement and bone 1 placement');
    const middleY = .5 - 30.5 / 100;
    const turn = context.neckBlendWeight(middleY, .2, .012);
    near(resolve(root, { x: 50, y: 30.5 }).z, placement + .10 * turn,
      'author short neck strip blends between rotation and nonrotating placement');
    const lowerY = .5 - 40 / 100;
    near(resolve(root, { x: 50, y: 40 }).z,
      placement * context.headOffsetWeightAt(lowerY, .2, 1, .012),
      'author torso uses only nonrotating offset fade below the short neck');
    near(resolve(root, { x: 50, y: 90 }).z, 0,
      'author lower body remains planted during mouth contact');
  }
}
console.log('head centroid skinning regression passed, including ten-bone and three-bone author offset parity');

// Production broad blend: both attachment resolvers must give the same partial shoulder motion as the skin.
for (const resolve of [context.resolveSkinnedPixelWorldPosition, context.resolvePosition]) {
  const root = offsetFixture(.08);
  root.userData.neckRig.skinnedPlane.geometry.userData.blendHeight = .30;
  const y = .12, pixel = {x: 90, y: 38};
  const spline = context.window.HobunjiCharacterSpine.nodeWeightsAt(y, .175, 1, -.3, {});
  const head = context.neckBlendWeight(y, .2, .30, 1);
  const body = (spline.a * (1 - spline.wb) + spline.b * spline.wb) / 6;
  near(resolve(root, pixel).y, y + .08 * ((1 - head) * body + head), 'broad skin and both CPU landmark resolvers agree');
}

// A posed triangle is not equivalent to skinning its interpolated rest point.
// Use a coarse quad with only its upper vertices head-scaled; the interpolated
// midpoint must follow the triangle itself rather than an analytic curve.
{
  const root = fixture(1, 0, 2);
  const plane = root.userData.neckRig.skinnedPlane;
  const makeAttr = (array, n) => ({ array, count: array.length / n, getX:i=>array[i*n], getY:i=>array[i*n+1], getZ:i=>array[i*n+2] });
  const pos = makeAttr([-.5,-.5,0, .5,-.5,0, -.5,.5,0, .5,-.5,0, .5,.5,0, -.5,.5,0],3);
  const uv = makeAttr([0,0,1,0,0,1,1,0,1,1,0,1],2);
  const idx = makeAttr([0,0,0,0, 0,0,0,0, 2,0,0,0, 0,0,0,0, 2,0,0,0, 2,0,0,0],4);
  const wt = makeAttr(Array.from({length:6},()=>[1,0,0,0]).flat(),4);
  const attrs = { position:pos, uv, skinIndex:idx, skinWeight:wt };
  plane.geometry = { userData:{segmentsX:1,segmentsY:1,portraitGridRows:[0,1],blendHeight:.30},getAttribute:k=>attrs[k] };
  const resolve = context.resolveSkinnedPixelWorldPosition;
  // Pixel (25,50) lies within the first triangle. Top corner y .5 -> .8,
  // bottom corner stays -.5. At the middle of the row, y must be .15.
  near(resolve(root,{x:25,y:50}).y,.15,'interior landmark follows GPU triangle, not nonlinear analytic weights');
  near(resolve(root,{x:75,y:50}).y,.15,'both quad triangles interpolate the live vertex positions');
  near(resolve(root,{x:0,y:0}).y,.8,'top boundary uses actual posed corner');
  near(resolve(root,{x:100,y:100}).y,-.5,'bottom boundary uses actual posed corner');
  context.portraitsFlipped=true;
  near(resolve(root,{x:25,y:50}).x,.25,'flipped landmarks use the opposite actual triangle');
  context.portraitsFlipped=false;
}
console.log('Actual posed portrait triangle sampling PASS');

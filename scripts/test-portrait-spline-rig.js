#!/usr/bin/env node
'use strict';
// Run: node scripts/test-portrait-spline-rig.js
// Pure geometry/authoring contract regression coverage, including rear-side visibility and hot-swaps.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..'); // All source checks stay relative to the repository, not the test process's CWD.
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const env = { window: {}, console };
vm.runInNewContext(read('docs/js/portrait-spline-rig.js'), env);
const Rig = env.window.PortraitSplineRig;
assert(Rig, 'portrait spline runtime exports a reusable rig');

function makeRig() {
  // Authoring reference used for wind/collision and hot-swapped mesh tests.
  return {
    version: 1,
    enabled: true,
    points: [{ u: .5, v: .3, depth: .02 }, { u: .51, v: .48, depth: .028 }, { u: .54, v: .7, depth: .035 }],
    segments: [
      { deadzone: { x: 5, y: 8, z: 12 }, poses: { right: { yaw: 60, pitch: 35, roll: 25 }, left: { yaw: -55 } } },
      { deadzone: { x: 4, y: 7, z: 11 }, poses: { right: { yaw: 65, pitch: 35, roll: 15 }, away: { pitch: 50 } } },
    ],
    regionMasks: { front: { size: 200, runs: [[123, 10]] } }, // Explicit rigid region remains pixel-accurate on export.
    rearOffset: { u: .015, v: -.02 },
  };
}
const normalized = Rig.normalize(makeRig());
assert(normalized && normalized.points.length === 3);
assert.equal(normalized.regionMasks.front.runs[0][1], 10, 'rigid mask pixels survive cosmetic normalization');
assert.equal(normalized.segments[0].deadzone.z, 12, 'per-axis rotation deadzone survives');
assert.equal(Rig.normalize({ enabled: true, points: [] }), null, 'malformed rig stays unrigged');
assert.equal(Rig.resolveOptionRig(null, null), null, 'ordinary hairstyles remain flat');
const chosen = Rig.resolveOptionRig({ splineRig: makeRig() }, { speciesId: 'mao-ao', gender: 'male' });
assert(chosen, 'opted-in cosmetic activates its rig');
const rest = Rig.posePoints(normalized);
const moved = Rig.posePoints(normalized, { x: 1, y: .4, z: -.9 });
assert.equal(rest.points.length, 3);
assert(moved.points.every(p => p.z >= .002999), 'every wind-blown segment must remain in front of the portrait');
assert(moved.points.some((p, i) => Math.abs(p.x - rest.points[i].x) > .01), 'wind must move the authored points');
assert.deepEqual(JSON.parse(JSON.stringify(Rig.blendSegment(normalized.segments[0], { x: 0, y: 0, z: 0 }))),
  { yaw: 0, pitch: 0, roll: 0 }, 'the neutral pose is wind-free');
const midpoint = Rig.curvePoint(rest.points, 0, .5);
assert(midpoint.z > 0, 'smooth neutral strand interpolation preserves outward depth');
const join = Rig.curvePoint(rest.points, 0, 1);
const left = Rig.curvePoint(rest.points, 0, .999);
const right = Rig.curvePoint(rest.points, 1, .001);
const leftSlope = (join.x - left.x) / .001, rightSlope = (right.x - join.x) / .001; // Adjacent cubic segments must meet with a continuous tangent.
assert(Math.abs(leftSlope - rightSlope) < .002, 'neighboring spline segments meet smoothly without a visible kink');
const extreme = Rig.normalize({ ...makeRig(), points: [{u: .5,v:.3,depth:.002},{u:.5,v:.5,depth:.002}], segments: [{ poses: { away: { pitch: 85 } } }] });
assert(Rig.posePoints(extreme, { z: -1 }).points[1].z >= .002999, 'an authored inward pose clamps against the portrait');
const warped = Rig.deformPosition(normalized, moved.points, .52, .58, 1, 1);
assert(warped.z >= .003, 'deformed sprite vertices also respect the portrait depth guard');

class FakeGeometry {
  constructor(width = 1, height = 1, nx = 4, ny = 4) {
    const data = new Float32Array((nx + 1) * (ny + 1) * 3); // Vertex rest coordinates for front/rear comparison.
    let j = 0;
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      data[j++] = (x / nx - .5) * width; data[j++] = (.5 - y / ny) * height; data[j++] = 0;
    }
    this.attributes = { position: {
      array: data, count: data.length / 3, needsUpdate: false,
      setXYZ(i, x, y, z) { data.set([x, y, z], i * 3); },
    } };
  }
  clone() {
    const result = new FakeGeometry();
    const values = new Float32Array(this.attributes.position.array);
    result.attributes.position = {
      array: values, count: values.length / 3, needsUpdate: false,
      setXYZ(i, x, y, z) { values.set([x, y, z], i * 3); },
    };
    return result;
  }
  computeBoundingSphere() {}
  dispose() { this.disposed = true; }
}
class FakeGroup {
  constructor() { this.userData = {}; this.children = []; this.position = { set(x,y,z) { this.x=x;this.y=y;this.z=z; } }; }
  add(child) { child.parent?.remove?.(child); child.parent=this; this.children.push(child); }
  remove(child) { this.children=this.children.filter(c=>c!==child); child.parent=null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
}
class FakeMesh extends FakeGroup {
  constructor(geometry, material) { super(); this.geometry=geometry; this.material=material; }
}
class FakeMaterial {
  constructor(options) { Object.assign(this, options); }
  dispose() { this.disposed = true; }
}
class FakeTexture {
  constructor(image) { this.image=image; }
  dispose() { this.disposed=true; }
}
const THREE = {
  PlaneGeometry: FakeGeometry, Group: FakeGroup, Mesh: FakeMesh,
  MeshBasicMaterial: FakeMaterial, CanvasTexture: FakeTexture, FrontSide: 1, BackSide: 2,
};
env.window.DeadzoneBillboard = null;
env.document = { createElement() { return { width: 200, height: 200, getContext() {
  return { drawImage() {}, clearRect() {}, save() {}, restore() {}, translate() {}, scale() {} };
} }; } };
const avatar = new FakeGroup(); avatar.name = 'unit_test_avatar';
const rigPart = (key, slot, points) => ({ key, slot, rig: Rig.normalize({ ...makeRig(), ...(points ? { points } : {}) }), canvas: {
  width: 200, height: 200, getContext() { return { drawImage() {}, clearRect() {} }; },
} });
const front = { hobunjiSplineParts: [rigPart('hairSide:test:0', 'hairSide')] };
const back = { hobunjiSplineParts: [rigPart('hairSide:test:0', 'hairSide')] };
Rig.attach(THREE, avatar, avatar, front, back, 1, 1);
assert.equal(avatar.userData.portraitSplineParts.length, 1);
const part = avatar.userData.portraitSplineParts[0];
assert(part.rearMesh, 'side hair uses a separately textured rear surface');
const fz = part.frontMesh.geometry.attributes.position.array[2], rz = part.rearMesh.geometry.attributes.position.array[2];
assert(fz > 0 && rz < 0, 'rear hair protrudes behind the rear plane, not through the skull');
assert(Math.abs(fz + rz) < 1e-7, 'front/rear strand depths match');
assert.equal(part.frontMesh.material.side, THREE.FrontSide);
assert.equal(part.rearMesh.material.side, THREE.BackSide);
const previous = part.frontMesh.geometry;
Rig.refresh(avatar, { hobunjiSplineParts: [rigPart('hairSide:test:0', 'hairSide',
  [{u:.49,v:.3,depth:.02},{u:.52,v:.5,depth:.03},{u:.54,v:.7,depth:.06}])] }, back);
assert(previous.disposed, 'authored hairstyle changes discard the old geometry');
assert.notEqual(avatar.userData.portraitSplineParts[0].frontMesh.geometry, previous);
Rig.refresh(avatar, { hobunjiSplineParts: [] }, { hobunjiSplineParts: [] });
assert.equal(avatar.userData.portraitSplineParts.length, 0, 'removing a cosmetic removes its rig');
Rig.refresh(avatar, front, back);
assert.equal(avatar.userData.portraitSplineParts.length, 1, 'new rig can be equipped after an unrigged style');
Rig.detach(avatar);
assert.equal(avatar.userData.portraitSplineParts.length, 0);

const portrait = read('docs/js/portrait-utils.js');
const html = read('docs/index.html');
const studio = read('docs/tools/character-studio/index.html');
const editor = read('docs/tools/portrait-spline-author/index.html');
assert(portrait.includes("hoodHidesFacialHair(hood)") && portrait.includes("splineRigFor(entry.group)"), 'facewrap hiding and spline opt-in share portrait layer resolution');
assert(portrait.includes("renderBehindView && slot === 'facialHair'"), 'a rigged beard does not paint a second rear portrait');
assert(portrait.includes("splitByMask?.(partCanvas, rig.regionMasks?.[view])"), 'front/rear masks partition each cosmetic into stationary and deforming pixels');
assert(!portrait.includes("warpHoodCanvas?.(") && !portrait.includes("paintSeamBridge?.("),
  'new masks do not carve hood pixels or paint artificial seam bridges');
assert(html.includes('portrait-spline-rig.js'), 'game loads the spline runtime');
assert(studio.includes('portrait-spline-rig.js'), 'Character Studio loads the same runtime');
assert(editor.includes('id="paintMode"') && editor.includes('id="eraseMode"') && editor.includes('segmentSelect'),
  'mobile editor exposes rigid brush, flexible eraser, and per-segment pose controls');
console.log('Portrait spline rig: 22 regression assertions passed.');

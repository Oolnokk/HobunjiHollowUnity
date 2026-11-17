#!/usr/bin/env node
'use strict';
// The pants garment is skinned in the vertex shader (js/pants-garment-renderer.js, GPU_SKIN_VERTEX_BODY). This runs the real
// module on a synthetic avatar with real three r128, poses the procedural legs, skins once on the CPU path, then evaluates the
// shader's maths in JS from the GPU path's attributes and uniforms and requires the same vertices.
//
// Needs `three@0.128.0` (CI installs it; locally: npm install --no-save three@0.128.0, or set THREE_MIN_JS).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadThreeSource() {
  const candidates = [process.env.THREE_MIN_JS, 'three/build/three.min.js'].filter(Boolean);
  for (const candidate of candidates) {
    try { return fs.readFileSync(candidate.startsWith('three/') ? require.resolve(candidate, { paths: [process.cwd(), __dirname] }) : candidate, 'utf8'); } catch (_) { /* try next */ }
  }
  return null;
}
const threeSource = loadThreeSource();
if (!threeSource) {
  console.log('SKIPPED pants GPU skin parity: three@0.128.0 is not installed (npm install --no-save three@0.128.0).');
  process.exit(0);
}

const win = { document: {}, console: { ...console, warn: () => {} } }; // setAppearance has no canvas here and warns; the mesh is attached by hand below.
win.window = win; win.globalThis = win; win.self = win;
vm.createContext(win);
vm.runInContext(threeSource, win, { filename: 'three.min.js' });
for (const file of ['docs/config/pants-rigs.js', 'docs/js/pants-rig-core.js', 'docs/js/pants-garment-renderer.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), win, { filename: file });
const THREE = win.THREE, Renderer = win.PantsGarmentRenderer;
assert(THREE && Renderer, 'three and the renderer installed');

function makeAvatar() {
  const model = new THREE.Group();
  new THREE.Scene().add(model); // The garment only updates while its avatar is in a scene.
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial());
  plane.name = 'frontPlane'; plane.userData.hobunjiPlaneFace = 'front'; plane.position.y = 1;
  model.add(plane);
  const legs = new THREE.Group();
  model.add(legs);
  const nodes = {};
  for (const [side, x] of [['left', -0.15], ['right', 0.15]]) {
    const thigh = new THREE.Group(); thigh.name = `${side}_thigh`; thigh.position.set(x, 0.85, 0.02);
    const calf = new THREE.Group(); calf.name = `${side}_calf`; calf.position.set(0, -0.42, 0); calf.userData.hobunjiCalfLength = 0.42;
    thigh.add(calf); legs.add(thigh);
    nodes[side] = { thigh, calf };
  }
  model.updateMatrixWorld(true);
  return { model, legs, nodes };
}

const rigs = win.HOBUNJI_PANTS_RIGS;
const { model, legs, nodes } = makeAvatar();
const handle = Renderer.attach(THREE, {
  avatarGroup: model, legHandle: { group: legs }, speciesId: 'kenkari', gender: 'female',
  garmentRecord: rigs.garments.pants_basic, characterRecord: rigs.characters.__default, meshBudget: 'npc',
});
assert(handle, 'garment attached to the synthetic avatar');
const material = new THREE.MeshBasicMaterial();
handle.mesh = new THREE.Mesh(handle.geometry, material); handle.material = material; model.add(handle.mesh);

// A walking pose: thighs swing fore/aft and splay, one knee bends.
nodes.left.thigh.rotation.set(0.55, 0, 0.12); nodes.left.calf.rotation.set(-0.7, 0, 0);
nodes.right.thigh.rotation.set(-0.35, 0.2, -0.08); nodes.right.calf.rotation.set(-0.15, 0, 0);
model.updateMatrixWorld(true);

Renderer.setGpuSkinning(false);
handle.update();
assert.strictEqual(handle.gpuSkinActive, false);
const position = handle.geometry.getAttribute('position');
const cpu = Float32Array.from(position.array);
let moved = 0;
for (let i = 0; i < cpu.length; i++) moved = Math.max(moved, Math.abs(cpu[i] - handle.basePositions[i]));
assert(moved > 0.02, `the pose deforms the garment on the CPU path (max ${moved})`);

Renderer.setGpuSkinning(true);
handle.update();
assert.strictEqual(handle.gpuSkinActive, true, 'switching back re-runs the frame on the GPU path');
assert.strictEqual(handle.maskUniforms.uPantsGpuSkin.value, 1);
for (let i = 0; i < cpu.length; i++) assert.strictEqual(position.array[i], handle.basePositions[i], 'the GPU path uploads the rest grid, not skinned vertices');

// The vertex shader, in JS.
const u = handle.maskUniforms, g = handle.geometry;
const w0 = g.getAttribute('pantsSkinW0').array, w1 = g.getAttribute('pantsSkinW1').array, ring = g.getAttribute('pantsRingInfluence').array, spine = g.getAttribute('pantsSpineShift').array;
const v = new THREE.Vector3(), t = new THREE.Vector3(), out = new THREE.Vector3();
let worst = 0;
for (let i = 0; i < cpu.length / 3; i++) {
  v.fromArray(position.array, i * 3);
  out.copy(v).multiplyScalar(w0[i * 4]);
  const weights = [w0[i * 4 + 1], w0[i * 4 + 2], w0[i * 4 + 3], w1[i]];
  for (let b = 0; b < 4; b++) out.addScaledVector(t.copy(v).applyMatrix3(u.uPantsBoneM.value[b]).add(u.uPantsBoneT.value[b]), weights[b]);
  out.addScaledVector(u.uPantsRingShift.value[0], ring[i * 2]).addScaledVector(u.uPantsRingShift.value[1], ring[i * 2 + 1]);
  out.x += spine[i * 3]; out.y += spine[i * 3 + 1]; out.z += spine[i * 3 + 2];
  worst = Math.max(worst, Math.abs(out.x - cpu[i * 3]), Math.abs(out.y - cpu[i * 3 + 1]), Math.abs(out.z - cpu[i * 3 + 2]));
}
assert(worst < 1e-5, `GPU skin matches the CPU skin (max error ${worst})`);
assert(u.uPantsRingShift.value.some(s => s.lengthSq() > 0), 'the ankle-ring correction is exercised');

// A still frame costs nothing on either path; a material swapped in by another system (ghostify, mine-lit) falls back to the CPU skin.
handle.update();
handle.mesh.material = new THREE.MeshBasicMaterial();
handle.update();
assert.strictEqual(handle.gpuSkinActive, false, 'a foreign material has no skinning shader: CPU path');
let cpuAgain = 0;
for (let i = 0; i < cpu.length; i++) cpuAgain = Math.max(cpuAgain, Math.abs(position.array[i] - cpu[i]));
assert(cpuAgain < 1e-6, 'the CPU fallback rewrites the skinned vertices');
handle.mesh.material = material;
handle.update();
assert.strictEqual(handle.gpuSkinActive, true);
for (let i = 0; i < cpu.length; i++) assert.strictEqual(position.array[i], handle.basePositions[i], 'returning to the GPU path restores the rest grid');

// Camera-only yaw rotates the model, legs and garment together. Their relative bone pose
// is unchanged, so the CPU fallback must not reskin thousands of vertices or upload again.
Renderer.setGpuSkinning(false);
handle.update();
const beforeCameraOnlyTurn = position.version; // BufferAttribute upload generation for camera-only yaw tests.
const neutralRestVersion = handle.baseVersion; // Render-only poses must never reset the garment's original binding.
model.rotation.y = Math.PI;
model.updateMatrixWorld(true);
handle.update(true);
assert.strictEqual(position.version, beforeCameraOnlyTurn,
  'a 180-degree whole-avatar render turn does not trigger a false bone-pose upload');
model.rotation.y = 0;
model.updateMatrixWorld(true);
handle.update(true);
assert.strictEqual(position.version, beforeCameraOnlyTurn,
  'returning to the original model orientation also leaves skinning untouched');
model.scale.x = -1; // An X-reflected portrait must not masquerade as a newly rotated thigh.
model.updateMatrixWorld(true);
handle.update(true);
assert.strictEqual(position.version, beforeCameraOnlyTurn,
  'a reflected whole-avatar matrix does not change avatar-local pants bone transforms');
model.scale.x = 1;
model.updateMatrixWorld(true);
handle.update(true);
assert.strictEqual(position.version, beforeCameraOnlyTurn,
  'restoring a reflected avatar does not upload the same neutral pants pose again');

// Opposing legs can cancel in a weighted scalar pose hash. Every bone must
// still contribute independently so simultaneous left/right motion updates the garment.
nodes.left.thigh.position.x -= 0.075;
nodes.right.thigh.position.x += 0.075;
model.updateMatrixWorld(true);
handle.update(true);
assert(position.version > beforeCameraOnlyTurn,
  'opposing thigh offsets are recognized as a real local-pose change');
const shifted = Float32Array.from(position.array); // CPU-skinned positions after both thighs move.
assert(shifted.some((v, i) => Math.abs(v - cpu[i]) > 0.01),
  'the pants themselves deform when opposing thighs move');
assert.strictEqual(handle.baseVersion, neutralRestVersion,
  'render-only thigh offsets never rebind the neutral pants stance');
handle.update(true);
const beforeStillFrame = position.version; // Stable pose should skip the next redundant reskin.
handle.update(true);
assert.strictEqual(position.version, beforeStillFrame,
  'unchanged asymmetric leg pose does not upload on every render-only pass');

// November 14's uniform extremity size changes the actual foot width independently of body-X
// (e.g. male Longoran: X 1.05, Y 2). The same ratio must stretch BOTH fitted pant openings,
// with the pant belt, bone centres, and static authored rig staying intact.
const scaledRoots = { x: 1, y: 1 }; // Mock existing character-rig scale owner: updated after garment attachment.
win.HobunjiCharacterRigScale = { bodyScaleFactorsFor: () => scaledRoots }; // Same API the real foot and pants renderers consult.
const atSample = (sample, axis, vertices) => {
  const j = sample.i * 3 + axis, rowStride = (handle.segments + 1) * 3;
  const top = vertices[j] * (1 - sample.fx) + vertices[j + 3] * sample.fx;
  const bottom = vertices[j + rowStride] * (1 - sample.fx) + vertices[j + rowStride + 3] * sample.fx;
  return top * (1 - sample.fy) + bottom * sample.fy;
}; // Reads one point on the fitted five-point ankle spline from the actual skinned rest grid.
const spanFor = side => {
  const samples = handle.splineSpec[`${side}Ankle`].samples;
  const start = samples[0], end = samples[samples.length - 1];
  return Math.hypot(...[0, 1, 2].map(axis => atSample(end, axis, handle.basePositions) - atSample(start, axis, handle.basePositions)));
}; // Measures the final 3D spline opening, rather than merely checking its configuration multiplier.
const initialSpans = { left: spanFor('left'), right: spanFor('right') }; // The existing species-authored pant openings.
const originalGrid = Float32Array.from(handle.basePositions); // Source garment/waist snapshot before the new foot compensation.
const originalVersion = handle.baseVersion; // Rest-grid rebind should only happen when body proportions actually change.
scaledRoots.x = 1.05; scaledRoots.y = 2;
handle.update(true);
assert(Math.abs(handle.openingWidthScale - (1.05 + 2) / (2 * 1.05)) < 1e-9,
  'Longoran-male pants follow the same 45.2% width compensation used by the foot meshes');
assert.strictEqual(handle.baseVersion, originalVersion + 1, 'changing body proportions rebuilds the fitted garment exactly once');
for (const side of ['left', 'right']) assert(spanFor(side) > initialSpans[side] * 1.12,
  `${side} hem spline visibly widens along its measured 3D chord`);
for (let i = 0; i < (handle.segments + 1) * 3; i++) assert(Math.abs(handle.basePositions[i] - originalGrid[i]) < 1e-6,
  'the upper row of the garment remains exactly anchored to the portrait');
const afterExpansion = handle.baseVersion; // Guard against accidental per-frame rest recalculation.
handle.update(true); handle.update(true);
assert.strictEqual(handle.baseVersion, afterExpansion, 'unchanged body scale does not re-fit pants on extra render passes');

// A GPU-worn pair and the CPU fallback must deform the exact same enlarged hem.
Renderer.setGpuSkinning(false);
handle.update(true);
const expandedCPU = Float32Array.from(position.array); // Ground truth CPU-skinned widened garment.
Renderer.setGpuSkinning(true);
handle.update(true);
assert.strictEqual(handle.gpuSkinActive, true, 'foot-sized hem retains the default GPU skinning path');
for (let i = 0; i < expandedCPU.length / 3; i += 7) {
  const pt = new THREE.Vector3().fromArray(position.array, i * 3), skinned = new THREE.Vector3(), temporary = new THREE.Vector3();
  const weights = [w0[i * 4 + 1], w0[i * 4 + 2], w0[i * 4 + 3], w1[i]]; // Four moving bone channels, besides rigid belt.
  skinned.copy(pt).multiplyScalar(w0[i * 4]);
  for (let bone = 0; bone < 4; bone++) skinned.addScaledVector(temporary.copy(pt).applyMatrix3(u.uPantsBoneM.value[bone]).add(u.uPantsBoneT.value[bone]), weights[bone]);
  skinned.addScaledVector(u.uPantsRingShift.value[0], ring[i * 2]);
  skinned.addScaledVector(u.uPantsRingShift.value[1], ring[i * 2 + 1]);
  skinned.x += spine[i * 3]; skinned.y += spine[i * 3 + 1]; skinned.z += spine[i * 3 + 2];
  assert(skinned.distanceTo(new THREE.Vector3().fromArray(expandedCPU, i * 3)) < 1e-5,
    'GPU and CPU match on the newly lengthened pant-leg spline');
}

// Refit from the ORIGINAL art, never the previous enlarged grid, so live scale changes are reversible.
scaledRoots.x = 1; scaledRoots.y = 1;
handle.update(true);
assert(Math.abs(handle.openingWidthScale - 1) < 1e-9);
for (const side of ['left', 'right']) assert(Math.abs(spanFor(side) - initialSpans[side]) < 1e-5,
  `${side} opening returns to the original authored fit with no accumulated stretch`);
for (let i = 0; i < originalGrid.length; i++) assert(Math.abs(handle.basePositions[i] - originalGrid[i]) < 1e-5,
  'neutral body X/Y completely restores original pants rest grid');

// The initial revision used the raw foot-width multiplier on the mesh, but the ends of
// real authored splines have different calf weights. Test ACTUAL fitted spans for every
// authored character at both player and NPC mesh budgets, not just a synthetic flat hoop.
for (const meshBudget of ['player', 'npc']) {
  for (const [key, character] of Object.entries(rigs.characters)) {
    const actor = makeAvatar(); // Real Three.js avatar/leg hierarchy, with its own garment.
    const [species, gender] = key === '__default' ? ['kenkari', 'female'] : key.split('::');
    const pants = Renderer.attach(THREE, {
      avatarGroup: actor.model, legHandle: { group: actor.legs },
      speciesId: species, gender, garmentRecord: rigs.garments.pants_basic,
      characterRecord: character, meshBudget,
    });
    assert(pants, `pants attached for ${key}/${meshBudget}`);
    const fittedPoint = (sample, axis) => {
      const grid = pants.basePositions, rowStride = (pants.segments + 1) * 3, i = sample.i * 3 + axis;
      const a = grid[i] + (grid[i + 3] - grid[i]) * sample.fx;
      const b = grid[i + rowStride] + (grid[i + rowStride + 3] - grid[i + rowStride]) * sample.fx;
      return a + (b - a) * sample.fy;
    }; // Renderer-exact bilinear sampling (including its final-row/column clamping).
    const fittedSpan = side => {
      const points = pants.splineSpec[`${side}Ankle`].samples;
      return Math.hypot(...[0, 1, 2].map(axis => fittedPoint(points[points.length - 1], axis) - fittedPoint(points[0], axis)));
    }; // Both five-point ankle splines, measured after CPU/GPU-shared rest fitting.
    const baseline = { left: fittedSpan('left'), right: fittedSpan('right') }; // Unscaled ankle opening lengths.
    const originalRest = Float32Array.from(pants.basePositions); // Reversible rebind baseline, including original belt.
    const anchors = ['left', 'right'].map(side => [0, 1, 2].map(axis => fittedPoint(pants.rings[side].anchor, axis)));
    scaledRoots.x = 1.05; scaledRoots.y = 2;
    pants.alignToRest();
    const expected = (scaledRoots.x + scaledRoots.y) / (2 * scaledRoots.x);
    for (const [index, side] of ['left', 'right'].entries()) {
      const actual = fittedSpan(side) / baseline[side];
      assert(Math.abs(actual - expected) < 0.0005,
        `${key}/${meshBudget} ${side}: actual opening ${actual} matches the foot-width ratio ${expected}`);
      for (let axis = 0; axis < 3; axis++) assert(Math.abs(fittedPoint(pants.rings[side].anchor, axis) - anchors[index][axis]) < 1e-5,
        `${key}/${meshBudget}: the ${side} calf-bone opening centre does not drift`);
    }
    for (let i = 0; i < (pants.segments + 1) * 3; i++) assert.strictEqual(pants.basePositions[i], originalRest[i],
      `${key}/${meshBudget}: the waistband never stretches with the feet`);
    scaledRoots.x = scaledRoots.y = 1;
    pants.alignToRest();
    for (let i = 0; i < originalRest.length; i++) assert(Math.abs(pants.basePositions[i] - originalRest[i]) < 1e-5,
      `${key}/${meshBudget}: resizing back to neutral never accumulates garment drift`);
    pants.dispose();
  }
}

// A hunch is sampled from REST positions, not animated feet. Resizing the cuff with an
// unchanged spine profile must still rebuild those sampled shifts; otherwise the PNG
// upper-body portrait and the pants separate after a late species-scale update.
const hunch = { curve: {} }; // Same persistent spine-curve identity across both refits.
const previousSpine = win.HobunjiCharacterSpine; // Restore the test sandbox after checking the hunch.
model.userData.hobunjiSpine = hunch;
win.HobunjiCharacterSpine = { deformAt: (_profile, height, displacement) => {
  displacement.x = height * 0.25; displacement.y = height * 0.02; displacement.z = 0;
} };
handle.update(true);
assert(handle.spineShift, 'test hunch installs actual per-vertex pants shifts');
scaledRoots.x = 1.05; scaledRoots.y = 2;
handle.update(true);
assert.strictEqual(handle.spineCurve, hunch.curve, 'resize preserves the same authored hunch');
for (let i = 0; i < handle.basePositions.length / 3; i += 13) {
  const expectedX = (handle.basePositions[i * 3 + 1] - model.getObjectByName('frontPlane').position.y) * 0.25;
  assert(Math.abs(handle.spineShift[i * 3] - expectedX) < 1e-5,
    'hunch offsets are resampled from the newly widened garment on a late body-scale change');
}
scaledRoots.x = scaledRoots.y = 1;
handle.update(true);
delete model.userData.hobunjiSpine;
win.HobunjiCharacterSpine = previousSpine;

console.log(`ok pants GPU skin parity (${cpu.length / 3} vertices, max error ${worst.toExponential(2)})`);

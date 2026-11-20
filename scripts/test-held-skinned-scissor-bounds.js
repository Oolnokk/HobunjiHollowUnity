#!/usr/bin/env node
'use strict';

// Held replay scissor for skinned bodies (wet neck-rigged portraits, wings,
// pet overlays). replayScissorRect used to reject every SkinnedMesh, which
// forced the held/tint replay to redraw the whole screen (device report:
// held=skinned-mesh, ~700 extra draws a frame). It now bounds them per bone.
//
// Runs the shipping replayScissorRect + skinned helpers against real Three.js
// r128 and checks every vertex, skinned exactly the way the r128 vertex shader
// does it (vec4 sum of bone matrices, no divide), lands inside the rectangle:
// posed rigs, a skeleton not refreshed since the bones moved, a never-uploaded
// skeleton, weights summing below 1, random poses. Also checks every case it
// cannot prove keeps the full-screen fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let THREE;
try {
  THREE = require('three');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('SKIPPED held skinned scissor bounds: three@0.128.0 is unavailable.');
  process.exit(0);
}

const source = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/held-object-render-order.js'), 'utf8');
const slice = (startMarker, endMarker) => {
  const a = source.indexOf(startMarker), b = source.indexOf(endMarker, a + startMarker.length);
  assert.ok(a > 0 && b > a, 'found ' + startMarker);
  return source.slice(a, b);
};
const api = new Function('THREE', [
  'let lastReplayScissorCoverage = 1, lastScissorFailureReason = "none";',
  'const scissorViewport = new THREE.Vector4(), scissorDrawingSize = new THREE.Vector2(), SCISSOR_MARGIN_PX = 4;',
  'let scissorTargetWidth = 0, scissorTargetHeight = 0, scissorMinimumWorldY = Infinity;',
  slice('  const scissorBox = new THREE.Box3();', '  const scissorRect = new THREE.Vector4();'),
  slice('  function replayScissorRect(', '  function restoreRendererScissor('),
  'return { replayScissorRect, reason: () => lastScissorFailureReason, setSkinned: v => { skinnedScissorEnabled = v; }, count: () => skinnedScissorBounds };',
].join('\n'))(THREE);

const W = 800, H = 600;
const renderer = {
  getRenderTarget: () => null,
  getDrawingBufferSize: v => v.set(W, H),
  getCurrentViewport: v => v.set(0, 0, W, H),
};
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
camera.position.set(0.6, 1.4, 6);
camera.lookAt(0, 1, 0);
camera.updateMatrixWorld(true);

// A portrait-like plane: three spine bones up the middle, a head bone at the top.
function makeRig({ weightScale = 1, offsetX = 0 } = {}) {
  const geometry = new THREE.PlaneGeometry(1.2, 2.4, 6, 12);
  geometry.translate(offsetX, 1.2, 0); // offsetX: body away from the mesh origin, where pulled-in vertices go.
  const pos = geometry.attributes.position;
  const skinIndex = [], skinWeight = [];
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(0.999, pos.getY(i) / 2.4)) * 3; // 0..3 along the spine
    const lower = Math.floor(t), blend = t - lower;
    skinIndex.push(lower, Math.min(3, lower + 1), 0, 0);
    skinWeight.push((1 - blend) * weightScale, blend * weightScale, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const bones = [0, 1, 2, 3].map(() => new THREE.Bone());
  bones[1].position.y = 0.8; bones[2].position.y = 0.8; bones[3].position.y = 0.8;
  bones[0].add(bones[1]); bones[1].add(bones[2]); bones[2].add(bones[3]);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial({ skinning: true }));
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  const owner = new THREE.Group(); // Like the avatar assembly group: the actor moves the parent.
  owner.add(mesh);
  return { mesh, bones, owner };
}
function pose(rig, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  rig.owner.position.set(rnd() * 1.2, rnd() * 0.3, rnd() * 1.5);
  rig.owner.rotation.set(rnd() * 0.2, rnd() * Math.PI, rnd() * 0.2);
  for (const bone of rig.bones) bone.rotation.set(rnd() * 0.7, rnd() * 0.7, rnd() * 0.9);
  rig.bones[3].scale.setScalar(1 + Math.abs(rnd()) * 0.6); // Head-scale bone.
  rig.owner.updateMatrixWorld(true);
}
// The r128 skinning vertex shader, verbatim in maths: no weight normalization, no w divide.
function shaderSkinnedWorld(mesh, i, boneMatrices) {
  const g = mesh.geometry, p = new THREE.Vector4().fromBufferAttribute(g.attributes.position, i);
  p.w = 1;
  const skinVertex = p.applyMatrix4(mesh.bindMatrix);
  const skinned = new THREE.Vector4(0, 0, 0, 0);
  const index = new THREE.Vector4().fromBufferAttribute(g.attributes.skinIndex, i);
  const weight = new THREE.Vector4().fromBufferAttribute(g.attributes.skinWeight, i);
  for (const k of ['x', 'y', 'z', 'w']) {
    const m = new THREE.Matrix4().fromArray(boneMatrices, index[k] * 16);
    skinned.add(skinVertex.clone().applyMatrix4(m).multiplyScalar(weight[k]));
  }
  const transformed = skinned.applyMatrix4(mesh.bindMatrixInverse);
  return new THREE.Vector3(transformed.x, transformed.y, transformed.z).applyMatrix4(mesh.matrixWorld);
}
function toPixel(world) {
  const ndc = world.clone().project(camera);
  // Clamped to the framebuffer: the rectangle is too, and off-screen pixels are never drawn.
  return { x: Math.min(W, Math.max(0, (ndc.x * 0.5 + 0.5) * W)), y: Math.min(H, Math.max(0, (ndc.y * 0.5 + 0.5) * H)) };
}
function assertContains(rect, mesh, boneMatrices, label) {
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    const px = toPixel(shaderSkinnedWorld(mesh, i, boneMatrices));
    assert.ok(px.x >= rect.x - 1e-3 && px.x <= rect.x + rect.z + 1e-3 && px.y >= rect.y - 1e-3 && px.y <= rect.y + rect.w + 1e-3,
      `${label}: vertex ${i} at ${px.x.toFixed(1)},${px.y.toFixed(1)} outside scissor ${rect.x},${rect.y} ${rect.z}x${rect.w}`);
  }
}
const scissor = (meshes) => {
  const out = new THREE.Vector4();
  return { ok: api.replayScissorRect(renderer, camera, meshes, out), out };
};

// 1. Posed rigs: bounded (not full screen) and every shader-skinned vertex inside.
let tightest = 1;
for (let seed = 1; seed <= 40; seed++) {
  const rig = makeRig();
  pose(rig, seed * 7919);
  rig.mesh.skeleton.update(); // What the renderer uploads this frame.
  const { ok, out } = scissor([rig.mesh]);
  assert.ok(ok, `seed ${seed}: bounded (${api.reason()})`);
  assert.equal(api.reason(), 'none');
  assertContains(out, rig.mesh, rig.mesh.skeleton.boneMatrices, `seed ${seed}`);
  tightest = Math.min(tightest, (out.z * out.w) / (W * H));
}
assert.ok(tightest < 0.25, `the rectangle stays local to the body (best coverage ${tightest.toFixed(3)})`);

// The bind-pose box alone (what a rigid mesh would use) does NOT contain a bent body.
{
  const rig = makeRig();
  rig.bones[1].rotation.z = 1.2; rig.owner.updateMatrixWorld(true); rig.mesh.skeleton.update();
  rig.mesh.geometry.computeBoundingBox();
  const bindBox = rig.mesh.geometry.boundingBox.clone().applyMatrix4(rig.mesh.matrixWorld);
  let outside = 0;
  for (let i = 0; i < rig.mesh.geometry.attributes.position.count; i++) {
    if (!bindBox.containsPoint(shaderSkinnedWorld(rig.mesh, i, rig.mesh.skeleton.boneMatrices))) outside++;
  }
  assert.ok(outside > 0, 'a rigid box would clip a bent skinned body: per-bone bounds are needed');
}

// 2. Bones moved after the last upload: the GPU may still draw the uploaded pose, or refresh it.
{
  const rig = makeRig();
  pose(rig, 11);
  rig.mesh.skeleton.update();
  const uploaded = rig.mesh.skeleton.boneMatrices.slice();
  for (const bone of rig.bones) bone.rotation.z += 0.8;
  rig.owner.updateMatrixWorld(true);
  const { ok, out } = scissor([rig.mesh]);
  assert.ok(ok);
  assertContains(out, rig.mesh, uploaded, 'stale upload');
  const fresh = new THREE.Skeleton(rig.bones, rig.mesh.skeleton.boneInverses); fresh.update();
  assertContains(out, rig.mesh, fresh.boneMatrices, 'fresh pose');
}

// 3. Never-uploaded skeleton (all-zero bone matrices): vertices collapse to the mesh origin.
{
  const rig = makeRig({ offsetX: 1.6 });
  rig.owner.position.set(-1.2, 0, 0); rig.owner.updateMatrixWorld(true); // Rest pose: the origin is outside the body's own rectangle.
  assert.ok(rig.mesh.skeleton.boneMatrices.every(v => v === 0));
  const body = new THREE.Box3().setFromBufferAttribute(rig.mesh.geometry.attributes.position).applyMatrix4(rig.mesh.matrixWorld);
  const origin = toPixel(new THREE.Vector3().setFromMatrixPosition(rig.mesh.matrixWorld));
  assert.ok(toPixel(body.min).x - origin.x > 20, 'fixture: the mesh origin projects well left of the body');
  const { ok, out } = scissor([rig.mesh]);
  assert.ok(ok, api.reason());
  assertContains(out, rig.mesh, rig.mesh.skeleton.boneMatrices, 'zero upload');
  rig.mesh.skeleton.update();
  assertContains(out, rig.mesh, rig.mesh.skeleton.boneMatrices, 'after first upload');
}

// 4. Weights summing below 1 pull vertices toward the mesh origin; still covered.
{
  const rig = makeRig({ weightScale: 0.6, offsetX: 1.6 });
  rig.owner.position.set(-1.2, 0, 0); rig.owner.updateMatrixWorld(true); // Rest pose: 0.6·p lands between the origin and the body.
  rig.mesh.skeleton.update();
  const { ok, out } = scissor([rig.mesh]);
  assert.ok(ok);
  assertContains(out, rig.mesh, rig.mesh.skeleton.boneMatrices, 'weights below one');
}

// 5. Anything it cannot prove keeps the full-screen fallback.
{
  const over = makeRig({ weightScale: 1.3 });
  pose(over, 5); over.mesh.skeleton.update();
  assert.equal(scissor([over.mesh]).ok, false);
  assert.equal(api.reason(), 'skinned-weights-unbounded');

  const bad = makeRig();
  bad.mesh.geometry.attributes.skinIndex.setX(3, 9); bad.mesh.geometry.attributes.skinIndex.needsUpdate = true;
  pose(bad, 6); bad.mesh.skeleton.update();
  assert.equal(scissor([bad.mesh]).ok, false);
  assert.equal(api.reason(), 'skinned-bone-index');

  const hooked = makeRig();
  pose(hooked, 8); hooked.mesh.skeleton.update();
  hooked.mesh.onBeforeRender = () => {}; // e.g. shoulder-pet yaw re-poses the bones at draw time.
  assert.equal(scissor([hooked.mesh]).ok, false);
  assert.equal(api.reason(), 'skinned-draw-hook');

  const morphed = makeRig();
  pose(morphed, 9); morphed.mesh.skeleton.update();
  morphed.mesh.geometry.morphAttributes.position = [morphed.mesh.geometry.attributes.position.clone()];
  assert.equal(scissor([morphed.mesh]).ok, false);
  assert.equal(api.reason(), 'morphed-mesh');

  const plain = makeRig();
  pose(plain, 10); plain.mesh.skeleton.update();
  api.setSkinned(false); // HeldObjectRenderOrder.setSkinnedScissorEnabled(false): the old behaviour, for A/B.
  assert.equal(scissor([plain.mesh]).ok, false);
  assert.equal(api.reason(), 'skinned-mesh');
  api.setSkinned(true);
  assert.equal(scissor([plain.mesh]).ok, true);
}

// 6. The cached per-bone boxes follow geometry edits (attribute versions).
{
  const rig = makeRig();
  pose(rig, 41); rig.mesh.skeleton.update();
  assert.ok(scissor([rig.mesh]).ok);
  const p = rig.mesh.geometry.attributes.position;
  p.setY(0, 6); p.needsUpdate = true; // A vertex moved far above the old bounds.
  const { ok, out } = scissor([rig.mesh]);
  assert.ok(ok);
  assertContains(out, rig.mesh, rig.mesh.skeleton.boneMatrices, 'after a geometry edit');
}
assert.ok(api.count() > 40, 'snapshot counter counts bounded skinned meshes');

// 7. The player's neck-rigged portrait carries portrait-plane-outline-parity.js's draw hook,
// which freezes depth-only redraws to the last visible matrix. That adapter now advertises
// the same two-pose contract as the hand/foot adapters, so the skinned bound covers both.
{
  const parity = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/portrait-plane-outline-parity.js'), 'utf8');
  const a = parity.indexOf('  const MAX_SNAPSHOT_AGE_MS'), b = parity.indexOf('  const PNG_PLANE_OUTLINE_OCCLUDER_MASK');
  assert.ok(a > 0 && b > a, 'portrait parity adapter slice');
  const installMeshHook = new Function('THREE', 'performance', parity.slice(a, b) + '\nreturn installMeshHook;')(THREE, { now: () => clock });
  let clock = 1000;
  const rig = makeRig();
  pose(rig, 101); rig.mesh.skeleton.update();
  assert.ok(installMeshHook(rig.mesh));
  const visible = new THREE.MeshBasicMaterial(), depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const draw = material => { rig.mesh.onBeforeRender(null, {}, camera, rig.mesh.geometry, material, null); const world = rig.mesh.matrixWorld.clone(); rig.mesh.onAfterRender(null, {}, camera, rig.mesh.geometry, material, null); return world; };
  draw(visible); // Base pass: the adapter captures this matrix.
  rig.owner.position.x += 1.4; rig.owner.rotation.y += 0.9; rig.owner.updateMatrixWorld(true); // The actor moves before the replay.
  clock += 20; // Still a fresh snapshot.
  const { ok, out } = scissor([rig.mesh]);
  assert.ok(ok, `parity portrait bounded (${api.reason()})`);
  // The replay's colourless depth draw really uses the frozen matrix, with the current bindMatrixInverse.
  rig.mesh.onBeforeRender(null, {}, camera, rig.mesh.geometry, depthOnly, null);
  assertContains(out, rig.mesh, rig.mesh.skeleton.boneMatrices, 'frozen depth pose');
  rig.mesh.onAfterRender(null, {}, camera, rig.mesh.geometry, depthOnly, null);
  assertContains(out, rig.mesh, rig.mesh.skeleton.boneMatrices, 'current colour pose');
  // A hook chained on top of the adapter is unknown again: full screen.
  const adapter = rig.mesh.onBeforeRender;
  rig.mesh.onBeforeRender = function wrapped(...args) { return adapter.apply(this, args); };
  assert.equal(scissor([rig.mesh]).ok, false);
  assert.equal(api.reason(), 'skinned-draw-hook');
}

// 8. Replay culling: a parity snapshot equal to matrixWorld is no alternate pose (portraits stay
// cullable); a different fresh one keeps the mesh out of the cull; a stale one is ignored.
{
  const hasAlternateReplayPose = new Function(slice('  function hasAlternateReplayPose(', '\n  }\n') + '\n  }\nreturn hasAlternateReplayPose;')();
  let fresh = true;
  const hook = () => {};
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  mesh.position.set(2, 0, 0); mesh.updateMatrixWorld(true);
  mesh.onBeforeRender = hook;
  Object.defineProperty(mesh, '__hobunjiXrayBoundParity', { configurable: true, value: { hook, visibleMatrixWorld: mesh.matrixWorld.clone(), isFresh: () => fresh } });
  assert.equal(hasAlternateReplayPose(mesh), false, 'same matrix: cull as usual');
  mesh.position.x = 5; mesh.updateMatrixWorld(true);
  assert.equal(hasAlternateReplayPose(mesh), true, 'moved since the visible draw: never culled on the current matrix alone');
  fresh = false;
  assert.equal(hasAlternateReplayPose(mesh), false, 'stale snapshot: the hook will not use it');
  fresh = true; mesh.onBeforeRender = () => {};
  assert.equal(hasAlternateReplayPose(mesh), false, 'contract belongs to a different hook');
}

// Wiring: the switch and counter are on the public API and in snapshot().
assert.match(source, /setSkinnedScissorEnabled: value =>/);
assert.match(source, /skinnedScissorEnabled, skinnedScissorBounds,/);

console.log('held skinned scissor bounds: per-bone rectangle contains every shader-skinned vertex (posed, stale, zero, sub-unit weights); unprovable cases fall back');

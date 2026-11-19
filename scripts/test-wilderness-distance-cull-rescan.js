'use strict';
// Rescans follow WildernessChunks residency changes (not a timer), reuse scratch state, and drop records outside zones.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/wilderness-distance-cull.js', 'utf8');
const clock = { now: 0 };
class Box3 {
  constructor(min = { x: 0, y: 0, z: 0 }, max = { x: 0, y: 0, z: 0 }) { this.min = { ...min }; this.max = { ...max }; }
  copy(o) { this.min = { ...o.min }; this.max = { ...o.max }; return this; }
  applyMatrix4(m) { for (const p of [this.min, this.max]) { p.x += m.elements[12]; p.z += m.elements[14]; } return this; }
  isEmpty() { return false; }
}
let version = 1;
const window = {
  THREE: { Box3, Sphere: class {}, Object3D: function () {} },
  WildernessChunks: { residencyVersion: () => version },
};
vm.runInNewContext(source, { window, performance: { now: () => clock.now } });
const api = window.WildernessDistanceCull;
const mk = (name, x, userData = {}) => ({
  name, userData, children: [], visible: true, isMesh: true, frustumCulled: true, matrixWorld: { elements: [1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1] },
  geometry: { attributes: { position: { version: 0 } }, boundingBox: new Box3({ x: -1, y: 0, z: -1 }, { x: 1, y: 1, z: 1 }), computeBoundingBox() {} },
});
const scene = { name: 'zone', userData: {}, children: [], visible: true, isScene: true };
const chunk = { name: 'c', userData: { wildernessChunk: true }, children: [], visible: true, parent: scene };
scene.children.push(chunk);
const add = (m) => { m.parent = chunk; chunk.children.push(m); return m; };
add(mk('rock', 200));
const camera = { isCamera: true, matrixWorld: { elements: new Array(16).fill(0) }, updateMatrixWorld() {} };
const run = (opts = { isZone: true }) => { const r = api.suspendForRender(scene, camera, { x: 0, z: 0 }, opts); r?.(); };

run();
assert.equal(api.snapshot().scans, 1, 'first frame scans');
for (let i = 0; i < 20; i++) { clock.now += 100; run(); }
assert.equal(api.snapshot().scans, 1, 'no timer rescans while chunk residency is unchanged (2s)');
const late = add(mk('rock_late', 210)); // a chunk streamed in
version++;
clock.now += 100; run();
assert.equal(api.snapshot().scans, 2, 'residency change triggers one rescan');
assert.equal(api.snapshot().hidden, 2, 'newly streamed mesh is culled after the rescan');
version++; clock.now += 10; run();
assert.equal(api.snapshot().scans, 2, 'rapid residency churn is throttled to the minimum interval');
clock.now += 5100; run();
assert.equal(api.snapshot().scans, 3, 'throttled change is picked up once its interval passes');
clock.now += 5100; run();
assert.equal(api.snapshot().scans, 4, 'idle safety net rescans without a residency change');
run({ isZone: false });
clock.now += 10; run();
assert.equal(api.snapshot().scans, 5, 'leaving the zone drops the retained candidate record');
assert.equal(late.visible, true, 'restored after every frame');
// Batch membership changes are independent of chunk residency: the far mesh
// must be found and culled immediately rather than five seconds later.
const scansBeforeBatch = api.snapshot().scans;
const replacement = mk('zone_prop_render_batch', 210, { hobunjiZonePropBatch: true, hobunjiZonePropKind: 'furniture' });
replacement.parent = scene; scene.children.push(replacement);
scene.userData.hobunjiZonePropBatchRevision = 1;
run();
assert.equal(api.snapshot().scans, scansBeforeBatch + 1, 'new prop batch triggers immediate candidate rescan');
assert.equal(api.snapshot().hiddenBatch, 1, 'distant replacement batch is culled on the same render');
assert.equal(replacement.visible, true, 'render-only suppression restores the original visibility');

console.log('PASS wilderness distance cull rescan: residency-driven, batch invalidation, idle safety net');

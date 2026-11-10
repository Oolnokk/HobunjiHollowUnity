'use strict';
// Regression: a flail rope must attach to the haft pose the renderer draws.
// The player's tool holder overrides updateMatrixWorld to bake the idle stance
// (weapon-tool-stances.js); Object3D.updateWorldMatrix()/getWorld*() bypass that
// override, which left the rope ~0.7 units away from the haft in idle.
// Run: node scripts/test-flail-baked-holder-pose.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8');
const registry = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8');
const window = { RuntimeFrameScheduler: { register() {} } };
vm.runInNewContext(registry, { window });
vm.runInNewContext(source, {
  window, document: {}, URL, setTimeout: () => {}, performance: { now: () => 0 },
  location: { href: 'https://example.test/game.html', pathname: '/game.html' },
});
const { refreshWorldMatrix, bakedPoint } = window.HobunjiWeaponSpriteAssemblies;
assert.equal(typeof refreshWorldMatrix, 'function');

// Minimal Object3D stand-in that records which update path ran.
function node(name, parent = null) {
  const n = { name, parent, calls: [], baked: false };
  n.updateWorldMatrix = function (updateParents) { this.calls.push('raw'); if (updateParents) this.parent?.updateWorldMatrix(true, false); };
  return n;
}

// scene -> holder (own updateMatrixWorld override) -> root -> plane
{
  const scene = node('scene'), holder = node('holder', scene), root = node('root', holder), plane = node('plane', root);
  holder.updateMatrixWorld = function (force) { this.calls.push('baked:' + force); };
  refreshWorldMatrix(plane);
  assert.deepEqual(holder.calls, ['baked:true'], 'the overriding holder is refreshed through its own updateMatrixWorld');
  assert.deepEqual(scene.calls, ['raw'], 'ancestors above the holder use the normal path');
  assert.deepEqual(plane.calls, [], 'the raw path must not rerun and clobber the baked holder matrix');
  assert.deepEqual(root.calls, []);
}

// The OUTERMOST overriding ancestor wins, so nested overrides still run once, top-down.
{
  const scene = node('scene'), outer = node('outer', scene), inner = node('inner', outer), plane = node('plane', inner);
  outer.updateMatrixWorld = function () { this.calls.push('baked'); };
  inner.updateMatrixWorld = function () { this.calls.push('inner-baked'); };
  refreshWorldMatrix(plane);
  assert.deepEqual(outer.calls, ['baked']);
  assert.deepEqual(inner.calls, []);
}

// Holders without an override (NPCs, editor previews) keep the original behavior.
{
  const scene = node('scene'), holder = node('holder', scene), plane = node('plane', holder);
  refreshWorldMatrix(plane);
  assert.deepEqual(plane.calls, ['raw']);
  assert.deepEqual(holder.calls, ['raw'], 'ordinary parents refresh through updateWorldMatrix(true)');
}

// updateOne must not reintroduce the bypassing calls.
const updateOne = source.slice(source.indexOf('function updateOne('), source.indexOf('function tick('));
assert(!/\.getWorld(Quaternion|Scale|Position)\(/.test(updateOne), 'getWorld*() recompute from raw local transforms and clobber the baked holder pose');
assert(!/\.updateWorldMatrix\(/.test(updateOne), 'use refreshWorldMatrix() so holder updateMatrixWorld overrides run');
// Execute the actual cached-matrix conversion against rotated and translated
// weapon frames. The player's side-held flail turns a local Y anchor into world X.
class Point {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  copy(other) { Object.assign(this, { x:other.x, y:other.y, z:other.z }); return this; }
  applyMatrix4(m) {
    const x = this.x, y = this.y; // Snapshot the local point before the in-place rotation.
    this.x = m.tx + Math.cos(m.angle) * x - Math.sin(m.angle) * y;
    this.y = m.ty + Math.sin(m.angle) * x + Math.cos(m.angle) * y;
    return this;
  }
}
class BakedMatrix {
  constructor(tx = 0, ty = 0, angle = 0) { Object.assign(this, { tx, ty, angle }); }
  copy(other) { Object.assign(this, { tx:other.tx, ty:other.ty, angle:other.angle }); return this; }
  invert() {
    const angle = -this.angle, tx = this.tx, ty = this.ty; // Inverse translation is -R^-1 * t.
    this.tx = -Math.cos(angle) * tx + Math.sin(angle) * ty;
    this.ty = -Math.sin(angle) * tx - Math.cos(angle) * ty;
    this.angle = angle;
    return this;
  }
}
const bakedMain = { matrixWorld:new BakedMatrix(2, 3, 0) }; // Source-straight haft, left here as a control.
const bakedOff = { matrixWorld:new BakedMatrix(7, -2, Math.PI / 2) }; // Authored side-held haft rotated 90 degrees.
const inverseScratch = new BakedMatrix(); // Reused inverse instead of allocating while simulating frames.
const localAnchor = new Point(0, -0.4); // Deliberately offset on the haft's LOCAL Y axis.
const mainAnchor = bakedPoint(localAnchor, bakedMain, null, inverseScratch, new Point());
const offAnchor = bakedPoint(localAnchor, bakedOff, null, inverseScratch, new Point());
assert(Math.abs(mainAnchor.x - 2) < 1e-9 && Math.abs(mainAnchor.y - 2.6) < 1e-9, 'unrotated haft retains authored local Y');
assert(Math.abs(offAnchor.x - 7.4) < 1e-9 && Math.abs(offAnchor.y + 2) < 1e-9, 'side-held haft rotates local Y into world X and stays attached');
const sameFramePoint = bakedPoint(offAnchor, null, bakedOff, inverseScratch, new Point());
assert(Math.abs(sameFramePoint.x) < 1e-9 && Math.abs(sameFramePoint.y + 0.4) < 1e-9, 'rope and head both convert back to their own baked weapon coordinates');
assert(!/\\.localToWorld\\(|\\.worldToLocal\\(/.test(updateOne), 'animation update never re-enters raw world-matrix recalculation');
console.log('flail baked holder pose tests passed');

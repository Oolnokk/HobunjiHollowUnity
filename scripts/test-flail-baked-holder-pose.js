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
const { refreshWorldMatrix } = window.HobunjiWeaponSpriteAssemblies;
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
console.log('flail baked holder pose tests passed');

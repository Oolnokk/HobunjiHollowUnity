#!/usr/bin/env node
'use strict';
// Regression: a reflected portrait must not make both feet acquire a 180-degree
// half-turn, and a temporary camera/stance yaw must undo the entire leg pose.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const legsSource = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8');
const composerSource = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8');

function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start >= 0 && end > start, 'real runtime helper exists: ' + from);
  return source.slice(start, end);
}
class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  identity() { return this.copy(new Q()); }
  multiply(q) {
    const a = this.clone();
    return this.copy(new Q(
      a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z
    ));
  }
  premultiply(q) { return this.copy(q.clone().multiply(this)); }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this.normalize(); }
  normalize() {
    const d = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= d; this.y /= d; this.z /= d; this.w /= d; return this;
  }
  setFromAxisAngle(axis, radians) {
    const s = Math.sin(radians / 2);
    return this.copy(new Q(axis.x * s, axis.y * s, axis.z * s, Math.cos(radians / 2)));
  }
}
const AXIS_Y = { x: 0, y: 1, z: 0 }, AXIS_X = { x: 1, y: 0, z: 0 };
const yaw = angle => new Q().setFromAxisAngle(AXIS_Y, angle);
const pitch = angle => new Q().setFromAxisAngle(AXIS_X, angle);
const equalOrientation = (a, b) => Math.abs(Math.abs(
  a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
) - 1) < 1e-8;

const worldHelperSource = between(legsSource,
  '  function worldQuaternionWithoutScale(node, out) {', '\n  function normalizeKey(value) {');
const worldWithoutScale = new Function(worldHelperSource + '\nreturn worldQuaternionWithoutScale;')();
const sceneRoot = { quaternion: pitch(0.16), parent: null };
const reflectedAvatar = { quaternion: yaw(0.72), parent: sceneRoot, scale: { x: -1, y: 1, z: 1 } };
const thigh = { quaternion: pitch(-0.21), parent: reflectedAvatar };
const calf = { quaternion: yaw(-0.34), parent: thigh };
const correct = sceneRoot.quaternion.clone().multiply(reflectedAvatar.quaternion)
  .multiply(thigh.quaternion).multiply(calf.quaternion);
calf.getWorldQuaternion = out => out.copy(yaw(Math.PI).multiply(correct)); // Three's matrix decomposition can reflect the facing basis.
assert(!equalOrientation(calf.getWorldQuaternion(new Q()), correct), 'fixture models a genuine reflected 180-degree error');
assert(equalOrientation(worldWithoutScale(calf, new Q()), correct), 'foot contact ignores mirrored matrix orientation');

const rollHelperSource = between(legsSource,
  '    function applyFootRollOnly(mesh, roll) {', '\n    function applyLegChain(side) {');
const setRoll = new Function('footAxisX', rollHelperSource + '\nreturn applyFootRollOnly;')(AXIS_X);
const foot = { quaternion: yaw(Math.PI) }; // A contact/cliff pose with the half-turn still present.
setRoll(foot, 0);
assert(equalOrientation(foot.quaternion, new Q()), 'walking/idle ownership clears complete previous foot rotation');
setRoll(foot, 0.27);
assert(equalOrientation(foot.quaternion, pitch(0.27)), 'foot roll remains authored when clearing stale yaw');
assert(legsSource.includes('worldQuaternionWithoutScale(chain.calf, pairedFootRotation)'),
  'the real paired/climbing contact solver uses scale-free world orientation');
assert(legsSource.includes('applyFootRollOnly(mesh, Number(record.roll) || 0)'),
  'recorded poses also reclaim complete foot orientation');

const hierarchySource = between(composerSource,
  '  function hierarchyWorldQuaternion(node, target = new THREE.Quaternion()) {',
  '\n  function quaternionEulerDegrees(quaternion) {');
const composerWorldQ = new Function('THREE', hierarchySource + '\nreturn hierarchyWorldQuaternion;')({ Quaternion: Q });
const counterSource = between(composerSource,
  '  function counterRotateLegRootForRender(legRoot, worldCorrection, undo) {',
  '\n  function applyRenderedFacingDeadzone(camera, undo, renderDebug) {');
const counterLegs = new Function(
  'hierarchyWorldQuaternion', 'legFacingParentWorld', 'legFacingLocalCorrection', 'legFacingWorldInverse',
  counterSource + '\nreturn counterRotateLegRootForRender;'
)(composerWorldQ, new Q(), new Q(), new Q());
for (const correction of [-Math.PI * 0.85, 0.7, Math.PI * 0.95]) {
  const world = { quaternion: pitch(-0.31), parent: null };
  const body = { quaternion: yaw(1.2), parent: world, scale: { x: -1, y: 1, z: 1 } };
  const leg = { quaternion: pitch(0.22).multiply(yaw(-0.15)), parent: body };
  const initialBody = body.quaternion.clone(), initialLeg = leg.quaternion.clone();
  const initialWorldFoot = composerWorldQ(leg, new Q()).clone();
  const visualDelta = yaw(correction); // Render-only camera clamp turns the avatar body.
  body.quaternion.premultiply(visualDelta);
  const undo = [];
  counterLegs(leg, visualDelta, undo);
  assert(equalOrientation(composerWorldQ(leg, new Q()), initialWorldFoot),
    'camera/weapon body yaw leaves leg world orientation unchanged under mirrored and tilted ancestors');
  for (let i = undo.length - 1; i >= 0; i--) undo[i]();
  body.quaternion.copy(initialBody);
  assert(equalOrientation(leg.quaternion, initialLeg), 'render undo restores exact authored foot stance quaternion');
  assert(equalOrientation(composerWorldQ(leg, new Q()), initialWorldFoot),
    'next simulation frame starts without a retained half-turn');
}
console.log('PASS: mirrored foot contacts, stance/climb reset, and render-only body yaw preserve foot facing');

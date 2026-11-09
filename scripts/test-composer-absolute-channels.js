'use strict';

// PlayerBodyTransformComposer channel options used by recorded ragdoll clips and
// the downed crawl: `absoluteLegs` (the leg group keeps only the summed
// translation, never the body tilt) and `absoluteYaw` (final body yaw, resolved
// against the live base yaw at render time). Executes the real functions.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8');
class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w, isQuaternion: true }); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  setFromEuler() { return this.copy(new Q()); } // Rotation-only Euler channels are not asserted on here.
  copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  multiply(q) {
    const { x, y, z, w } = this;
    return this.copy(new Q(w * q.x + x * q.w + y * q.z - z * q.y, w * q.y - x * q.z + y * q.w + z * q.x, w * q.z + x * q.y - y * q.x + z * q.w, w * q.w - x * q.x - y * q.y - z * q.z));
  }
}
class V {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  copy(v) { return Object.assign(this, { x: v.x, y: v.y, z: v.z }); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
}
const context = {
  THREE: { Quaternion: Q, Vector3: V, Euler: class Euler {} }, // Only channelQuaternion's Euler path needs it; rotation values are not asserted here.
  wrapSignedAngle: angle => Math.atan2(Math.sin(angle), Math.cos(angle)),
  channels: new Map(),
  finite: (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback),
};
vm.createContext(context);
const slice = (from, to) => vm.runInContext(source.slice(source.indexOf(from), source.indexOf(to)), context);
slice('  function channelQuaternion(', '  function applyWorldDelta(');
slice('  function setChannel(', '  function clearChannel(');
const { setChannel, resolveDelta, resolveAbsoluteLegsTranslation } = vm.runInContext('({ setChannel, resolveDelta, resolveAbsoluteLegsTranslation })', context);

// No channels: nothing is absolute.
assert.equal(resolveAbsoluteLegsTranslation(), null);

// A townSubtleElevation-style translation alone does not make the legs absolute.
setChannel('elevation', { priority: 50, translation: { x: 0, y: 0.3, z: 0 } });
assert.equal(resolveAbsoluteLegsTranslation(), null, 'ordinary translations keep legs attached');

// The ragdoll channel: legs ignore its tilt but follow every translation (body lowering + elevation) plus the lift.
setChannel('ragdoll', { priority: 100, mode: 'override', quaternion: new Q(0.7, 0, 0, 0.7), translation: { x: 0, y: -0.3, z: 0 }, absoluteLegs: true, absoluteLegsLiftY: 0.06 });
const legs = resolveAbsoluteLegsTranslation();
assert(legs, 'an absoluteLegs channel activates the legs override');
assert(Math.abs(legs.y - (0.3 - 0.3 + 0.06)) < 1e-9, 'legs take the summed translation plus the lift');
assert.equal(legs.x, 0);
const body = resolveDelta('player');
assert(Math.abs(body.rotation.x - 0.7) < 1e-9, 'the body itself still receives the tilt');

// Disabled / player-excluded channels do not count.
setChannel('ragdoll', { priority: 100, enabled: false, absoluteLegs: true });
assert.equal(resolveAbsoluteLegsTranslation(), null, 'a disabled channel releases the legs');
setChannel('ragdoll', { priority: 100, includePlayer: false, absoluteLegs: true });
assert.equal(resolveAbsoluteLegsTranslation(), null, 'a channel that skips the player never owns the legs');

// absoluteYaw: highest-priority channel that defines it wins; plain channels report null.
context.channels.clear();
setChannel('stance', { priority: 5, rotation: { yaw: 0.2 } });
assert.equal(resolveDelta('player').absoluteYaw, null);
setChannel('crawl', { priority: 95, absoluteYaw: 1.25, rotation: { roll: -1.1 } });
assert.equal(resolveDelta('player').absoluteYaw, 1.25);
setChannel('crawl-weapon', { priority: 95, space: 'world', includePlayer: false, translation: { x: 0.2, y: -0.16, z: 0 } });
const external = resolveDelta('external', 'world');
assert(Math.abs(external.translation.y + 0.16) < 1e-9 && external.absoluteYaw === null, 'the weapon channel only carries a world translation');
assert.equal(resolveDelta('player', 'world').translation.x, 0, 'the weapon channel never moves the body');

// The crawl channel excludes the weapon from its roll.
setChannel('crawl', { priority: 95, absoluteYaw: 0.5, includeExternal: false, rotation: { roll: -1.1 } });
assert.equal(resolveDelta('external').applied.includes('crawl'), false);

console.log('composer absolute channels: all assertions passed');

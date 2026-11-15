#!/usr/bin/env node
'use strict';

// The NPC dance hand sentinel runs once per render pass (colour, then shell
// outline). ProceduralHandForearmAlignment re-rotates the danced socket after
// the colour pass, so the dance runtime must still recognise its own pose on
// the outline pass instead of re-basing from the lifted socket and adding the
// overhead punch a second time (outlines floating far above the hands).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'npc-dance-presentation-runtime.js'), 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  distanceToSquared(v) { return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2; }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  dot(q) { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }
}
function socket(name, x) {
  const s = { name, parent: true, children: [], position: new Vector3(x, 0.31, 0), quaternion: new Quaternion(),
    rotateX(a) { this.quaternion.x += a * 0.5; this.quaternion.w = Math.sqrt(Math.max(0, 1 - this.quaternion.x ** 2)); },
    rotateZ() {}, updateMatrix() {}, updateMatrixWorld() {},
    traverse(fn) { fn(this); } };
  return s;
}
const left = socket('left_hand_socket', -0.18);
const right = socket('right_hand_socket', 0.18);
const root = { children: [], position: new Vector3(14.5, 0, 9.5), add(child) { child.parent = this; this.children.push(child); },
  remove() {}, traverse(fn) { fn(this); fn(left); fn(right); } };
const reach = 0.337;
const walker = {
  rec: { id: 'aliri_ginju' }, root, state: 'idle', area: 'map_i_inn', avatarHeight: 0.72, avatarWidth: 0.6,
  avatarGroup: { userData: { proceduralHandRig: { armLengthForSide: () => reach } } },
  currentScheduleTarget: { socialDance: { stimulusId: 'probe', style: 'loose-sway', armStyle: 'overhead-punch' } },
};

const THREE = {
  BufferGeometry: class { setAttribute() {} dispose() {} },
  Float32BufferAttribute: class {},
  MeshBasicMaterial: class { dispose() {} },
  Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; } },
};
const pending = [];
const intervalTicks = []; // Simulates the live NPC poll without rendering its hand sentinel.
const windowObject = {
  THREE,
  SocialRhythmClock: { dancerBeatAt: () => 0.5 }, // Left punch at full extension.
  NpcActivityPlanner: { init() {} },
  setInterval: fn => { intervalTicks.push(fn); return 0; },
  setTimeout: fn => pending.push(fn),
};
const context = { window: windowObject, performance: { now: () => 0 }, console, document: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'npc-dance-presentation-runtime.js' });
windowObject.NpcActivityPlanner.init({ listNpcWalkersInArea: () => [walker], getCurrentArea: () => 'map_i_inn' });
pending.forEach(fn => fn());

const sentinel = root.children.find(child => child.onBeforeRender);
assert.ok(sentinel, 'the dance runtime installs its hand sentinel on the walker');

const restingY = left.position.y;
sentinel.onBeforeRender(); // Colour pass.
const colourY = left.position.y;
assert.ok(colourY > restingY + reach, 'the dance lifts the hand overhead');
assert.ok(colourY <= restingY + 2 * reach + 1e-9, 'one punch rises at most one arm length above the shoulder');

left.quaternion.copy(new Quaternion(0.3, 0, 0, Math.sqrt(1 - 0.09))); // Forearm alignment re-rotates after the colour draw.
sentinel.onBeforeRender(); // Outline (shell) pass in the same frame.
assert.ok(Math.abs(left.position.y - colourY) < 1e-9, 'the outline pass replays the same hand height instead of stacking a second punch');

left.position.y = restingY; // Next frame: the ordinary hand driver rewrites the socket.
sentinel.onBeforeRender();
assert.ok(Math.abs(left.position.y - colourY) < 1e-9, 'a fresh ordinary baseline produces the same single punch');

walker.currentScheduleTarget = {}; // A dance may end without another ordinary hand-driver tick.
sentinel.onBeforeRender();
assert.ok(Math.abs(left.position.y - restingY) < 1e-9, 'cancel restores dance-owned left socket');
assert.ok(Math.abs(right.position.y - restingY) < 1e-9, 'cancel restores dance-owned right socket');
assert.ok(Math.abs(left.quaternion.x) < 1e-8, 'cancel restores the neutral hand twist after a position-only driver refresh');

walker.currentScheduleTarget = { socialDance: { stimulusId: 'return', style: 'loose-sway', armStyle: 'overhead-punch' } };
sentinel.onBeforeRender();
assert.ok(left.position.y > restingY + reach, 'new dance starts from the ordinary baseline');
left.position.y = 42; // New action owns hand position.
left.quaternion.copy(new Quaternion(0.4, 0, 0, Math.sqrt(1 - 0.16))); // New forearm writer owns rotation.
walker.currentScheduleTarget = {};
sentinel.onBeforeRender();
assert.equal(left.position.y, 42, 'cancel never undoes a new hand position owner');
assert.ok(Math.abs(left.quaternion.x - 0.4) < 1e-9, 'cancel never undoes a new forearm owner');

// A hidden NPC may stop dancing while its renderer never invokes onBeforeRender again.
left.position.y = restingY;
right.position.y = restingY;
left.quaternion.copy(new Quaternion());
right.quaternion.copy(new Quaternion());
walker.state = 'idle';
walker.currentScheduleTarget = { socialDance: { stimulusId: 'offscreen', style: 'loose-sway', armStyle: 'overhead-punch' } };
sentinel.onBeforeRender();
assert.ok(left.position.y > restingY + reach, 'offscreen cancellation starts with a real authored dance pose');
walker.currentScheduleTarget = {};
intervalTicks.forEach(fn => fn()); // No sentinel draw after the cancellation.
assert.ok(Math.abs(left.position.y - restingY) < 1e-9, 'poll releases a dance hand even when the NPC is not rendered');
assert.ok(Math.abs(right.position.y - restingY) < 1e-9, 'poll releases both hand sockets');

walker.currentScheduleTarget = { socialDance: { stimulusId: 'departed', style: 'loose-sway', armStyle: 'overhead-punch' },
  c: 100, r: 100 }; // Idle NPC can finish a dance even if it will soon walk away.
sentinel.onBeforeRender();
assert.ok(left.position.y > restingY + reach);
walker.state = 'walking'; // The active social schedule remains but the dancer left its interaction location.
intervalTicks.forEach(fn => fn());
assert.ok(Math.abs(left.position.y - restingY) < 1e-9, 'departing the social spot also releases its hand offset');
walker.state = 'idle';

console.log('NPC dance hand repeat-pass, offscreen cancellation and ownership release: ok');

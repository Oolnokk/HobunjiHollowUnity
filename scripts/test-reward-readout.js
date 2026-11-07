#!/usr/bin/env node
'use strict';

// Exercises the real browser module and world-popup bridge with a small mobile-safe DOM stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let now = 1000; // Deterministic shared clock for world reward lifetime and readout deadlines.
let timerId = 0; // Test timer handles ensure time advances without waiting nine real seconds.
const timers = new Map(); // Timer callbacks keyed by id with their due timestamps.
const listeners = new Map(); // Visibility listeners used to test tab-background reading pauses.
const microtasks = []; // Deferred world popup batches under explicit test control.

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.textContent = '';
    this.hidden = false;
    this.parentNode = null;
    this.isConnected = false;
    if (tag === 'canvas') this.getContext = () => ({
      measureText: text => ({ width: String(text).length * 10 }),
      strokeText() {}, fillText() {},
    }); // Mimics only the text metrics and drawing needed to create actual popup planes.
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...elements) { for (const element of elements) this.appendChild(element); }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    child.isConnected = this.isConnected;
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
    this.isConnected = false;
  }
}
const body = new Element('body'); // Mounted root of the test page.
body.isConnected = true;
const document = {
  body, hidden: false,
  createElement: tag => new Element(tag),
  addEventListener(type, listener) { listeners.set(type, listener); },
}; // Minimal DOM makes it possible to check exact row count and queue contents.
const FakeDate = class extends Date { static now() { return now; } }; // Lets both modules observe the same controllable elapsed time.
const setTimeoutFake = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id; }; // Schedules test callbacks.
const clearTimeoutFake = id => timers.delete(id); // Allows the readout to reschedule its earliest expiration.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  setFromMatrixColumn() { return this; }
  normalize() { return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, scale) { this.x += v.x * scale; this.y += v.y * scale; this.z += v.z * scale; return this; }
}
class Disposable { dispose() {} }
class Plane {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = { copy() {} };
    this.quaternion = { copy() {} };
    this.scale = { setScalar() {} };
    this.userData = {};
    this.parent = null;
  }
}
const THREE = {
  Vector3, CanvasTexture: Disposable, PlaneGeometry: Disposable,
  MeshBasicMaterial: class extends Disposable { constructor() { super(); this.opacity = 1; } },
  Mesh: Plane, SRGBColorSpace: 'srgb', LinearFilter: 1, DoubleSide: 2,
}; // Three.js subset needed by the actual world reward renderer.
const scene = {
  add(plane) { plane.parent = this; },
  remove(plane) { plane.parent = null; },
}; // Scene stub owns and releases the popup planes like the live world.
const playerRoot = {
  updateWorldMatrix() {},
  getWorldPosition(out) { out.x = 0; out.y = 1; out.z = 0; },
}; // Avatar anchor used by WorldPopupText to place its five-row list.
const window = {}; // Both browser modules register their APIs on this shared global.
const context = vm.createContext({
  window, document, THREE, Date: FakeDate,
  performance: { now: () => now }, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
  queueMicrotask: fn => microtasks.push(fn), console,
});
const execute = path => vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path }); // Runs the shipped source instead of a duplicated queue algorithm.
execute('docs/js/reward-readout.js');
const hud = window.RewardReadout; // Public queue and mobile debug snapshot under test.
const snapshot = () => hud.debugSnapshot(); // Convenience for assertions on displayed and waiting rows.
const advance = duration => {
  now += duration;
  for (let i = 0; i < 50; i++) {
    const due = [...timers].filter(([, timer]) => timer.due <= now).sort((a, b) => a[1].due - b[1].due)[0]; // Executes the earliest due timeout first.
    if (!due) return;
    timers.delete(due[0]);
    due[1].fn();
  }
  throw new Error('Timer callbacks did not settle');
};
const flushMicrotasks = () => { while (microtasks.length) microtasks.shift()(); }; // Runs one grouped reward burst.

assert.equal(hud.enqueue('damage', '-10'), false, 'damage floaters never enter the found list');
assert.equal(hud.enqueue('skillXp', '-3 XP'), false, 'negative experience is not an acquisition');
for (let i = 1; i <= 5; i++) assert.equal(hud.enqueue('loot', '+' + i + ' item'), true);
assert.equal(snapshot().visible.length, 5);
assert.equal(body.children[0].children[1].children.length, 5, 'the DOM list contains exactly five reward rows');
hud.enqueue('skillXp', '+6 XP');
hud.enqueue('skillXp', '+6 XP');
assert.equal(snapshot().visible.length, 5, 'new rewards cannot evict a row early');
assert.equal(snapshot().waiting, 2);
assert.equal(snapshot().waitingGroups, 1, 'adjacent identical overflow rewards are coalesced without losing count');
advance(8999);
assert.equal(snapshot().waiting, 2, 'readable rows survive until their full lifetime');
advance(1);
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+6 XP'], 'the next waiting batch appears once slots have expired');
assert.equal(snapshot().visible[0].count, 2);
assert.equal(body.children[0].children[1].children[0].textContent, '+6 XP ×2');
assert.equal(snapshot().waiting, 0);

hud.clear();
hud.enqueue('loot', '+7 leaf');
document.hidden = true;
listeners.get('visibilitychange')();
advance(25000);
assert.equal(snapshot().visible.length, 1, 'a backgrounded page does not consume reading time');
document.hidden = false;
listeners.get('visibilitychange')();
advance(8999);
assert.equal(snapshot().visible.length, 1, 'the remaining reading interval resumes when visible');
advance(1);
assert.equal(snapshot().visible.length, 0);
assert.equal(body.children[0].hidden, true, 'empty HUD never covers the gameplay view');

execute('docs/js/world-popup-text.js');
const world = window.WorldPopupText; // Real five-row world list being integrated with the readout.
world.init({ THREE, playerRoot, camera: { matrixWorld: {}, quaternion: {} }, getActiveScene: () => scene });
hud.clear();
for (let i = 1; i <= 6; i++) world.queueReward('loot', '+' + i + ' rock');
flushMicrotasks();
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+1 rock'], 'a sixth world reward forwards the evicted oldest entry');
world.update(now + 3201);
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+1 rock', '+2 rock', '+3 rock', '+4 rock', '+5 rock'], 'expired world rewards retain their acquisition order');
assert.equal(snapshot().waiting, 1, 'the sixth reward waits instead of discarding the first row');
advance(9000);
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+6 rock'], 'the last acquired reward eventually becomes readable');

hud.clear();
world.queueReward('skillXp', '+9 Mining XP');
flushMicrotasks();
assert.equal(world.releaseScene(scene), 1, 'zone disposal releases its active reward plane');
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+9 Mining XP'], 'scene release preserves already displayed XP in the HUD');
world.clear();
hud.clear();
assert.equal(snapshot().visible.length, 0);
assert.equal(snapshot().waiting, 0, 'explicit clear drops all stale session rewards');

// Authoring an XP popup as Float+ must not silently disable its reward-history handoff.
world.showChange('masteryXp', 4, { text: '+4 Pick Mastery', mode: 'floatPlus' });
flushMicrotasks();
world.update(now + 1400);
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+4 Pick Mastery'], 'Float+ XP also reaches the found list');
world.clear();
hud.clear();

// A destroyed/rebuilt HUD must retain active entries, not replace them with empty markup.
hud.enqueue('loot', '+1 Pine Cone');
const mountedHud = body.children[0]; // Original HUD node must survive a detach and reattach.
mountedHud.remove();
assert.equal(mountedHud.isConnected, false);
hud.enqueue('loot', '+2 Pine Cone');
assert.equal(body.children[0], mountedHud, 'recreated HUD reuses its existing rows');
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+1 Pine Cone', '+2 Pine Cone']);
assert.equal(mountedHud.children[1].children.length, 2, 'reattached DOM still contains the visible rows');
hud.clear();

// Rewards gained before body creation should drain when the page becomes interactive.
const savedBody = document.body; // Restored after the pre-DOM-ready queue test.
document.body = null;
hud.enqueue('loot', '+3 Willow Leaf');
hud.enqueue('skillXp', '+5 Foraging XP');
assert.equal(snapshot().visible.length, 0);
assert.equal(snapshot().waiting, 2, 'pre-body rewards remain queued');
document.body = savedBody;
listeners.get('DOMContentLoaded')();
assert.deepEqual(Array.from(snapshot().visible, entry => entry.text), ['+3 Willow Leaf', '+5 Foraging XP']);
hud.clear();

const html = fs.readFileSync('docs/index.html', 'utf8'); // Ensures the browser loads the HUD before the world popup calls it.
assert(html.indexOf('js/reward-readout.js?') < html.indexOf('js/world-popup-text.js?'));
const css = fs.readFileSync('docs/style.css', 'utf8'); // Ensures missing HUD styling cannot silently ship.
assert(css.includes('#rewardReadout[hidden]'));
assert(css.includes('pointer-events: none; /* Never steals mobile movement'));
console.log('Timed five-row loot/XP readout, FIFO overflow, background pause, world expiry, and zone release: ok');

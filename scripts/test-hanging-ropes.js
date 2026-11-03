#!/usr/bin/env node
'use strict';
// HangingRopes against the real RopePendulum, WorldEvents and Targetables, with a fake Shattercasks.
const assert = require('assert');
globalThis.window = globalThis;
globalThis.performance = performance;
globalThis.WorldEvents = require('../docs/js/world-events.js');
globalThis.Targetables = require('../docs/js/targetables.js');
globalThis.RopePendulum = require('../docs/js/rope-pendulum.js');
const MAP = 'map_test'; const TILE = 64;
const player = { x: 5 * TILE, y: 5 * TILE };
const toasts = [];
globalThis.Combat = { deps: { TILE, player, getCurrentArea: () => MAP, showToast: m => toasts.push(m) } };
const released = [], refreshed = [];
let heldBurden = null;
globalThis.Shattercasks = {
  releaseBurdenWithVelocity(b, v, cause) { released.push({ id: b.id, v: { ...v }, cause }); b.flying = true; return true; },
  detachHeldBurden() { const b = heldBurden; if (b) { b.carried = false; heldBurden = null; } return b; },
  refreshBurdenBounds(b) { refreshed.push(b.id); },
};
require('../docs/js/hanging-ropes.js');
const HR = globalThis.HangingRopes; assert(HR?.installed);

const scene = { children: [], add(o) { o.parent = this; this.children.push(o); }, remove(o) { this.children = this.children.filter(c => c !== o); o.parent = null; } };
const burden = (id = 'b1', extra = {}) => ({ id, mapId: MAP, kind: 'hronalWitchBomb', displayName: 'Witch-bomb', group: { parent: null, position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } }, ...extra });
const events = []; for (const t of ['rope:attach', 'rope:swing', 'rope:release', 'rope:detach']) WorldEvents.on(t, p => events.push([t, p]));
const run = (seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) HR.tick(dt); };
const rope = () => HR.registerRope({ id: 'r1', mapId: MAP, scene, x: 10, y: 4, z: 10, length: 2.4 });
const striker = (travelled, at = { x: 9, z: 10 }) => ({ x: at.x * TILE, y: at.z * TILE, lungeOriginX: at.x * TILE - travelled * TILE, lungeOriginY: at.z * TILE, lungeOriginMs: performance.now() });
const reset = () => { HR.clearScope(MAP); HR.clearScope('other'); released.length = 0; events.length = 0; scene.children.length = 0; Targetables.clear(); };

// ---- attach: the burden hangs at rest under the anchor and becomes a lunge-stop target
reset();
let r = rope(), b = burden();
assert.equal(HR.attach(r, b), true);
assert.deepEqual([b.group.position.x, b.group.position.y, b.group.position.z], [10, 1.6, 10], 'hangs straight below the anchor by the rope length');
assert.equal(b.group.parent, scene, 'reparented into world space');
assert.equal(b.rope, r); assert.equal(b.lungeStop, true, 'a roped burden stops lunges like an enemy'); assert.equal(typeof b.strikeHandler, 'function');
assert.equal(HR.attach(r, burden('b2')), false, 'a rope holds one burden');
assert.equal(HR.attach(HR.registerRope({ id: 'r2', mapId: MAP, scene, x: 1, y: 4, z: 1, length: 2 }), b), false, 'a burden is on one rope at a time');
assert.equal(HR.attach(HR.registerRope({ id: 'r3', mapId: 'other', scene, x: 1, y: 4, z: 1, length: 2 }), burden('b3')), false, 'wrong map');
assert.equal(events.filter(e => e[0] === 'rope:attach').length, 1);
run(1); assert.deepEqual([b.group.position.x, b.group.position.y], [10, 1.6], 'a hanging burden that was not struck stays put');
assert.equal(HR.onStruck(burden('loose'), {}), false, 'a burden not on a rope is not handled');

// ---- weak vs strong strike: apex drop vs launch
function strikeAndRun(travelled, seconds = 6) {
  reset(); const rr = rope(), bb = burden('s'); HR.attach(rr, bb);
  assert.equal(HR.onStruck(bb, { attacker: striker(travelled) }), true);
  run(seconds);
  return { rr, bb, rel: released[0], evs: events.map(e => e[0]) };
}
const weak = strikeAndRun(0.1);
assert(weak.rel, 'a weak strike still ends with the burden let go'); assert.equal(weak.rel.cause, 'rope-drop', 'let go at the forward apex');
assert(Math.hypot(weak.rel.v.x, weak.rel.v.y, weak.rel.v.z) < 1.2, 'at the apex it is nearly still, so it simply drops');
assert(weak.evs.includes('rope:swing') && weak.evs.includes('rope:release'));
const strong = strikeAndRun(1.6);
assert(strong.rel, 'a full-lunge strike releases'); assert.equal(strong.rel.cause, 'rope-launch', 'past the steep-angle limit it is flung, not dropped');
assert(Math.hypot(strong.rel.v.x, strong.rel.v.z) > 4 && strong.rel.v.y > 0, 'and leaves with real horizontal speed, still climbing');
assert(strong.rel.v.x > 0 && Math.abs(strong.rel.v.z) < 1e-6, 'in the direction away from the attacker (+x), no sideways drift');
const speedOf = o => Math.hypot(o.rel.v.x, o.rel.v.y, o.rel.v.z);
const mid = strikeAndRun(0.8);
assert(speedOf(strong) >= speedOf(mid) - 1e-9 || strong.rel.cause === 'rope-launch', 'harder strikes are not gentler');
// the release position follows the swing: farther forward for a harder strike
const swingReach = o => events.find(e => e[0] === 'rope:release')[1].x - 10;
const reachOf = travelled => { const o = strikeAndRun(travelled); return events.find(e => e[0] === 'rope:release')[1].x - 10; };
assert(reachOf(0.1) < reachOf(0.5) && reachOf(0.5) < reachOf(1.0), 'the release point moves out with the lunge distance spent');
assert(reachOf(0.1) < 1.0, 'a close hit moves it only a few feet');
// where a launched burden would land (ballistic, shared fall gravity 13), measured from the rope: a full lunge crosses the room
const landing = o => { const e = events.find(e => e[0] === 'rope:release')[1], v = o.rel.v; const g = 13; const disc = v.y * v.y + 2 * g * (e.y - 0.45); const t = (v.y + Math.sqrt(Math.max(0, disc))) / g; return e.x - 10 + v.x * t; };
assert(landing(strikeAndRun(1.6)) > 5, 'a full lunge launches it across the room');
assert(landing(strikeAndRun(0.1)) < 1.5, 'a close hit leaves it within a few feet');

// ---- direction: it goes away from the attacker, whichever side
reset(); r = rope(); b = burden(); HR.attach(r, b);
HR.onStruck(b, { attacker: striker(1.6, { x: 10, z: 12 }) }); run(6);
assert(released[0].v.z < -2 && Math.abs(released[0].v.x) < 1e-6, 'struck from +z it flies toward -z');

// ---- strike without a recent lunge uses the minimum force; stale lunge origins are ignored
reset(); r = rope(); b = burden(); HR.attach(r, b);
const stale = striker(1.6); stale.lungeOriginMs = performance.now() - 60000;
HR.onStruck(b, { attacker: stale }); run(6);
assert.equal(released[0].cause, 'rope-drop', 'a stale lunge origin does not count as this attack');
reset(); r = rope(); b = burden(); HR.attach(r, b);
HR.onStruck(b, {}); run(6); assert(released.length === 1, 'a strike with no attacker info still swings (default direction) and releases');

// ---- release leaves the burden clean, rope free again
reset(); r = rope(); b = burden(); HR.attach(r, b); HR.onStruck(b, { attacker: striker(0.4) }); run(6);
assert.equal(b.rope, null); assert.equal(b.lungeStop, false); assert.equal(b.strikeHandler, null); assert.equal(r.burden, null, 'rope is free again');
assert.equal(HR.attach(r, burden('again')), true, 'and can take another burden');
assert(refreshed.includes(b.id), 'collision bounds are refreshed while it swings');

// ---- targetable cap follows the rope state (the Shattercasks source reads burden.lungeStop live)
reset(); r = rope(); b = burden(); HR.attach(r, b);
Targetables.addSource('test', () => [{ id: b.id, scope: MAP, hasCap: c => c === 'lungeStop' && b.lungeStop === true, hitbox: () => null, toActor() { return {}; } }]);
assert.equal(Targetables.query(MAP, 'lungeStop').length, 1);
HR.detach(r, 'test'); assert.equal(Targetables.query(MAP, 'lungeStop').length, 0, 'off the rope it no longer stops lunges');

// ---- pickup / loss restore callbacks and detach cleanly
reset(); r = rope(); let pickups = 0, losses = 0;
b = burden('cb', { onPickup: () => pickups++, onLost: () => losses++ }); HR.attach(r, b);
assert.notEqual(b.onPickup, undefined); b.onPickup(b);
assert.equal(pickups, 1, 'the original pickup callback still runs'); assert.equal(r.burden, null, 'picking it up takes it off the rope');
assert.equal(typeof b.onPickup, 'function'); b.onPickup(b); assert.equal(pickups, 2, 'and the original is restored');
reset(); r = rope(); b = burden('cb2', { onLost: () => losses++ }); HR.attach(r, b); b.onLost(b, 'discarded');
assert.equal(losses, 1); assert.equal(r.burden, null, 'a lost burden frees the rope');
reset(); r = rope(); b = burden('gone'); HR.attach(r, b); b.exploded = true; run(0.2); assert.equal(r.burden, null, 'an exploded burden frees the rope');

// ---- hanging a carried burden
reset(); r = rope(); b = burden('held', { carried: true }); heldBurden = b;
player.x = 20 * TILE; player.y = 20 * TILE; assert.equal(HR.tryHang(b), false, 'too far from any rope: the normal drop happens');
assert.equal(heldBurden, b, 'and nothing was taken from the player');
player.x = 10.5 * TILE; player.y = 9 * TILE; // 1.1 tiles from the hook's rest position, inside the 1.8 reach
assert.equal(HR.tryHang(b), true); assert.equal(heldBurden, null, 'taken from the hands'); assert.equal(r.burden, b);
assert(toasts.some(t => /Hung Witch-bomb/.test(t)), 'tells the player: ' + JSON.stringify(toasts));
reset(); r = rope(); const second = burden('h2', { carried: true }); heldBurden = second;
HR.attach(r, burden('occupant')); assert.equal(HR.tryHang(second), false, 'a rope that already holds something is not offered'); player.x = 5 * TILE;

// ---- lifecycle
reset(); r = rope(); b = burden(); HR.attach(r, b); assert.equal(HR.removeRope('r1'), true);
assert.equal(b.rope, null, 'removing a rope releases its hold on the burden'); assert.equal(HR.ropes.length, 0);
reset(); HR.registerRope({ id: 'x', mapId: MAP, scene, x: 0, y: 3, z: 0, length: 1 }); HR.registerRope({ id: 'y', mapId: 'other', scene, x: 0, y: 3, z: 0, length: 1 });
assert.equal(HR.clearScope(MAP), 1); assert.equal(HR.ropes.length, 1); HR.clearScope('other');
assert.doesNotThrow(() => HR.tick(NaN)); assert.equal(HR.debugSnapshot().ropes.length, 0);
console.log('hanging-ropes: ok');

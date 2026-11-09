#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
globalThis.window = globalThis;
const RF = require('../docs/js/rope-furniture.js');
const near = (a, b, tol = 1e-9, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);

// ---- the shipped piece
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'config', 'furniture-authored', 'ruinRopeMount.json'), 'utf8'));
const block = RF.normalize(data.rope);
assert(block && block.enabled, 'the piece carries an enabled rope block');
near(block.anchor.y - block.length, 0.865, 0.01, "the resting grip is at the generated ropes' reachable height (floor + ~0.86)");
assert(block.maxLength > block.length, 'a rider can let it out a little');
const ys = data.parts.map(p => [p.transform.y - p.transform.sy / 2, p.transform.y + p.transform.sy / 2]);
const lo = Math.min(...ys.map(y => y[0])), hi = Math.max(...ys.map(y => y[1]));
assert(block.anchor.y >= lo && block.anchor.y <= hi + 1e-9, 'the rope hangs from the mount, within the piece');
const index = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'config', 'furniture-authored', 'index.json'), 'utf8')).furniture;
assert(index.some(e => e.key === 'ruinRopeMount'), 'listed in the authored furniture index');

// ---- normalize
assert.equal(RF.normalize(null), null); assert.equal(RF.normalize({ enabled: false }), null);
const d = RF.normalize({});
assert.deepEqual([d.length, d.maxLength, d.yawDeg, d.restAngleDeg], [2.1, 2.65, 0, 0], 'defaults');
assert.equal(RF.normalize({ length: 0.1 }).length, 0.4, 'a rope has a minimum length');
assert.equal(RF.normalize({ length: 3, maxLength: 2 }).maxLength, 3, 'maxLength is at least length');
assert.equal(RF.normalize({ restAngleDeg: 500 }).restAngleDeg, 70, 'the rest angle is clamped');
assert.equal(RF.normalize({ length: 'x', anchor: { y: 'y' } }).length, 2.1, 'junk falls back to defaults');

// ---- spec from a placed piece's transform
const matrix = (theta, t, s = 1) => { const c = Math.cos(theta), n = Math.sin(theta); return { elements: [c * s, 0, -n * s, 0, 0, s, 0, 0, n * s, 0, c * s, 0, t.x, t.y, t.z, 1] }; }; // three.js rotation.y = theta, uniform scale s
const piece = (theta, t, s) => ({ matrixWorld: matrix(theta, t, s), updateWorldMatrix() {} });
let spec = RF.specFor(piece(0, { x: 10, y: 0, z: 20 }), { rope: { anchor: { x: 0, y: 2.965, z: 0 }, length: 2.1 } }, 'r1');
near(spec.anchor.x, 10); near(spec.anchor.y, 2.965); near(spec.anchor.z, 20); near(spec.yaw, 0, 1e-12, 'unrotated: swings along +x'); assert.equal(spec.id, 'r1');
spec = RF.specFor(piece(Math.PI / 2, { x: 10, y: 0, z: 20 }), { rope: { anchor: { x: 1, y: 2, z: 0 } } }, 'r2');
near(spec.anchor.x, 10, 1e-9); near(spec.anchor.z, 19, 1e-9, 'a local +x offset follows the piece rotation (+x -> -z at rotation.y = 90 degrees)'); near(spec.yaw, -Math.PI / 2, 1e-9, 'and so does the swing direction');
spec = RF.specFor(piece(0.7, { x: 0, y: 0, z: 0 }), { rope: { yawDeg: 90 } }, 'r3');
near(spec.yaw, Math.PI / 2 - 0.7, 1e-9, 'yawDeg turns the swing direction relative to the piece');
spec = RF.specFor(piece(0, { x: 0, y: 1, z: 0 }, 2), { rope: { anchor: { x: 0, y: 1, z: 0 }, length: 2, restAngleDeg: 30 } }, 'r4');
near(spec.anchor.y, 1 + 2, 1e-9, 'the anchor follows the piece scale and position'); near(spec.angle, 30 * Math.PI / 180); assert.equal(spec.length, 2, 'the rope length is in world units');
assert.equal(RF.specFor(piece(0, { x: 0, y: 0, z: 0 }), {}, 'x'), null, 'a piece without a rope block has no rope');
assert.equal(RF.specFor({ matrixWorld: {} }, { rope: {} }, 'x'), null); assert.equal(RF.specFor(null, { rope: {} }, 'x'), null);

// ---- routing: ruin runtime when inside the ruin, an owned rope elsewhere
const log = [];
const fakeRope = id => ({ id, anchor: { x: 0, y: 0, z: 0 }, length: 1 });
globalThis.HangingRopes = {
  adoptRope: (rope, o) => { log.push(['adopt', rope.id, o.id, o.mapId]); return rope; },
  registerRope: o => { log.push(['owned', o.id, o.mapId, o.mount ? 'mount' : 'nomount', o.length]); return fakeRope(o.id); },
  removeRope: rope => { log.push(['removeHR', rope.id]); return true; },
};
globalThis.DevRandomRuinSimplePuzzles = {
  addFurnitureRope: (spec, mount) => { log.push(['addRuin', spec.id, !!mount]); return fakeRope('rope-furniture_' + spec.id); },
  removeFurnitureRope: rope => { log.push(['removeRuin', rope.id]); return true; },
};
const obj = piece(0, { x: 1, y: 0, z: 1 }), withRope = { rope: { length: 2.4 } };
let rope = RF.register(RF.RUIN_MAP, 'm1', obj, withRope);
assert.deepEqual(log.shift(), ['addRuin', 'm1', true], 'inside the ruin the ruin runtime builds the rope, with the piece as its mount');
assert.deepEqual(log.shift(), ['adopt', 'rope-furniture_m1', 'furniture_m1', RF.RUIN_MAP], 'and HangingRopes adopts it so a burden can hang from it');
rope = RF.register('town', 't1', obj, withRope);
assert.deepEqual(log.shift(), ['owned', 'furniture_t1', 'town', 'mount', 2.4], 'elsewhere it is an owned rope');
globalThis.DevRandomRuinSimplePuzzles.addFurnitureRope = () => null; // runtime not ready
rope = RF.register(RF.RUIN_MAP, 'm2', obj, withRope); assert(rope && log.shift()[0] === 'owned', 'if the ruin runtime is not ready it falls back to an owned rope instead of losing the rope');
log.length = 0;
assert.equal(RF.register('town', 'none', obj, {}), null, 'no rope block, no rope'); assert.equal(log.length, 0);

// ---- lifecycle
RF.clearArea('town'); RF.clearArea(RF.RUIN_MAP); log.length = 0; // leftovers from the routing checks
RF.register('town', 'u1', obj, withRope); log.length = 0;
assert.equal(RF.unregister('town', 'u1'), true); assert.deepEqual(log.shift(), ['removeHR', 'furniture_u1'], 'unregistering removes the rope (letting go of any burden)');
assert.equal(RF.unregister('town', 'u1'), false, 'and only once');
globalThis.DevRandomRuinSimplePuzzles.addFurnitureRope = (spec, mount) => fakeRope('rope-furniture_' + spec.id);
RF.register(RF.RUIN_MAP, 'u2', obj, withRope); log.length = 0; RF.unregister(RF.RUIN_MAP, 'u2');
assert.deepEqual(log.map(l => l[0]), ['removeHR', 'removeRuin'], 'a ruin rope is released from burdens first, then removed from the runtime');
RF.register('town', 'a', obj, withRope); RF.register('town', 'b', obj, withRope); RF.register('elsewhere', 'c', obj, withRope);
assert.equal(RF.clearArea('town'), 2); assert.equal(RF.debugSnapshot().ropes.length, 1); RF.clearArea('elsewhere');
RF.register('town', 'dup', obj, withRope); log.length = 0; RF.register('town', 'dup', obj, withRope);
assert.deepEqual(log.map(l => l[0]), ['removeHR', 'owned'], 're-registering replaces the earlier rope instead of stacking');
console.log('rope-furniture: ok');

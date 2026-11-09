#!/usr/bin/env node
'use strict';

// Unified climb/fall rules: forgiving landings, hold-to-commit ledge step-off,
// grip that warns before it slips, and a real slip -> fall -> landing cost
// through ClimbSystem's route crawl.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {}, Date, performance: { now: () => 0 }, queueMicrotask };
context.window.window = context.window;
for (const f of ['fall-system', 'climb-system']) vm.runInNewContext(fs.readFileSync(`docs/js/${f}.js`, 'utf8'), context);
const { FallSystem, ClimbSystem } = context.window;
const TILE = 64;
let proneCalls = 0, spent = [];
context.window.ResourceSystem = { spendFooting(e, amt, why) { spent.push([amt, why]); e.footing = Math.max(0, e.footing - amt); return amt; } };
const toasts = [];
const player = { x: 0, y: 0, angle: 0, climbing: false, vx: 0, vy: 0, health: 100, footing: 100 };
FallSystem.init({ PLATEAU_UNIT: 2.5, enterProneIfDepleted: e => { proneCalls++; e.prone = true; return true; } });

// --- Landing costs are forgiving ----------------------------------------------
assert.equal(FallSystem.landingCost(0.5).footing, 0, 'a small hop costs nothing');
assert.equal(FallSystem.landingCost(FallSystem.CONFIG.safeTiers).severity, 'soft');
const uncontrolled = FallSystem.landingCost(3).footing;
const deliberate = FallSystem.landingCost(3, { deliberate: true }).footing;
const rolled = FallSystem.landingCost(3, { deliberate: true, rolled: true }).footing;
assert.ok(uncontrolled > deliberate && deliberate > rolled && rolled > 0, 'deliberate and rolled landings are progressively cheaper');
assert.ok(FallSystem.landingCost(99).footing <= FallSystem.CONFIG.footingCap, 'cost is capped at a full bar');

// --- Ledge lip: brushing the edge never drops you; holding does ----------------
let e = {};
for (let i = 0; i < 10; i++) assert.notEqual(FallSystem.edgeIntent(e, 0.016, true).state, 'commit', 'a brief push (0.16s) does not step off');
for (let i = 0; i < 20; i++) FallSystem.edgeIntent(e, 0.016, false);
assert.ok(e._edgeCommitS < 0.01, 'releasing the stick drains the commit timer');
let committed = false;
for (let i = 0; i < 40 && !committed; i++) committed = FallSystem.edgeIntent(e, 0.016, true).state === 'commit';
assert.ok(committed, 'a deliberate ~0.35s hold steps off');

// --- Grip warns well before it slips, recovers when resting --------------------
const g = { health: 100 };
FallSystem.resetGrip(g);
let warnedAt = null, slippedAt = null;
for (let t = 0; t < 120 && slippedAt === null; t += 0.1) {
  const s = FallSystem.tickGrip(g, 0.1, true);
  if (s === 'warn' && warnedAt === null) warnedAt = t;
  if (s === 'slip') slippedAt = t;
}
assert.ok(warnedAt !== null && slippedAt !== null && slippedAt - warnedAt >= 10, 'at least ~10s of warning before a slip');
assert.ok(slippedAt >= 40, 'a full grip lasts well longer than any route needs');
const h = { health: 100 }; FallSystem.resetGrip(h);
for (let i = 0; i < 100; i++) FallSystem.tickGrip(h, 0.1, true);
const tired = FallSystem.gripFraction(h);
for (let i = 0; i < 100; i++) FallSystem.tickGrip(h, 0.1, false);
assert.ok(FallSystem.gripFraction(h) > tired, 'resting restores grip');
const hit = { health: 100 }; FallSystem.resetGrip(hit); FallSystem.tickGrip(hit, 0.016, true);
const before = FallSystem.gripFraction(hit); hit.health = 90; FallSystem.tickGrip(hit, 0.016, true);
assert.ok(before - FallSystem.gripFraction(hit) >= FallSystem.CONFIG.gripHitLoss - 0.01, 'being hit costs grip');
assert.notEqual(FallSystem.tickGrip(hit, 0.016, true), 'slip', 'being hit alone does not drop you');

// --- Route slip -> fall -> landing through ClimbSystem -------------------------
const route = { id: 'r', normal: { x: 1, z: 0 }, upperNode: 2,
  nodes: [{ x: 1, z: 1, y: 0 }, { x: 1, z: 1, y: 3 }, { x: 1, z: 1, y: 6 }] };
ClimbSystem.init({
  _isZoneArea: () => true, getCurrentArea: () => 'zone', player, TILE, PLATEAU_UNIT: 2.5,
  getMountRideState: () => 'none', showToast: m => toasts.push(m),
  setFacingAngle() {}, setTargetAimAngle() {}, setLastMoveAngle() {},
  getMovementInput: () => ({ x: 0, y: 0 }), clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
});
player.climbing = true; player.climbSurfaceY = 3; player.x = TILE; player.y = TILE;
player._cliffRouteSession = { area: 'zone', route, nodeIndex: 1, moving: false, toIndex: -1, progress: 0, phase: 0, distance: 0 };
FallSystem.resetGrip(player);
player._grip = 0.0001; // Nearly spent while hanging on a mid-route hold.
spent = []; proneCalls = 0;
ClimbSystem.updateClimb(0.1);
assert.equal(player._cliffRouteSession, null, 'slip detaches from the route');
assert.ok(player.climbing && player._climbFall && !player._climbFall.deliberate, 'slip starts an uncontrolled fall');
assert.ok(toasts.some(t => /grip/i.test(t)), 'the player is told what happened');
for (let t = 0; t < 3 && player.climbing; t += 1 / 60) ClimbSystem.updateClimb(1 / 60);
assert.ok(!player.climbing, 'the fall finishes');
assert.equal(player.x, TILE); assert.equal(player.climbSurfaceY, 0, 'lands on the route base');
assert.equal(spent.length, 1, 'landing applies exactly one Footing cost');
assert.ok(spent[0][0] > 0 && spent[0][0] < 40, 'a 3-unit (1.2 tier) slip is a stumble, not a knockdown: ' + JSON.stringify(spent));
assert.equal(proneCalls, 0, 'and does not drop the player prone');
console.log('fall-system ok');

// --- Cliff dodge, jump/climb, auto-grab, auto top-out -----------------------------
const CRN = { ...require('../docs/js/cliff-route-network.js') }; // Real nextHop; graph lookups are stubbed below.
context.window.CliffRouteNetwork = CRN;
const faceRoute = { id: 'f', normal: { x: 1, z: 0 }, tangent: { x: 0, z: 1 }, upperNode: 4,
  nodes: [
    { id: 0, x: 5, z: 5, y: 0, links: [1] },
    { id: 1, x: 5, z: 5, y: 1, links: [0, 2, 5] },
    { id: 2, x: 5, z: 5, y: 2, links: [1, 3] },
    { id: 3, x: 5, z: 5, y: 3, transfer: true, links: [2, 4] },
    { id: 4, x: 4.5, z: 5, y: 3.1, links: [3] },
    { id: 5, x: 5, z: 5.6, y: 1.02, links: [1] },
  ] };
const network = { routes: [faceRoute], balconies: [], area: 'zone' };
CRN.forGrid = () => network;
CRN.shelfAt = () => null;
let cliffDodges = 0, dodgeAllowed = true, moveIn = { x: 0, y: 0 };
const p2 = { x: 5 * TILE, y: 5 * TILE, angle: 0, climbing: false, vx: 0, vy: 0, health: 100, footing: 100 };
ClimbSystem.init({
  _isZoneArea: () => true, getCurrentArea: () => 'zone', player: p2, TILE, PLATEAU_UNIT: 2.5,
  getActiveGrid: () => [[{}]], getActiveCols: () => 1, getActiveRows: () => 1, isSolid: () => false,
  getMountRideState: () => 'none', showToast() {}, facingCardinal: () => ({ x: 1, y: 0 }),
  setFacingAngle() {}, setTargetAimAngle() {}, setLastMoveAngle() {},
  getMovementInput: () => moveIn, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  beginCliffDodgeEffects: () => { if (!dodgeAllowed) return false; cliffDodges++; return true; },
});
function hang(nodeIndex) {
  p2.climbing = true; p2._climbFall = null; p2.onCliffBalcony = null; p2.climbSurfaceY = faceRoute.nodes[nodeIndex].y;
  p2.x = faceRoute.nodes[nodeIndex].x * TILE; p2.y = faceRoute.nodes[nodeIndex].z * TILE;
  p2._cliffRouteSession = { area: 'zone', route: faceRoute, nodeIndex, moving: false, toIndex: -1, progress: 0, phase: 0, distance: 0 };
  FallSystem.resetGrip(p2);
}
// Dodge on a handhold lets go, even when an ordinary combat dodge would be gated.
dodgeAllowed = false; hang(1); moveIn = { x: 0, y: 1 };
assert.equal(ClimbSystem.cliffDodge(), true, 'dodge on a cliff releases the grip');
assert.equal(cliffDodges, 0, 'releasing a grip costs no dodge stamina or i-frames');
assert.equal(p2._cliffRouteSession, null, 'no lateral sidestep is scheduled');
assert.ok(p2.climbing && p2._climbFall?.deliberate, 'a deliberate fall begins toward the safe base');
assert.equal(p2._climbFall.source, 'climb released');
hang(1);
p2._cliffRouteSession.moving = true; // A second press during a handhold transition must also detach promptly.
assert.equal(ClimbSystem.cliffDodge(), true, 'dodge also releases a moving handhold climb');
assert.equal(p2._cliffRouteSession, null);
assert.equal(cliffDodges, 0, 'neither release uses the defensive dodge effect');
dodgeAllowed = true;
p2.climbing = false; p2._cliffRouteSession = null;
assert.equal(ClimbSystem.cliffDodge(), false, 'off the cliff, dodge is a normal dodge');

// Jump/Climb hops up one hold toward the wall.
hang(1); moveIn = { x: 0, y: 0 };
assert.equal(ClimbSystem.jumpAction(), true);
assert.equal(p2._cliffRouteSession.toIndex, 2, 'jump with no input climbs to the next hold up');

// Moving toward the wall climbs; the rim hold tops out with no extra input.
hang(2); moveIn = { x: -1, y: 0 };
for (let i = 0; i < 400 && p2._cliffRouteSession; i++) ClimbSystem.updateClimb(1 / 60);
assert.equal(p2._cliffRouteSession, null, 'the climb ends on its own');
assert.ok(!p2.climbing && Math.abs(p2.climbSurfaceY - 3.1) < 1e-6 && p2.x === 4.5 * TILE, 'automatically topping out onto the walkable surface: ' + JSON.stringify([p2.climbing, p2.climbSurfaceY, p2.x]));

// Falling past a hold catches it automatically; a slip does not.
p2.climbing = false; p2._cliffRouteSession = null; p2.x = 5.2 * TILE; p2.y = 5 * TILE;
moveIn = { x: 0, y: 0 };
ClimbSystem.startScriptedWorldClimb({ endX: 5.2 * TILE, endY: 5 * TILE, startWorldY: 2.05, endWorldY: 0, hopCount: 2, shortHops: true });
p2.climbHopCount = 1; p2._climbFall = { dropWorld: 2.05, deliberate: false, source: 'test' };
for (let i = 0; i < 60 && !p2._cliffRouteSession; i++) ClimbSystem.updateClimb(1 / 60);
assert.ok(p2._cliffRouteSession && p2.climbing, 'falling past a handhold grabs it');
assert.ok(FallSystem.gripFraction(p2) >= 0.35, 'a catch still leaves a usable grip');
hang(2); p2._grip = 0.0001;
ClimbSystem.updateClimb(0.1);
for (let i = 0; i < 120 && p2.climbing; i++) ClimbSystem.updateClimb(1 / 60);
assert.equal(p2._cliffRouteSession, null, 'a slip is not instantly re-grabbed');
console.log('fall-system climb integration ok');

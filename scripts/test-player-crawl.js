#!/usr/bin/env node
'use strict';

// Downed crawl: reach-axis locomotion, cone/pivot (u-turn) gating, composer
// channels (player roll + weapon translation only), left-hand pose provider and
// leg poses. Executes the real module in a VM against small stubs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const channels = new Map();
const legCalls = [];
let baseYaw = 0.3;
const playerMesh = { name: 'player_root' };
const context = {
  console,
  performance: { now: () => 0 },
  ImpactBlendLibrary: { getClip: () => ({ frames: [{ ragdoll: { ik: { left: { upperLength: 0.2 } } } }] }) },
  PlayerBodyTransformComposer: {
    setChannel: (name, contribution) => channels.set(name, contribution),
    clearChannel: name => channels.delete(name),
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/player-crawl.js', 'utf8'), context, { filename: 'docs/js/player-crawl.js' });
const crawl = context.PlayerCrawl;
const TILE = 55;
crawl.init({ TILE, getBaseYaw: () => baseYaw, getPlayerMesh: () => playerMesh });
const DEG = Math.PI / 180;
const cfg = crawl.CONFIG;

// Standing: nothing is owned.
assert.equal(crawl.isActive(), false);
assert.equal(context.HobunjiFreeHandPose.providers.get('crawl')(playerMesh, 'left', 0.9), null, 'left hand is not claimed while standing');
assert.equal(crawl.step(0.016, 1, 0, 1).vx, 0, 'no crawl velocity while standing');

// Entering the crawl keeps the body where it was facing: heading = -rotation.y.
crawl.setActive(true);
assert.equal(crawl.isCrawling(), true);
assert(Math.abs(crawl.heading() - (-baseYaw)) < 1e-9, 'heading starts on the reach axis implied by the current body yaw');

// Blend in over blendInS and publish channels.
for (let i = 0; i < 40; i++) crawl.update(0.01);
const body = channels.get('crawl'), weapon = channels.get('crawl-weapon');
assert(body && weapon, 'body and weapon channels are published');
assert.equal(body.includeExternal, false, 'the weapon is not rolled with the body');
assert.equal(weapon.includePlayer, false, 'the weapon channel never moves the player body');
assert.equal(weapon.space, 'world');
assert(!weapon.rotation && !weapon.quaternion, 'the weapon only receives a translation, so its aim stays on the camera ray');
assert(body.rotation.roll < 0 && Math.abs(Math.abs(body.rotation.roll) - cfg.rollDeg * DEG) < 1e-6, 'full blend rolls the body about its forward axis onto the left side');
assert(body.translation.y < 0, 'the body is lowered to the ground');
assert(Math.abs(body.absoluteYaw - (-crawl.heading())) < 1e-6, 'body yaw puts the reach axis along the heading');

// The left arm is owned by the crawl pose; the right arm is not.
const provider = context.HobunjiFreeHandPose.providers.get('crawl');
const arm = provider(playerMesh, 'left', 0.9);
assert(arm && arm.overridden === true && arm.position.y > 0, 'left hand reaches above its idle hang');
assert.equal(provider(playerMesh, 'right', 0.9), null, 'the weapon hand stays with the weapon');
assert.equal(provider({ name: 'npc' }, 'left', 0.9), null, 'NPC rigs are never claimed');

// Driving along the reach axis advances exactly one stride per cycle.
crawl.setActive(false); crawl.update(1); crawl.setActive(true); for (let i = 0; i < 40; i++) crawl.update(0.01);
const heading = crawl.heading();
const dirX = Math.cos(heading), dirY = Math.sin(heading);
let travelled = 0, t = 0;
while (t < cfg.cycleSeconds * 6) {
  const v = crawl.step(0.01, dirX, dirY, 1);
  travelled += (v.vx * dirX + v.vy * dirY) * 0.01;
  t += 0.01;
  crawl.update(0.01);
}
assert(travelled > 0, 'input along the reach axis moves the body');
const dbg = crawl.debugSnapshot();
assert.equal(dbg.driving, true);
const strides = travelled / (cfg.strideTiles * TILE);
assert(strides > 2.5 && strides < 6.5, `several strides in ${t.toFixed(1)}s (got ${strides.toFixed(2)})`);
// Movement is always along the heading, never straight along an off-axis input.
const hb = crawl.heading();
const v2 = crawl.step(0.01, Math.cos(hb + 30 * DEG), Math.sin(hb + 30 * DEG), 1);
if (Math.hypot(v2.vx, v2.vy) > 0) assert(Math.abs(Math.atan2(v2.vy, v2.vx) - crawl.heading()) < 1e-9, 'velocity follows the reach axis');

// Crawling "forward" (90° off the reach axis) is outside the cone: no movement, the body pivots first.
const before = crawl.heading();
const forward = before + 90 * DEG;
let moved = 0, pivotSeconds = 0;
for (let i = 0; i < 400; i++) {
  const v = crawl.step(0.01, Math.cos(forward), Math.sin(forward), 1);
  const s = crawl.debugSnapshot();
  if (Math.abs(Math.atan2(Math.sin(forward - crawl.heading()), Math.cos(forward - crawl.heading()))) > cfg.coneDeg * DEG + 1e-6) {
    assert.equal(Math.hypot(v.vx, v.vy), 0, 'outside the cone the body never translates');
    assert.equal(s.pivoting, true);
    pivotSeconds += 0.01;
  } else moved += Math.hypot(v.vx, v.vy);
  crawl.update(0.01);
}
assert(pivotSeconds > 0.1, 'a 90° request needs a visible pivot first');
assert(moved > 0, 'once the reach axis is within the cone the body crawls that way');
assert(Math.abs(Math.atan2(Math.sin(forward - crawl.heading()), Math.cos(forward - crawl.heading()))) < cfg.coneDeg * DEG + 1e-6);

// A u-turn (180°) takes longer than a quarter turn, then moves in the requested direction.
const start = crawl.heading();
const back = start + Math.PI;
let uTurnSeconds = 0, uMoved = 0;
for (let i = 0; i < 800; i++) {
  const v = crawl.step(0.01, Math.cos(back), Math.sin(back), 1);
  if (Math.hypot(v.vx, v.vy) === 0 && uMoved === 0) uTurnSeconds += 0.01;
  uMoved += Math.hypot(v.vx, v.vy);
  crawl.update(0.01);
}
assert(uTurnSeconds > pivotSeconds, 'the u-turn takes longer than the quarter turn');
const finalDot = Math.cos(crawl.heading()) * Math.cos(back) + Math.sin(crawl.heading()) * Math.sin(back);
assert(finalDot > 0.95, 'after the u-turn the body heads the requested way');

// Arm envelope borrows the Overhead Punch dance: never more than 2 resting arm lengths above the hang, with a planted grab before the pull.
{
  const rig = { rig: { armLengthForSide: () => 0.26 } };
  crawl.debugHoldPhase(0.02, 1); // Grab: fully reached.
  const grab = { ...provider(playerMesh, 'left', 0.9, rig).position }, grabTilt = provider(playerMesh, 'left', 0.9, rig).rotationDeg.pitch;
  assert(Math.abs(grab.y - 0.26 * cfg.armReach) < 1e-6 && cfg.armReach <= 2.0 + 1e-9, 'full reach is two resting arm lengths, the dance punch envelope');
  assert(grabTilt < 0 && Math.abs(grabTilt - cfg.armTiltDeg) < 1e-6, 'the hand tilts at full reach like the dance fist');
  crawl.debugHoldPhase(cfg.pullEnd - 1e-3, 1); // End of the pull: hand is by the body.
  const pulled = provider(playerMesh, 'left', 0.9, rig).position;
  assert(Math.abs(pulled.y - 0.26 * cfg.armPull) < 5e-3, 'the pull ends with the hand drawn in beside the body');
  crawl.debugHoldPhase(null);
  let grabMoved = 0, grabSteps = 0, pullMoved = 0;
  const h0 = crawl.heading();
  for (let i = 0; i < 400; i++) {
    const v = crawl.step(0.005, Math.cos(h0), Math.sin(h0), 1);
    const ph = crawl.debugSnapshot().phase;
    if (ph < cfg.grabEnd) { grabSteps++; grabMoved += Math.hypot(v.vx, v.vy); }
    else if (ph < cfg.pullEnd) pullMoved += Math.hypot(v.vx, v.vy);
    else assert.equal(Math.hypot(v.vx, v.vy), 0, 'the reach swing never translates the body');
    crawl.update(0.005);
  }
  assert(grabSteps > 0 && grabMoved === 0, 'the body holds still while the hand grabs');
  assert(pullMoved > 0, 'the body slides during the pull');
}

// No input: no velocity, activity settles.
for (let i = 0; i < 100; i++) { crawl.step(0.01, 0, 0, 0); crawl.update(0.01); }
assert.equal(crawl.step(0.01, 0, 0, 0).vx, 0);
assert(crawl.debugSnapshot().activity < 0.05, 'a resting crawler stops animating');

// Legs: both sides get a recorded-style pose at the shared leg length; pants are refreshed.
const legs = { applyRecordedLegPose: (side, record) => legCalls.push({ side, thigh: { ...record.thighQuaternion }, calf: { ...record.calfLocalQuaternion }, upper: record.upperLength }), pants: { update() { legs.pantsUpdates = (legs.pantsUpdates || 0) + 1; } } };
assert.equal(crawl.applyLegs(legs), true);
assert.deepEqual(legCalls.map(call => call.side), ['left', 'right']);
assert(legCalls.every(call => call.upper === 0.2), 'legs use the recorded leg length');
assert(legCalls.every(call => call.thigh.x < 0), 'thighs swing toward the belly side (knees forward)');
assert.equal(legs.pantsUpdates, 1);

// Getting up: the pose blends out, then every channel is released.
crawl.setActive(false);
assert.equal(crawl.isCrawling(), false);
assert.equal(crawl.isActive(), true, 'the pose lingers while blending out');
for (let i = 0; i < 60; i++) crawl.update(0.01);
assert.equal(crawl.isActive(), false);
assert(!channels.has('crawl') && !channels.has('crawl-weapon'), 'composer channels are released');
assert.equal(provider(playerMesh, 'left', 0.9), null, 'the left hand is returned to the normal system');

console.log('player crawl: all assertions passed');

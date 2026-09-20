#!/usr/bin/env node
'use strict';

// Regression for the RAF-ownership conversion of
// hand-shoulder-pose-runtime.js's captureLoop: a forever
// requestAnimationFrame loop that exists purely to poll for
// global.Combat.deps to become available (so it can install a melee-visual
// capture wrapper once) becomes a real 250ms setInterval instead - once
// installed it's a cheap no-op check that never needed per-frame cadence.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/hand-shoulder-pose-runtime.js', 'utf8');
assert(!/requestAnimationFrame\?\.\(captureLoop\)/.test(source), 'captureLoop must no longer self-schedule a raw requestAnimationFrame');
assert(source.includes('global.setInterval?.(captureLoop, 250)'), 'captureLoop must be driven by a real setInterval instead');

function buildFixture() {
  const intervals = [];
  const windowObject = {
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    Combat: null,
  };
  const sandbox = { window: windowObject, performance: { now: () => 1000 }, Math, Number, Object };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'hand-shoulder-pose-runtime.js' });
  return { windowObject, intervals };
}

// --- Semantic local hinges preserve legacy pose data without a third hinge ---
{
  const { windowObject } = buildFixture();
  const runtime = windowObject.HobunjiHandShoulderPoseRuntime;
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.idle)), { grip: 1, palmNormal: 1 }, 'idle shoulder-follow exposes the two hand-local hinges');
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.active)), { grip: 0, palmNormal: 1 }, 'active shoulder-follow keeps only the palm-normal hinge by default');
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.normalize({ pitch: false, yaw: true, roll: true }, runtime.idle))),
    { grip: 0, palmNormal: 1 },
    'legacy Pitch/Roll migrate to grip/palm-normal and legacy Yaw does not create a third hinge',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.normalize({ grip: true, palmNormal: false }, runtime.active))),
    { grip: 1, palmNormal: 0 },
    'semantic hinge data loads directly without legacy translation',
  );
}

// --- Direct per-side elbows interpolate with the same pose timeline ----------
{
  const { windowObject } = buildFixture();
  const runtime = windowObject.HobunjiHandShoulderPoseRuntime;
  const pose = {
    neutral: { elbows: { right: { x: 0, y: 0, z: 0 } } },
    windup: { elbows: { right: { x: 0.2, y: 0.1, z: -0.3 } } },
    strike: { elbows: { right: { x: -0.4, y: 0.2, z: 0.5 } } },
  };
  const atWindup = runtime.elbowAt(0.16, { windupFrac: 0.16, strikeFrac: 0.55, holdFrac: 0.68 }, pose, 'attack', 'right');
  assert(Math.abs(atWindup.x - 0.2) < 1e-9 && Math.abs(atWindup.y - 0.1) < 1e-9 && Math.abs(atWindup.z + 0.3) < 1e-9,
    'direct right-elbow pose reaches the authored windup point on the shared phase boundary');
  assert.strictEqual(runtime.elbowAt(0.16, { windupFrac: 0.16 }, pose, 'attack', 'left'), null,
    'one hand may omit an elbow without inventing coordinates for the other hand');
}

// --- Attack mirror signs preserve hand identity and mirror only elbow X -------
{
  const { windowObject } = buildFixture();
  const runtime = windowObject.HobunjiHandShoulderPoseRuntime;
  const pose = {
    neutral: { elbows: {
      left: { x: -0.1, y: 0.3, z: 0.05 },
      right: { x: 0.25, y: 0.4, z: -0.08 },
    } },
    windup: { elbows: {
      left: { x: -0.2, y: 0.35, z: 0.1 },
      right: { x: 0.45, y: 0.2, z: -0.15 },
    } },
    strike: { elbows: {
      left: { x: -0.3, y: 0.15, z: 0.2 },
      right: { x: 0.55, y: 0.1, z: -0.25 },
    } },
  };
  const timing = {
    windupFrac: 0.2,
    strikeFrac: 0.6,
    holdFrac: 0.7,
    activeMirrorSign: -1,
    neutralMirrorSign: -1,
    returnNeutralMirrorSign: 1,
  };
  const startRight = runtime.elbowAt(0, timing, pose, 'attack', 'right');
  assert.deepEqual(JSON.parse(JSON.stringify(startRight)), { x: -0.25, y: 0.4, z: -0.08 },
    'Backhand start Neutral must mirror the RIGHT elbow X without swapping it to the left hand');
  const windupRight = runtime.elbowAt(0.2, timing, pose, 'attack', 'right');
  assert.deepEqual(JSON.parse(JSON.stringify(windupRight)), { x: -0.45, y: 0.2, z: -0.15 },
    'Backhand active Windup must mirror the same RIGHT elbow');
  const windupLeft = runtime.elbowAt(0.2, timing, pose, 'attack', 'left');
  assert.deepEqual(JSON.parse(JSON.stringify(windupLeft)), { x: 0.2, y: 0.35, z: 0.1 },
    'Backhand must independently mirror the LEFT elbow rather than swapping hand identities');
  const endRight = runtime.elbowAt(1, timing, pose, 'attack', 'right');
  assert(Math.abs(endRight.x - 0.25) < 1e-12 && Math.abs(endRight.y - 0.4) < 1e-12 && Math.abs(endRight.z + 0.08) < 1e-12,
    'alternating Heavy return Neutral must use its distinct unmirrored return sign');
}

// --- Missing elbow phases blend through the legacy shoulder target ----------
{
  const { windowObject } = buildFixture();
  const runtime = windowObject.HobunjiHandShoulderPoseRuntime;
  const pose = {
    neutral: {},
    windup: { elbows: { right: { x: 0.4, y: 0.2, z: -0.1 } } },
    strike: {},
  };
  const atStart = runtime.elbowAt(0, { windupFrac: 0.2, strikeFrac: 0.6, holdFrac: 0.7 }, pose, 'attack', 'right');
  assert.deepEqual(JSON.parse(JSON.stringify(atStart)), { x: 0, y: 0, z: 0 },
    'missing Neutral elbow must mean shoulder-relative zero instead of snapping immediately to Windup');
  const halfway = runtime.elbowAt(0.1, { windupFrac: 0.2, strikeFrac: 0.6, holdFrac: 0.7 }, pose, 'attack', 'right');
  assert.deepEqual(JSON.parse(JSON.stringify(halfway)), { x: 0.2, y: 0.1, z: -0.05 },
    'partially-authored elbows must interpolate continuously from the legacy shoulder target');
  const allMissing = runtime.elbowAt(0.1, { windupFrac: 0.2 }, { neutral: {}, windup: {}, strike: {} }, 'attack', 'right');
  assert.strictEqual(allMissing, null, 'an animation with no elbow keyframes at all must retain legacy shoulder targeting');
}

// --- Loading the module starts exactly one 250ms setInterval poll ----------
{
  const { intervals } = buildFixture();
  assert.equal(intervals.length, 1, 'module load starts exactly one setInterval poll');
  assert.equal(intervals[0].ms, 250, 'the poll runs on the documented 250ms cadence');
}

// --- Before Combat.deps exists, the poll callback tolerates it silently ----
{
  const { intervals } = buildFixture();
  assert.doesNotThrow(() => intervals[0].fn(), 'the poll callback must tolerate a missing Combat.deps without throwing');
}

// --- Once Combat.deps carries the visual hooks marker, the wrapper installs
{
  const { intervals, windowObject } = buildFixture();
  const original = { triggerWeaponSwingVisual(durationS, opts) { return 'swing-called'; } };
  windowObject.Combat = { deps: { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual: original.triggerWeaponSwingVisual } };
  intervals[0].fn();
  assert.equal(windowObject.Combat.deps.__hobunjiShoulderPoseCapture, true, 'the poll installs the capture wrapper once the visual hooks marker is present');
  assert.notEqual(windowObject.Combat.deps.triggerWeaponSwingVisual, original.triggerWeaponSwingVisual, 'triggerWeaponSwingVisual is wrapped in place');
}

// --- Repeated ticks after install remain a cheap no-op, never re-wrapping --
{
  const { intervals, windowObject } = buildFixture();
  windowObject.Combat = { deps: { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual() {} } };
  intervals[0].fn();
  const wrapped = windowObject.Combat.deps.triggerWeaponSwingVisual;
  intervals[0].fn();
  assert.equal(windowObject.Combat.deps.triggerWeaponSwingVisual, wrapped, 'a second tick after install must not re-wrap the already-captured deps');
}

console.log('hand shoulder pose runtime capture-loop timer conversion passed');

'use strict';

const fs = require('fs'); // Reads the exact browser runtime module under test.
const path = require('path'); // Resolves the runtime module from this repository script.
const assert = require('assert'); // Verifies regular/backhand Heavy neutral endpoint selection.
const vm = require('vm'); // Executes the browser IIFE with a minimal gameplay dependency mock.

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'weapon-tool-stances.js'); // Runtime stance bridge whose prepared pose is exercised below.
const spacingPath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'melee-pose-spacing.js'); // Shared user-authored melee lift/range calibration.
const source = fs.readFileSync(modulePath, 'utf8'); // Full committed module source evaluated without rewriting its logic for the test.
const spacingSource = fs.readFileSync(spacingPath, 'utf8');
const heavyPose = { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: -15, roll: -82 }; // Built-in Heavy idle expected at each endpoint.
const lightPose = { x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: -40, roll: -65 }; // Built-in Light idle used to prove existing behavior stays unchanged.

global.window = { __farmLog() {} }; // Browser namespace consumed by the runtime module.
global.localStorage = { getItem() { return null; } }; // No editor override: exercise committed defaults.
global.fetch = async () => { throw new Error('offline test'); }; // Prevents a real config request while preserving the fallback path.
global.performance = { now: () => 1000 }; // Deterministic clock for runtime setup.
vm.runInThisContext(spacingSource, { filename: spacingPath });
vm.runInThisContext(source, { filename: modulePath });

const toolDefs = {
  heavy: { shapeKey: 'hatchet', animStyle: 'sweep', weaponIdleClass: 'heavy' },
  light: { shapeKey: 'fishingspear', animStyle: 'sweep', weaponIdleClass: 'light' },
};
let equipped = 'heavy'; // Active weapon changed below to cover Heavy and unchanged Light behavior.
window.WeaponToolStances.init({
  TOOL_ITEM_DEFS: toolDefs,
  getActiveTool: () => 'weapon',
  equipmentSlots: { get weapon() { return equipped; } },
  toolMeshMap: {},
});

function mirrored(pose) {
  return { ...pose, x: -pose.x, yaw: -pose.yaw, bodyYaw: -pose.bodyYaw, roll: -pose.roll };
}

// The game applies dirSign to mirrored channels after preparation; reproduce
// that final step here so assertions describe the visible endpoint poses.
function visible(pose, dirSign) {
  return dirSign === -1 ? mirrored(pose) : { ...pose };
}

const authoredSweep = {
  neutral: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 0, roll: 0 },
  windup: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: -42, bodyYaw: -90, roll: 0 },
  strike: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 20, bodyYaw: 120, roll: 0 },
};

const spacing = window.MeleePoseSpacing;
assert(spacing, 'shared melee pose spacing must load before weapon stances');
assert(Math.abs(spacing.calibration.yLift - 0.17) < 1e-12, 'uploaded Forehand must contribute exactly +0.17 authored Y before range extension');
assert(Math.abs(spacing.calibration.rangeDelta.windup - 0.44949084636340847) < 1e-12, 'Forehand windup horizontal character-local range delta must match uploaded-vs-original measurement');
assert(Math.abs(spacing.calibration.rangeDelta.strike - 0.44949084636340847) < 1e-12, 'Forehand strike horizontal character-local range delta must match uploaded-vs-original measurement');

function angleDeltaDeg(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}
function assertEndpointSpacing(original, adjusted, phase, label) {
  const originalMetrics = spacing.metrics(original);
  const adjustedMetrics = spacing.metrics(adjusted);
  const expectedDelta = spacing.calibration.rangeDelta[phase];
  assert(Math.abs((adjustedMetrics.rangeXZ - originalMetrics.rangeXZ) - expectedDelta) < 1e-10, `${label} must add the calibrated horizontal range`);
  assert(angleDeltaDeg(adjustedMetrics.directionDeg, originalMetrics.directionDeg) < 1e-10, `${label} must preserve its own original horizontal ray from the player`);
  assert(Math.abs(adjusted.y - ((Number(original.y) || 0) + spacing.calibration.yLift)) < 1e-10, `${label} must add exactly +0.17 authored Y independently of range`);
}

for (const phase of ['windup', 'strike']) {
  const originalForehand = spacing.calibration.forehandBefore[phase];
  const uploadedForehand = spacing.calibration.forehandAfter[phase];
  const correctedForehand = spacing.adjustEndpoint(originalForehand, phase);
  const uploadedMetrics = spacing.metrics(uploadedForehand);
  const correctedMetrics = spacing.metrics(correctedForehand);
  const originalMetrics = spacing.metrics(originalForehand);
  assert(Math.abs(correctedMetrics.rangeXZ - uploadedMetrics.rangeXZ) < 1e-10, `Forehand ${phase} must preserve the uploaded horizontal reach`);
  assert(angleDeltaDeg(correctedMetrics.directionDeg, originalMetrics.directionDeg) < 1e-10, `Forehand ${phase} must restore its original horizontal direction`);
  assert(angleDeltaDeg(correctedMetrics.directionDeg, uploadedMetrics.directionDeg) > 10, `Forehand ${phase} must not retain the uploaded accidental lateral direction`);
  assert(Math.abs(correctedForehand.y - 0.17) < 1e-10, `Forehand ${phase} must retain the uploaded +0.17 vertical lift exactly`);
  assert(Math.abs(correctedForehand.x + 0.48) > 0.05, `Forehand ${phase} must not copy uploaded x=-0.48`);
}

{
  const regular = window.WeaponToolStances.prepareCombatOptions({ anim: 'sweep', dirSign: 1, pose: authoredSweep });
  assert.deepStrictEqual(visible(regular.pose.neutral, regular.dirSign), heavyPose);
  assert.deepStrictEqual(visible(regular.pose.returnNeutral, regular.dirSign), mirrored(heavyPose));
  assert.strictEqual(regular.pose.neutralMirrorSign, 1);
  assert.strictEqual(regular.pose.returnNeutralMirrorSign, -1);
  assertEndpointSpacing(authoredSweep.windup, regular.pose.windup, 'windup', 'regular sweep windup');
  assertEndpointSpacing(authoredSweep.strike, regular.pose.strike, 'strike', 'regular sweep strike');
}

{
  const backhand = window.WeaponToolStances.prepareCombatOptions({ anim: 'sweep', dirSign: -1, pose: authoredSweep });
  assert.deepStrictEqual(visible(backhand.pose.neutral, backhand.dirSign), mirrored(heavyPose));
  assert.deepStrictEqual(visible(backhand.pose.returnNeutral, backhand.dirSign), heavyPose);
  assert.strictEqual(backhand.pose.neutralMirrorSign, -1);
  assert.strictEqual(backhand.pose.returnNeutralMirrorSign, 1);
  const regular = window.WeaponToolStances.prepareCombatOptions({ anim: 'sweep', dirSign: 1, pose: authoredSweep });
  assert.deepStrictEqual(visible(backhand.pose.windup, backhand.dirSign), mirrored(regular.pose.windup), 'Backhand windup must be the true full-frame mirror of spaced Forehand');
  assert.deepStrictEqual(visible(backhand.pose.strike, backhand.dirSign), mirrored(regular.pose.strike), 'Backhand strike must be the true full-frame mirror of spaced Forehand');
}

{
  equipped = 'light';
  const backhand = window.WeaponToolStances.prepareCombatOptions({ anim: 'sweep', dirSign: -1, pose: authoredSweep });
  assert.deepStrictEqual(visible(backhand.pose.neutral, backhand.dirSign), lightPose);
  assert.deepStrictEqual(visible(backhand.pose.returnNeutral, backhand.dirSign), lightPose);
}

{
  const thrust = window.WeaponToolStances.prepareCombatOptions({ anim: 'thrust' });
  assertEndpointSpacing(
    { x: 0, y: 0, z: -0.40, pitch: 10.31, yaw: 0, bodyYaw: -45, roll: 0 },
    thrust.pose.windup,
    'windup',
    'legacy thrust windup',
  );
  assertEndpointSpacing(
    { x: -0.23, y: 0, z: 0.32, pitch: 1, yaw: -45, bodyYaw: 46, roll: 0 },
    thrust.pose.strike,
    'strike',
    'legacy thrust strike',
  );
}

{
  const chop = window.WeaponToolStances.prepareCombatOptions({ anim: 'chop' });
  assertEndpointSpacing(
    { x: -0.18, y: 0.41, z: -0.15, pitch: -165, yaw: 13, bodyYaw: -29, roll: -112 },
    chop.pose.windup,
    'windup',
    'legacy chop windup',
  );
  assertEndpointSpacing(
    { x: 0, y: 0, z: 0.12, pitch: 13, yaw: -28, bodyYaw: 29, roll: -91 },
    chop.pose.strike,
    'strike',
    'legacy chop strike',
  );
}

assert.match(source, /runtimeState\.combatWindupFrac = visual\?\.wf \?\? null/, 'hand consumers must receive WeaponToolStances exact normalized windup fraction');
assert.match(source, /runtimeState\.combatStrikeFrac = visual\?\.sf \?\? null/, 'hand consumers must receive WeaponToolStances exact normalized strike fraction');
assert.match(source, /runtimeState\.combatHoldFrac = visual\?\.hf \?\? null/, 'hand consumers must receive WeaponToolStances exact normalized hold fraction');
assert.match(source, /runtimeState\.combatDirSign = visual\?\.dirSign \?\? 1/, 'hand consumers must receive the live active mirror sign');
assert.match(source, /runtimeState\.combatNeutralMirrorSign = visual\?\.neutralMirrorSign \?\? 1/, 'hand consumers must receive the heavy start-neutral mirror sign');
assert.match(source, /runtimeState\.combatReturnNeutralMirrorSign = visual\?\.returnNeutralMirrorSign \?\? 1/, 'hand consumers must receive the heavy return-neutral mirror sign');

console.log('test-heavy-weapon-alternating-neutrals: ok');

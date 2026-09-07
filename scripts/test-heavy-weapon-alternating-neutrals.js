'use strict';

const fs = require('fs'); // Reads the exact browser runtime module under test.
const path = require('path'); // Resolves the runtime module from this repository script.
const assert = require('assert'); // Verifies regular/backhand Heavy neutral endpoint selection.
const vm = require('vm'); // Executes the browser IIFE with a minimal gameplay dependency mock.

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'weapon-tool-stances.js'); // Runtime stance bridge whose prepared pose is exercised below.
const source = fs.readFileSync(modulePath, 'utf8'); // Full committed module source evaluated without rewriting its logic for the test.
const heavyPose = { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: -15, roll: -82 }; // Built-in Heavy idle expected at each endpoint.
const lightPose = { x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: -40, roll: -65 }; // Built-in Light idle used to prove existing behavior stays unchanged.

global.window = { __farmLog() {} }; // Browser namespace consumed by the runtime module.
global.localStorage = { getItem() { return null; } }; // No editor override: exercise committed defaults.
global.fetch = async () => { throw new Error('offline test'); }; // Prevents a real config request while preserving the fallback path.
global.performance = { now: () => 1000 }; // Deterministic clock for runtime setup.
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

{
  const regular = window.WeaponToolStances.prepareCombatOptions({ anim: 'sweep', dirSign: 1, pose: authoredSweep });
  assert.deepStrictEqual(visible(regular.pose.neutral, regular.dirSign), heavyPose);
  assert.deepStrictEqual(visible(regular.pose.returnNeutral, regular.dirSign), mirrored(heavyPose));
  assert.strictEqual(regular.pose.neutralMirrorSign, 1);
  assert.strictEqual(regular.pose.returnNeutralMirrorSign, -1);
}

{
  const backhand = window.WeaponToolStances.prepareCombatOptions({ anim: 'sweep', dirSign: -1, pose: authoredSweep });
  assert.deepStrictEqual(visible(backhand.pose.neutral, backhand.dirSign), mirrored(heavyPose));
  assert.deepStrictEqual(visible(backhand.pose.returnNeutral, backhand.dirSign), heavyPose);
  assert.strictEqual(backhand.pose.neutralMirrorSign, -1);
  assert.strictEqual(backhand.pose.returnNeutralMirrorSign, 1);
}

{
  equipped = 'light';
  const backhand = window.WeaponToolStances.prepareCombatOptions({ anim: 'sweep', dirSign: -1, pose: authoredSweep });
  assert.deepStrictEqual(visible(backhand.pose.neutral, backhand.dirSign), lightPose);
  assert.deepStrictEqual(visible(backhand.pose.returnNeutral, backhand.dirSign), lightPose);
}

console.log('test-heavy-weapon-alternating-neutrals: ok');

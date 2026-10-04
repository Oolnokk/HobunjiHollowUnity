'use strict';
const assert = require('node:assert/strict'); // Behavioral assertions against the loaded grip module.
const fs = require('node:fs'); // Reads the actual runtime source.
const vm = require('node:vm'); // Supplies a minimal browser environment.
const tasks = new Map(); // Captures scheduler callbacks so combat capture can be installed.
let snapshot = { activeSlot: 'slot1', combatNeutralInjected: false }; // Drives idle, active attack, and ranged contexts.
const deps = { __weaponToolStanceVisualHooks: true, triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {} }; // Real grip module wraps these attack dispatches.
const window = { // Shared browser APIs used by the grip runtime.
  location: { pathname: '/index.html' },
  RuntimeFrameScheduler: { register(name, callback) { tasks.set(name, callback); } },
  WeaponToolStances: { getRuntimeState: () => snapshot },
  Combat: { deps },
};
vm.runInNewContext(fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'), {
  window, location: window.location,
  document: { getElementById() { return null; } },
  performance: { now: () => 0 },
});
const grips = window.HobunjiHandToolGrips; // Public config, pose sampling, and hand-target authority.
tasks.get('hand-tool-grips-install')();
const pose = { // Independent percentages exercise both ranges, including legacy Neutral enabled data.
  neutral: { secondaryGrip: { enabled: true, percent: 10, primaryPercent: 10 } },
  windup: { secondaryGrip: { enabled: true, percent: 25, primaryPercent: 75 } },
  strike: { secondaryGrip: { enabled: true, percent: 80, primaryPercent: 20 } },
};
deps.triggerWeaponSwingVisual(1, { pose, windupFrac: 0.25, strikeFrac: 0.6, holdFrac: 0.8 });
snapshot = { activeSlot: 'slot1', combatNeutralInjected: true, combatProgress: 0.25 };
const baseline = grips.authoredPrimaryGripForTool('pickshovel', 'melee'); // Single-hand grip must stay immutable.
const pickMainStart = -0.2378; // Measured pick-shovel wood-center translation keeps the old 0.12-wide main range.
const pickOffStart = 0.0822; // Matching translated offhand range stays on the opposite side of the new fixed grip.
const sampledMain = pickMainStart + 0.12 * 0.75; // Expected main-hand point at the Windup percentage.
const sampledOff = pickOffStart + 0.12 * 0.25; // Expected offhand point at its separate percentage.
assert(Math.abs(grips.primaryGripForTool('pickshovel', 'melee').position.z - sampledMain) < 1e-9);
assert(Math.abs(grips.secondaryGripForTool('pickshovel', 'melee').itemZ - sampledOff) < 1e-9);
assert.equal(grips.authoredPrimaryGripForTool('pickshovel', 'melee').position.z, baseline.position.z);
assert.equal(grips.primaryGripForTool('pickshovel', 'melee', { animationGripState: null }).position.z, baseline.position.z, 'idle actor does not inherit the player attack');
assert.equal(grips.secondaryGripForTool('pickshovel', 'melee', { animationGripState: null }), null);
const actorState = { animationGripState: { influence: 1, percent: 80, primaryPercent: 20 } }; // Another actor samples its own pose, independently from player progress.
assert(Math.abs(grips.primaryGripForTool('pickshovel', 'melee', actorState).position.z - (pickMainStart + 0.12 * 0.2)) < 1e-9);
snapshot.combatProgress = 0.125;
assert.equal(grips.currentSecondaryGripAnimationState().influence, 0.5);
const halfwayState = grips.currentSecondaryGripAnimationState(); // Main target follows the same influence and percentage interpolation as the offhand.
const halfwaySample = pickMainStart + 0.12 * halfwayState.primaryPercent / 100;
const halfwayZ = baseline.position.z + (halfwaySample - baseline.position.z) * 0.5;
assert(Math.abs(grips.primaryGripForTool('pickshovel', 'melee').position.z - halfwayZ) < 1e-9);
for (const progress of [0, 1]) {
  snapshot.combatProgress = progress;
  assert.equal(grips.secondaryGripForTool('pickshovel', 'melee'), null);
  assert.equal(grips.primaryGripForTool('pickshovel', 'melee').position.z, baseline.position.z);
}
snapshot = { activeSlot: 'slot1', combatNeutralInjected: false };
assert.equal(grips.secondaryGripForTool('pickshovel', 'melee'), null);
snapshot = { activeSlot: 'ranged', combatNeutralInjected: true, combatProgress: 0.25 };
assert.equal(grips.secondaryGripForTool('pickshovel', 'ranged'), null);
assert.equal(grips.primaryGripForTool('pickshovel', 'ranged').position.z, grips.authoredPrimaryGripForTool('pickshovel', 'ranged').position.z);
assert.equal(grips.animationGripAt(0.25, {}, pose, 'fire').influence, 0);
assert.equal(grips.animationGripAt(0.25, {}, pose, 'load').influence, 0);

const measuredLongHaft = { // Rounded from the opaque/color component measurements used to place the fixed 1H grip.
  bshuakauitl: { meleeZ: -0.0006, rangedZ: -0.0006, main: [0.0394, 0.1594], off: [-0.1606, -0.0406] },
  fishingspear: { meleeZ: -0.1522, rangedZ: 0.1522, main: [-0.3522, -0.2322], off: [-0.0722, 0.0478] },
  pickshovel: { meleeZ: -0.0178, rangedZ: -0.0178, main: [-0.2378, -0.1178], off: [0.0822, 0.2022] },
};
for (const [key, expected] of Object.entries(measuredLongHaft)) {
  const entry = grips.data.tools[key]; // Light pairs keep the measured fixed 1H grip as their combined center.
  const main = entry.primaryGripSpan; // Main-hand range remains on one side of the new center.
  const off = entry.secondaryGripSpan; // Offhand range remains on the opposite side.
  assert.equal(entry.primaryGrip.position.z, expected.meleeZ);
  assert.equal(entry.rangedPrimaryGrip.position.z, expected.rangedZ);
  assert.deepEqual([main.startZ, main.endZ], expected.main);
  assert.deepEqual([off.startZ, off.endZ], expected.off);
  assert(Math.abs((main.startZ + main.endZ + off.startZ + off.endZ) / 4 - entry.primaryGrip.position.z) < 1e-9);
  assert.equal(entry.rangedSecondaryGripSpan.enabled, false, `${key} remains strictly 1H in ranged context`);
}
assert.equal(grips.data.tools.fishingspear.rangedPrimaryGrip.position.x, -grips.data.tools.fishingspear.primaryGrip.position.x, 'Tool End Flip mirrors spear ranged X');
assert.equal(grips.data.tools.fishingspear.rangedPrimaryGrip.position.z, -grips.data.tools.fishingspear.primaryGrip.position.z, 'Tool End Flip mirrors the new nonzero spear ranged Z');

for (const key of ['plainssword', 'hoe', 'hatchet']) {
  const entry = grips.data.tools[key]; // These sprites' working ends face positive tool-local Z.
  const mainCenter = (entry.primaryGripSpan.startZ + entry.primaryGripSpan.endZ) / 2; // Rear range must retain the original grip center.
  const offCenter = (entry.secondaryGripSpan.startZ + entry.secondaryGripSpan.endZ) / 2; // Front range is closer to the working end.
  assert(Math.abs(mainCenter - entry.primaryGrip.position.z) < 1e-9);
  assert(mainCenter < offCenter);
}
const oldDraft = grips.clone(); // Simulates a saved pre-paired-range / pre-measured-center configuration.
delete oldDraft.twoHandSpanPreset;
delete oldDraft.longHaftGripPreset;
oldDraft.tools.hoe.primaryGripSpan = { enabled: false, startZ: 0, endZ: 0 };
oldDraft.tools.bshuakauitl.primaryGrip.position.z = 0.14;
oldDraft.tools.bshuakauitl.rangedPrimaryGrip.position.z = 0.14;
oldDraft.tools.bshuakauitl.primaryGripSpan = { enabled: true, startZ: 0.18, endZ: 0.3 };
oldDraft.tools.bshuakauitl.secondaryGripSpan = { enabled: true, startZ: -0.02, endZ: 0.1 };
oldDraft.tools.fishingspear.primaryGrip.position.z = 0;
oldDraft.tools.fishingspear.rangedPrimaryGrip.position.z = 0;
oldDraft.tools.pickshovel.primaryGrip.position.z = 0;
oldDraft.tools.pickshovel.rangedPrimaryGrip.position.z = 0;
grips.replace(oldDraft);
assert.equal(grips.data.tools.hoe.primaryGripSpan.enabled, true);
for (const [key, expected] of Object.entries(measuredLongHaft)) {
  assert.equal(grips.data.tools[key].primaryGrip.position.z, expected.meleeZ, `${key} old draft adopts measured melee center once`);
  assert.equal(grips.data.tools[key].rangedPrimaryGrip.position.z, expected.rangedZ, `${key} old draft adopts measured ranged center once`);
}
grips.mutate(data => { data.tools.hoe.primaryGripSpan.endZ = 0.04; });
assert.equal(grips.data.tools.hoe.primaryGripSpan.endZ, 0.04, 'later 2H authoring edits survive normalization');
grips.mutate(data => { data.tools.bshuakauitl.primaryGrip.position.z = 0.0123; });
assert.equal(grips.data.tools.bshuakauitl.primaryGrip.position.z, 0.0123, 'later 1H grip edits survive the one-time measured-center migration');
grips.restoreEditorSecondaryGripState({ neutral: { enabled: true, percent: 10, primaryPercent: 10 } });
const restored = grips.editorSecondaryGripStateSnapshot(); // Undo/Redo and export adapter share the same independent pose data.
assert.equal(restored.neutral.enabled, false);
assert.equal(restored.windup.primaryPercent, 50, 'missing main-hand percentages default to range center');
grips.restoreEditorSecondaryGripState({ windup: { enabled: true, percent: 25, primaryPercent: 75 } });
assert.equal(grips.editorSecondaryGripStateSnapshot().windup.primaryPercent, 75);
console.log('Measured long-haft 1H centers, mirrored spear ranged grip, paired 2H ranges, idle/ranged fallback, and migration passed.');

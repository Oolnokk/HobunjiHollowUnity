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
const sampledMain = -0.22 + 0.12 * 0.75; // Expected main-hand point at the Windup percentage.
const sampledOff = 0.1 + 0.12 * 0.25; // Expected offhand point at its separate percentage.
assert(Math.abs(grips.primaryGripForTool('pickshovel', 'melee').position.z - sampledMain) < 1e-9);
assert(Math.abs(grips.secondaryGripForTool('pickshovel', 'melee').itemZ - sampledOff) < 1e-9);
assert.equal(grips.authoredPrimaryGripForTool('pickshovel', 'melee').position.z, baseline.position.z);
assert.equal(grips.primaryGripForTool('pickshovel', 'melee', { animationGripState: null }).position.z, baseline.position.z, 'idle actor does not inherit the player attack');
assert.equal(grips.secondaryGripForTool('pickshovel', 'melee', { animationGripState: null }), null);
const actorState = { animationGripState: { influence: 1, percent: 80, primaryPercent: 20 } }; // Another actor samples its own pose, independently from player progress.
assert(Math.abs(grips.primaryGripForTool('pickshovel', 'melee', actorState).position.z - (-0.22 + 0.12 * 0.2)) < 1e-9);
snapshot.combatProgress = 0.125;
assert.equal(grips.currentSecondaryGripAnimationState().influence, 0.5);
const halfwayState = grips.currentSecondaryGripAnimationState(); // Main target follows the same influence and percentage interpolation as the offhand.
const halfwayZ = -0.22 + 0.12 * halfwayState.primaryPercent / 100;
assert(Math.abs(grips.primaryGripForTool('pickshovel', 'melee').position.z - halfwayZ * 0.5) < 1e-9);
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
for (const key of ['bshuakauitl', 'fishingspear', 'pickshovel']) {
  const entry = grips.data.tools[key]; // Light pairs must have their combined center at the original grip.
  const main = entry.primaryGripSpan; // Main-hand endpoints participate in the center rule.
  const off = entry.secondaryGripSpan; // Offhand endpoints complete the symmetrical pair.
  assert(Math.abs((main.startZ + main.endZ + off.startZ + off.endZ) / 4 - entry.primaryGrip.position.z) < 1e-9);
}
for (const key of ['plainssword', 'hoe', 'hatchet']) {
  const entry = grips.data.tools[key]; // These sprites' working ends face positive tool-local Z.
  const mainCenter = (entry.primaryGripSpan.startZ + entry.primaryGripSpan.endZ) / 2; // Rear range must retain the original grip center.
  const offCenter = (entry.secondaryGripSpan.startZ + entry.secondaryGripSpan.endZ) / 2; // Front range is closer to the working end.
  assert(Math.abs(mainCenter - entry.primaryGrip.position.z) < 1e-9);
  assert(mainCenter < offCenter);
}
const oldDraft = grips.clone(); // Simulates a saved pre-paired-range configuration.
delete oldDraft.twoHandSpanPreset;
oldDraft.tools.hoe.primaryGripSpan = { enabled: false, startZ: 0, endZ: 0 };
grips.replace(oldDraft);
assert.equal(grips.data.tools.hoe.primaryGripSpan.enabled, true);
grips.mutate(data => { data.tools.hoe.primaryGripSpan.endZ = 0.04; });
assert.equal(grips.data.tools.hoe.primaryGripSpan.endZ, 0.04, 'later authoring edits survive normalization');
grips.restoreEditorSecondaryGripState({ neutral: { enabled: true, percent: 10, primaryPercent: 10 } });
const restored = grips.editorSecondaryGripStateSnapshot(); // Undo/Redo and export adapter share the same independent pose data.
assert.equal(restored.neutral.enabled, false);
assert.equal(restored.windup.primaryPercent, 50, 'missing main-hand percentages default to range center');
grips.restoreEditorSecondaryGripState({ windup: { enabled: true, percent: 25, primaryPercent: 75 } });
assert.equal(grips.editorSecondaryGripStateSnapshot().windup.primaryPercent, 75);
console.log('Paired 2H ranges, independent interpolation, 1H/ranged/idle fallback, stance anchors, and migration passed.');

'use strict';
// game.js caps its frame dt, so its swing clock lags wall time on slow frames. Everything keyed off
// WeaponToolStances' combat progress (hands, grips, Neutral blend, shoulder aim) has to follow that same
// clock, otherwise it already plays the return while the body and tool still hold the authored Strike.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let wallMs = 1000;
let gameRemainingS = null; // null mimics game.js reporting no live swing timeline.
global.window = { __farmLog() {}, Combat: { deps: {
  triggerWeaponSwingVisual() {}, triggerWeaponHoldVisual() {}, releaseWeaponSwingHold() {}, cancelWeaponSwingHold() {},
  getWeaponAttackTimeline: () => (gameRemainingS == null ? null : { remainingS: gameRemainingS }),
} } };
global.localStorage = { getItem() { return null; } };
global.fetch = async () => { throw new Error('offline test'); };
global.setTimeout = () => 0; // Retry scheduling is tested separately; this test owns only the combat clock.
global.clearTimeout = () => {}; // Matches the isolated retry timer above.
global.performance = { now: () => wallMs };
vm.runInThisContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), { filename: 'shared-attack-pose.js' }); // Shared pose math the stance runtime delegates to.
vm.runInThisContext(fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8'), { filename: 'weapon-tool-stances.js' });

window.WeaponToolStances.init({
  TOOL_ITEM_DEFS: { heavy: { shapeKey: 'hatchet', animStyle: 'sweep', weaponIdleClass: 'heavy' } },
  getActiveTool: () => 'weapon',
  equipmentSlots: { weapon: 'heavy' },
  toolMeshMap: {},
});

const deps = window.Combat.deps;
const progressAfter = (wallElapsedMs, remainingS) => {
  wallMs += wallElapsedMs;
  gameRemainingS = remainingS;
  deps.releaseWeaponSwingHold(); // Advances the stance clock exactly like a render pass does.
  return window.WeaponToolStances.getRuntimeState().combatProgress;
};

// Forehand-like swing: 0.415s windup+strike, 0.43s hold, ~0.145s automatic return tail.
deps.triggerWeaponSwingVisual(0.415, { anim: 'sweep', windupFrac: 0.83, strikeFrac: 1, holdS: 0.43, pose: window.AttackPoseTemplates?.poseFor?.('hatchet_swing') || undefined });
assert.ok(Math.abs(window.WeaponToolStances.getRuntimeState().combatHoldFrac - 0.853) < 0.01, 'normalized hold end');

// One real second passes, but game.js only advanced 0.3s of its capped clock.
const totalS = 0.415 + 0.415 * 0.35 + 0.43; // Matches game.js: windup+strike, proportional return tail, then the explicit hold.
const followed = progressAfter(1000, totalS - 0.3);
assert.ok(Math.abs(followed - 0.3 / totalS) < 1e-6, `stance follows the game clock, got ${followed}`);
assert.ok(followed < window.WeaponToolStances.getRuntimeState().combatWindupFrac, 'the game is still in Windup, so no later phase may be reported');

// Without a live game timeline it keeps advancing from wall time, so a stale visual still clears.
gameRemainingS = null;
wallMs += 5000;
deps.releaseWeaponSwingHold();
assert.equal(window.WeaponToolStances.getRuntimeState().combatProgress, 1, 'wall-clock fallback completes the visual');
console.log('weapon stance: follows the game swing clock');

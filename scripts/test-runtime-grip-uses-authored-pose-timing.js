'use strict';
// In-game Two-Hand / Dual Wield grips must follow the attack's authored pose flags on the same
// normalized windup/strike/hold timeline the editor scrubs. The capture wrapper in hand-tool-grips.js
// sits outside WeaponToolStances', whose visual only becomes active inside the wrapped call; capturing
// before that call let the sync step clear the capture, so every swing fell back to default timings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const gripSource = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const tasks = new Map();
let snapshot = { activeSlot: 'weapon', itemKey: 'hatchet', combatNeutralInjected: false };
const window = {
  location: { pathname: '/index.html' },
  RuntimeFrameScheduler: { register: (id, cb) => tasks.set(id, cb) },
  WeaponToolStances: { getRuntimeState: () => snapshot },
  Combat: { deps: {
    __weaponToolStanceVisualHooks: true,
    // Stands in for WeaponToolStances' wrapper: the visual starts only once the call runs.
    triggerWeaponSwingVisual() { snapshot = { activeSlot: 'weapon', itemKey: 'hatchet', combatNeutralInjected: true, combatProgress: 0, combatWindupFrac: 0.35, combatStrikeFrac: 0.42, combatHoldFrac: 0.85 }; },
    triggerWeaponHoldVisual() {},
  } },
};
const scope = { window, location: window.location, document: { getElementById: () => null }, performance: { now: () => 0 } };
vm.runInNewContext(gripSource, scope);
// The real dual-wield visuals call this right after capture; it reads the same runtime grip state.
window.HobunjiDualWieldWeaponVisuals = { syncNow: () => window.HobunjiHandToolGrips.currentSecondaryGripAnimationState() };
tasks.get('hand-tool-grips-install')();

const grips = window.HobunjiHandToolGrips;
const off = { enabled: false, percent: 50, primaryPercent: 50 };
const on = { enabled: true, percent: 50, primaryPercent: 50 };
// Authored: Two-Hand during Windup only, released by Strike. Defaults would keep it for the whole attack.
// windupFrac/strikeFrac here are the raw call options (windup+strike only), not the stance's normalized phases.
window.Combat.deps.triggerWeaponSwingVisual(0.415, {
  windupFrac: 0.83, strikeFrac: 1, holdS: 0.43,
  pose: { neutral: { secondaryGrip: off }, windup: { secondaryGrip: on }, strike: { secondaryGrip: off } },
});
const at = progress => { snapshot = { ...snapshot, combatProgress: progress }; return grips.currentSecondaryGripAnimationState(); };

assert.equal(at(0.35).influence, 1, 'Two-Hand is fully on at the end of Windup');
assert.equal(at(0.35).source, 'animation-pose', 'authored pose flags are used, not the game defaults');
assert.equal(at(0.42).influence, 0, 'authored Strike pose releases the second hand');
assert.equal(at(0.6).influence, 0, 'the hold phase stays on the Strike grip');
assert.equal(at(0.85).influence, 0, 'hold ends on the Strike grip');
assert.equal(at(1).influence, 0, 'returns to Neutral');
console.log('runtime grips: authored pose flags and normalized timing ok');

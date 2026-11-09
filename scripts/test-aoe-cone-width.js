#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Validates perk-only cone widening against shipped combat executors.
const fs = require('node:fs'); // Reads the production scripts, including the HUD contract.
const vm = require('node:vm'); // Executes real player combat and progression code without a browser.

const ranks = { increaseAoe: 0, increaseLungeDistance: 0 }; // Mutable perk ranks used to compare the same weapon before and after buffs.
const player = { x: 0, y: 0, angle: 0, stamina: 100 }; // Fixed attacker for both before/after strikes.
const registered = {}; // Captures actual gameplay ability callbacks.
let clockMs = 2000; // Ensures consecutive combo taps are beyond the reset window.
let swing = null; // The actual animation cone used for collision trails.
let lunge = null; // Travel must not change when only AoE rank changes.
let action = null; // Completes staged actions so a second test tap can execute.
const window = {
  __hobunjiPlayerProfile: {},
  PerkSystem: { rank: (_scope, id) => ranks[id] || 0 },
  ResourceSystem: { spendStamina: () => ({ spent: 10, excess: 0 }), getExhaustionSpeed: () => 1 },
  WeaponShapeStats: { current: () => ({ power: 1, speed: 1, range: 1, efficiency: 1 }) },
  Combat: {
    deps: {
      player, TILE: 32, hostileObjects: [],
      currentWeaponKey: () => 'testAxe', weaponDamageTypeForTool: () => 'blunt',
      currentWeaponDamageType: () => 'blunt', getCurrentArea: () => 'forest',
      weaponAbility: () => ({ damage: 10, rangePx: 64, knockbackPxS: 100 }),
      triggerWeaponSwingVisual: (_duration, opts) => { swing = opts; },
      beginCombatLunge: (distancePx) => { lunge = distancePx; },
    },
    abilities: { register: (id, ability) => { registered[id] = ability; } },
    isStaggered: () => false,
    beginStagedAction: (options) => { action = options; return options; },
    playerMeleeThreat: () => null,
  },
};
const context = vm.createContext({
  window, console, performance: { now: () => clockMs },
  document: { addEventListener() {} }, localStorage: { getItem: () => null },
}); // Browser-like scope shared by real progression and attack modules.
function load(path) {
  const source = fs.readFileSync(path, 'utf8'); // Compiled and executed directly, never reconstructed in the test.
  vm.runInContext(source, context, { filename: path });
  return source;
}
function approx(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, got ${actual}`);
}
function tap(id) {
  swing = lunge = action = null;
  registered[id].onTap();
  assert(swing && action && lunge !== null, `${id} must start an attack with a real cone and lunge`);
  const result = { range: swing.coneRangePx, halfCone: swing.coneHalfConeRad, lunge }; // Shared before/after geometry snapshot.
  action.onComplete?.();
  clockMs += 2000;
  return result;
}

load('docs/js/combat/combat-progression.js');
const progress = window.CombatProgression; // Real perk/mastery effect aggregator.
assert.equal(progress.getEffects('testAxe', 'swingCombo').stats.rangeMul, undefined, 'unearned mastery must not grant range');
load('docs/js/combat/combat-combo.js');
load('docs/js/combat/combat-quickattacks.js');

for (const id of ['swingCombo', 'pokeCombo', 'exhaustCutter']) {
  ranks.increaseAoe = 0;
  const baseline = tap(id); // Zero-perk range, angle, and lunge.
  ranks.increaseAoe = 3;
  const buffed = tap(id); // +30% angle, with exactly the same radial reach.
  approx(buffed.range, baseline.range, `${id} AoE must not extend reach`);
  approx(buffed.halfCone, baseline.halfCone * 1.3, `${id} AoE widens cone`);
  approx(buffed.lunge, baseline.lunge, `${id} AoE must not extend lunge`);
  assert.equal(progress.getEffects('testAxe', id).stats.rangeMul, undefined, `${id} AoE must not grant rangeMul`);
}
ranks.increaseAoe = 3;
const originalEffects = progress.getEffects; // Injects a separate mastery-reach upgrade without changing the AoE perk.
progress.getEffects = (...args) => {
  const effects = originalEffects(...args); // Fresh real progression result for the current ability.
  effects.stats.rangeMul = 0.12;
  return effects;
};
const withMasteryReach = tap('swingCombo'); // Genuine Extended Reach should remain additive independently of AoE.
approx(withMasteryReach.range, 64 * 0.6 * 1.12, 'mastery still increases radial reach');
approx(withMasteryReach.halfCone, 26 * Math.PI / 180 * 1.3, 'mastery reach does not widen the cone');

// These attack families share the real progression effect field but have different
// windup/hold triggers. Lock in their integration seams without duplicating executor logic.
for (const path of [
  'docs/js/combat/combat-flurry.js',
  'docs/js/combat/combat-charged-breaker.js',
  'docs/js/combat/combat-counter-shield.js',
]) {
  const source = fs.readFileSync(path, 'utf8'); // Production implementation for each independently staged strike.
  new vm.Script(source, { filename: path });
  assert.match(source, /const halfConeRad = Math\.min\(Math\.PI, [^\n]*\* \(1 \+ \(effects\.stats\.coneWidthMul \|\| 0\)\)\);/, `${path} must widen the live hit cone`);
}
const hud = fs.readFileSync('docs/js/combat/melee-hud-reticle.js', 'utf8'); // HUD targeting must use the same width without changing reach.
assert.match(hud, /halfConeRad = Math\.min\(Math\.PI, halfConeRad \* \(1 \+ \(stats\.coneWidthMul \|\| 0\)\)\)/);
console.log('AoE cone width: progression, combo, poke, quick attack, mastery reach, lunge, heavy strikes, and HUD: PASS');

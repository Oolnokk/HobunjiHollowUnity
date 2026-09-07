'use strict';

const fs = require('fs'); // Reads the exact combo runtime exercised by gameplay.
const path = require('path'); // Resolves the repository module from this test script.
const assert = require('assert'); // Verifies impact and authored Strike endpoint timing coincide.
const vm = require('vm'); // Executes the browser IIFE with focused combat dependency mocks.

const modulePath = path.join(__dirname, '..', 'docs', 'js', 'combat', 'combat-combo.js'); // Player combo module under test.
const source = fs.readFileSync(modulePath, 'utf8'); // Full runtime source evaluated without copying combo logic.
const registered = {}; // Captures ability handlers registered by the combo module.
let visualCall = null; // Captures the normalized weapon animation timing requested by the first swing.
let stagedCall = null; // Captures the gameplay hit clock requested for the same swing.

global.performance = { now: () => 1000 }; // Stable combo-reset clock for a deterministic first attack.
global.window = {
  ResourceSystem: {
    spendStamina() {},
    getExhaustionSpeed: () => 1,
  },
  CombatProgression: {
    getEffects: () => ({ afflictions: {}, stats: {} }),
  },
  Combat: {
    abilities: {
      register(id, ability) { registered[id] = ability; },
    },
    isStaggered: () => false,
    beginStagedAction(opts) { stagedCall = opts; return { opts }; },
    deps: {
      player: { angle: 0 },
      TILE: 32,
      hostileObjects: [],
      currentWeaponKey: () => 'hatchet',
      currentWeaponDamageType: () => 'sharp',
      weaponAbility: () => ({ damage: 14, rangePx: 34, knockbackPxS: 360 }),
      triggerWeaponSwingVisual(durationS, opts) { visualCall = { durationS, opts }; },
      beginCombatLunge() {},
      getCurrentArea: () => 'farm',
    },
  },
};

vm.runInThisContext(source, { filename: modulePath });
registered.swingCombo.onTap();

assert.ok(visualCall, 'expected the first sweep to start a weapon visual');
assert.ok(stagedCall, 'expected the first sweep to start a gameplay hit action');
const visualStrikeAtS = visualCall.durationS * visualCall.opts.strikeFrac; // Exact time the pose interpolation reaches authored Strike.
assert.ok(Math.abs(stagedCall.windupS - visualStrikeAtS) < 1e-9, `impact ${stagedCall.windupS}s must equal visual Strike ${visualStrikeAtS}s`);
assert.strictEqual(stagedCall.strikeS, 0, 'the hit fires at the endpoint rather than starting another post-impact strike interval');
assert.strictEqual(visualCall.opts.holdS, 1, 'the existing Strike hold remains unchanged after timing alignment');

console.log('test-combo-strike-hold-pose-alignment: ok');

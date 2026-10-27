#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies the shipped shape catalog, Foundry composition, and attack integration.
const fs = require('node:fs'); // Reads production modules rather than reimplementing their behavior.
const vm = require('node:vm'); // Runs gameplay IIFEs in a lightweight browser-compatible test context.

const player = { angle: 0, stamina: 100 }; // Fixed actor identity checks shape power is player-only.
const registrations = {}; // Captures the real attack ability registrations.
let costPaid = null; // Records stamina efficiency at the actual resource-spend seam.
let staged = null; // Records the real strike clock for tempo comparisons.
let visual = null; // Records the animation duration and hit-cone geometry.
let lunge = null; // Confirms shape range does not alter lunge travel.

const window = {
  location: { pathname: '/index.html' },
  RuntimeFrameScheduler: { register() {} },
  ResourceSystem: {
    spendStamina(_actor, amount) { costPaid = amount; return { spent: amount, excess: 0 }; },
    getExhaustionSpeed: () => 1,
  },
  CombatProgression: { getEffects: () => ({ afflictions: {}, stats: {} }) },
  Combat: {
    deps: {
      player,
      currentWeaponKey: () => 'dagger_tinBronze',
      getWeaponDefinition: () => ({ shapeKey: 'dagger' }),
      currentWeaponDamageType: () => 'sharp',
      TILE: 32,
      hostileObjects: [],
      weaponAbility: () => ({ damage: 6, rangePx: 64, knockbackPxS: 360 }),
      triggerWeaponSwingVisual(durationS, opts) { visual = { durationS, opts }; },
      beginCombatLunge(distancePx, durationS) { lunge = { distancePx, durationS }; },
    },
    isStaggered: () => false,
    abilities: { register(id, ability) { registrations[id] = ability; } },
    beginStagedAction(action) { staged = action; return action; },
    playerMeleeThreat: () => null,
  },
};
const context = vm.createContext({ window, console, performance: { now: () => 1000 } }); // Same browser namespace across modular and combat imports.
function load(path) { vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path }); }
function close(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-8, `${message}: got ${actual}, expected ${expected}`); }

load('docs/config/modular-weapons.js');
load('docs/js/modular-weapons.js');
load('docs/js/combat/weapon-shape-stats.js');
load('docs/js/combat/combat-attack-events.js');
const stats = window.WeaponShapeStats; // Single production resolver for all assertions.
assert.deepEqual([...Object.keys(stats.DEFAULT)].sort(), ['efficiency', 'power', 'range', 'speed']);
for (const [shape, expected] of Object.entries({
  warhammer: [1.5, 0.75, 1],
  dagger: [0.5, 2.0, 0.25],
  bshuakauitl: [0.5, 1.75, 1.25],
})) {
  const v = stats.forKey(shape + '_tinBronze', { shapeKey: shape });
  close(v.power, expected[0], `${shape} power`);
  close(v.speed, expected[1], `${shape} speed`);
  close(v.range, expected[2], `${shape} range`);
}
const shaft = stats.forShape('warhammer'), head = stats.forShape('dagger'); // Uses concrete donor shapes; head must never replace shaft identity.
const modular = stats.forKey('modular:warhammer:dagger:tinBronze');
for (const key of ['power', 'speed', 'range', 'efficiency']) {
  close(modular[key], shaft[key] * (1 + 0.5 * (head[key] - 1)), `Foundry shaft-first ${key}`);
}
assert.deepEqual(JSON.parse(JSON.stringify(stats.forKey('not-a-weapon'))), JSON.parse(JSON.stringify(stats.DEFAULT)));

const contextForPower = window.CombatAttackEvents.prepare({
  attacker: player, weaponKey: 'dagger_tinBronze', abilityId: 'pokeCombo',
  damage: 8, knockbackPxS: 200, afflictionBonuses: { cut: 3 },
});
for (const field of ['damage', 'affliction', 'knockback', 'footingDamage']) close(contextForPower.modifiers[field], 0.5, `player ${field} multiplier`);
const npcPower = window.CombatAttackEvents.prepare({ attacker: {}, weaponKey: 'dagger_tinBronze', abilityId: 'pokeCombo' });
close(npcPower.modifiers.damage, 1, 'NPC shape damage is applied in the bandit executor only');

load('docs/js/combat/combat-combo.js');
registrations.pokeCombo.onTap();
assert(staged && visual && lunge, 'real dagger combo starts gameplay, visual, and lunge together');
close(costPaid, 13 / 1.4, 'dagger stamina efficiency');
close(staged.windupS, (0.18 + 0.09) / 2, 'dagger impact speed');
close(visual.durationS, (0.18 + 0.09) / 2, 'dagger animation speed');
close(visual.opts.holdS, 0.47 / 2, 'dagger strike hold speed');
close(visual.opts.coneRangePx, 64 * 1.15 * 0.6 * 0.25, 'dagger cone radial size');
close(visual.opts.coneHalfConeRad, 9 * Math.PI / 180 * 0.25, 'dagger cone angle');
close(lunge.distancePx, 32 * 2 * 1.5, 'dagger range leaves lunge distance unchanged');
console.log('Weapon shape stats: material independence, Foundry blending, power, pose speed, stamina, range, lunge: PASS');

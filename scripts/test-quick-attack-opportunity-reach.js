#!/usr/bin/env node
'use strict';

// Quick Attack's combat strike and opportunity cue must share read-only reach
// geometry. This regression uses the actual ability module, not a duplicate
// formula in the test or the visual indicator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const abilities = {}; // Registered attack actions exercised below.
const calls = { prepare: 0, lunges: [], swings: 0, spentFooting: 0 }; // Side-effect counters for cue-versus-strike comparisons.
const stats = { rangeMul: 0.15, lungeMul: 0.2, coneWidthMul: 0.3 }; // Equipped mastery/perk bonuses.
const shape = { range: 1.25, speed: 1, efficiency: 1, power: 1 }; // Actual weapon-shape range and cadence.
const base = { damage: 14, rangePx: 64, knockbackPxS: 360 }; // Current cut ability base geometry.
let gustActive = true; // Toggle Living Gust without changing the player's equipped attack.
const deps = {
  TILE: 32,
  player: { x: 0, y: 0, angle: 0, health: 100, stamina: 100 },
  currentWeaponKey: () => 'test-weapon',
  weaponAbility: () => base,
  triggerWeaponSwingVisual() { calls.swings++; },
  beginCombatLunge(distance, duration, hop, geometry) { calls.lunges.push({ distance, duration, hop, geometry }); },
};
const context = {
  console, Math, Number, Object, Array, Set, Map, JSON,
  window: null,
  document: { addEventListener() {} },
  performance: { now: () => 1000 },
  Combat: {
    deps,
    abilities: { register(id, ability) { abilities[id] = ability; } },
    isStaggered: () => false,
    playerMeleeThreat: () => ({}), // Live onTap builds a threat descriptor before scheduling its strike.
    beginStagedAction: () => ({ cancel() {} }),
  },
  CombatProgression: { getEffects: () => ({ stats, afflictions: {} }) },
  WeaponShapeStats: { current: () => shape },
  ResourceSystem: {
    spendStamina: () => ({ spent: 60, excess: 0 }),
    getExhaustionSpeed: () => 1,
  },
  EnchantmentSystem: {
    TUNING: { LIVING_GUST_LUNGE_MULTIPLIER: 1.25 },
    hasBase: () => gustActive,
    getEnchantmentPowerMultiplier: () => 2,
  },
};
context.window = context;
context.CombatAttackEvents = {
  prepare(input) {
    calls.prepare++;
    calls.spentFooting++; // Standing in for Living Gust's actual spending prepare listener.
    return { ...input, modifiers: { lunge: gustActive ? 1.5 : 1, damage: 1, affliction: 1 }, afflictionBonuses: {} };
  },
  scaleAfflictions: source => source,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/combat/combat-quickattacks.js', 'utf8'), context, { filename: 'combat-quickattacks.js' });

const quick = context.Combat.quickAttackData;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, received ${actual}`);
assert.equal(quick.getReachProfile(deps, 'unknown'), null, 'invalid technique has no reach');
assert.equal(quick.getReachProfile({ TILE: 0 }, 'backstabFlick'), null, 'invalid tile scale does not produce a cue');
const profile = quick.getReachProfile(deps, 'backstabFlick');
close(profile.rangePx, 69, 'cone length includes mastery and weapon shape');
close(profile.baseLungePx, 172.8, 'lunge includes mastery and perk modifiers');
close(profile.lungePx, 259.2, 'Living Gust scales the actual lunge');
close(profile.reachPx, 328.2, 'cue limit is lunge PLUS cone length');
close(profile.halfConeRad, 39 * Math.PI / 180 * 1.25 * 1.3, 'half-cone width includes shape and mastery');
assert.equal(calls.prepare, 0, 'reading cue reach never invokes the attack preparation listener');
assert.equal(calls.spentFooting, 0, 'checking the cue never spends Footing');

abilities.backstabFlick.onTap();
assert.equal(calls.prepare, 1, 'live attack still calls preparation once');
assert.equal(calls.lunges.length, 1, 'live attack starts one lunge');
close(calls.lunges[0].distance, profile.lungePx, 'actual attack travels precisely the same lunge computed for its cue');
close(calls.lunges[0].geometry.rangePx, profile.rangePx, 'actual hit cone uses exactly the preview range');
close(calls.lunges[0].geometry.halfConeRad, profile.halfConeRad, 'actual hit cone uses exactly the preview angle');

gustActive = false;
const noGust = quick.getReachProfile(deps, 'backstabFlick');
close(noGust.lungePx, noGust.baseLungePx, 'unequipping Living Gust removes its reach modifier');
assert.ok(noGust.reachPx < profile.reachPx, 'reticle radius shrinks dynamically without enchantment');
assert.equal(calls.prepare, 1, 'change detection still does not prepare another attack');

shape.range = 1;
const smallerShape = quick.getReachProfile(deps, 'backstabFlick');
assert.ok(smallerShape.rangePx < noGust.rangePx, 'weapon shape affects only final cone length, as in combat');

context.Combat.applyQuickAttackConfig({ RANGE_SCALE: 0.8, LUNGE_TILE_MUL: 3 });
const authored = quick.getReachProfile(deps, 'backstabFlick');
close(authored.baseLungePx, deps.TILE * 3 * 1.2, 'newly loaded author tuning updates the live lunge');
close(authored.rangePx, base.rangePx * 1.25 * 0.8 * 1.15, 'newly loaded author tuning updates cone length');
close(authored.reachPx, authored.lungePx + authored.rangePx, 'radius tracks runtime tuning after config loads');
assert.equal(calls.spentFooting, 1, 'geometry checks remain side-effect free with changing gear/config');

console.log('quick attack opportunity reach matches live attack, modifiers and pure cue evaluation: PASS');

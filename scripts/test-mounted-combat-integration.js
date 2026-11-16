'use strict';
// Runtime regression for mounted combat: use the production combo/loadout/input
// owners, not a synthetic copy of the mounted attack formulas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8');

let timeMs = 1000; // Simulates actual short presses and delayed stage commits.
let riding = 'mounted'; // Reuses production mount-state checks on every press.
let currentCombo = 'pokeCombo'; // Exercises an authored 3-Poke opener, not a fake combo step.
let momentum = 1.75; // Deterministic impact-time carrier speed multiplier.
let strikes = []; // Captures committed staged actions so impact can be fired separately from press.
let hits = []; // Captures damage, afflictions and post-hit mastery effects.
let masteryIds = []; // Proves combo mastery selection uses the equipped weapon's native combo.
let staminaSpent = []; // Detects the independent mounted-training discount on the one-off.
let legacy = 0; // Counts inappropriate ordinary weapon fallback attacks.
let lunges = 0; // Counts inappropriate rider lunges.
let alignmentRequests = 0; // Counts on-foot target alignment attempted while seated.
let bursts = []; // Actual mounted quick/heavy movement bursts requested by their production abilities.
let holdCancelled = 0; // Ensures dismounting cancels the charged visual, not an on-foot release.
let regenBlocked = false; // Checks that the heavy hold removes its stamina-regeneration blocker.

const player = { x: 0, y: 0, stamina: 100, angle: 0 };
const foe = { health: 1000, areaId: 'field', x: 36, y: 0, def: { label: 'target' } };
const mount = { health: 100, areaId: 'field', x: 0, y: 0, vx: 0, vy: 0 };
const profile = { characterId: 'test-rider', combatLoadout: {}, combatTechniqueUnlocks: ['exhaustCutter'] };
const store = { characters: [{ id: 'test-rider' }] };
const localStorage = {
  getItem: () => JSON.stringify(store),
  setItem(_key, value) { Object.assign(store, JSON.parse(value)); },
};
const document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
const deps = {
  player, TILE: 64, hostileObjects: [foe],
  currentWeaponKey: () => 'test-hatchet',
  currentComboAbilityId: () => currentCombo,
  currentWeaponDamageType: () => 'sharp',
  weaponAbility: () => ({ damage: 20, rangePx: 100, knockbackPxS: 125 }),
  getCurrentArea: () => 'field',
  getPlayerMeleeAimPitch: () => 0,
  setCombatSwingCone() {}, triggerWeaponSwingVisual() {},
  triggerWeaponHoldVisual() {},
  releaseWeaponSwingHold() {},
  cancelWeaponSwingHold: () => { holdCancelled++; },
  getWeaponSwingWindupPoseProgress: () => 0.8,
  clearVegetationInAttackCone: () => 0,
  fireLegacyWeaponAction: () => { legacy++; },
  beginCombatLunge: () => { lunges++; },
  requestMeleeAttackAlignment: callback => {
    alignmentRequests++;
    callback();
    return null;
  },
  damageCreature: (target, amount, _x, _y, _knockback, opts) => {
    hits.push({ amount, opts });
    target.health -= amount;
  },
  playWeaponHitSfx() {}, awardWeaponMasteryXp() {}, showToast() {},
};
const Combat = {
  deps, isStaggered: () => false, update() {}, meleeHit: () => true,
  playerMeleeThreat: () => ({}),
  setWindupProgressTransform() {},
  beginStagedAction(action) {
    strikes.push(action);
    return { phase: 'windup' };
  },
};
const window = {
  Combat,
  Mounts: {
    get rideState() { return riding; },
    get rideEntity() { return riding === 'mounted' ? mount : null; },
    mountedMeleeDamageMultiplier: () => momentum,
    mountedMeleeStaminaMultiplier: () => 0.8,
    beginMountedCombatBurst: (multiplier, seconds) => { bursts.push({ multiplier, seconds }); return true; },
  },
  __hobunjiPlayerProfile: profile,
  MeleePoseSpacing: {}, WeaponToolStances: { init() {} },
  matchMedia: () => ({ matches: false }),
  addEventListener() {}, dispatchEvent() {},
  WeaponShapeStats: { current: () => ({ power: 1, speed: 1, range: 1, efficiency: 1 }) },
  CombatProgression: {
    getEffects(_key, id) {
      masteryIds.push(id);
      return { afflictions: { weak: 1 }, stats: { damageMul: 0.2 } };
    },
  },
  ResourceSystem: {
    spendStamina(_actor, cost) { staminaSpent.push(cost); return { spent: cost, excess: 0 }; },
    getExhaustionSpeed: () => 1,
    setStaminaRegenBlocked(_actor, _source, blocked) { regenBlocked = blocked; },
  },
  CombatAttackEvents: {
    prepare: options => ({ ...options, modifiers: { damage: 1, affliction: 1, knockback: 1, footingDamage: 1 } }),
    scaleAfflictions: effects => effects,
    hit() {},
  },
  EnchantmentSystem: { applyPeripheralGust() {} },
  AttackPoseTemplates: { poseFor: () => ({}) },
};
const context = vm.createContext({
  window, document, localStorage, console, CustomEvent: function(){},
  performance: { now: () => timeMs }, requestAnimationFrame: fn => fn(),
  setTimeout: () => 0, clearTimeout() {},
});
for (const file of [
  'docs/js/combat/combat-loadout.js',
  'docs/js/combat/combat-combo.js',
  'docs/js/combat/combat-quickattacks.js',
  'docs/js/combat/combat-mounted.js',
  'docs/js/combat/combat-charged-breaker.js',
  'docs/js/combat/combat-input.js',
]) vm.runInContext(read(file), context, { filename: file });

assert.equal(Combat.loadout.getSlot('tap1'), 'mountedStrike');
assert.equal(Combat.loadout.getSlot('hold1'), 'chargedBreaker');
assert.equal(Combat.loadout.getSlot('tap2'), null);
assert.equal(Combat.loadout.getSlot('hold2'), null);
assert.equal(Combat.loadout.setSlot('tap1', 'swingCombo'), false);
assert.equal(Combat.loadout.setSlot('hold2', 'chargedBreaker'), false);

// Missing mounted Action 2 assignment never falls back to ordinary melee.
Combat.input.fireTap(2);
assert.equal(legacy, 0, 'empty mounted quick slot has no fallback attack');

// Enabled mobile auto-target should not send mounted melee through on-foot alignment.
Combat.input.setAutoTargetEnabled(true, { persist: false });
Combat.input.pressStart(1);
timeMs += 100;
Combat.input.pressEnd(1);
assert.equal(alignmentRequests, 0, 'mounted strike does not wait for on-foot auto alignment');
assert.equal(strikes.length, 1, 'mounted strike starts the real staged attack');
assert.equal(lunges, 0, 'mounted strike cannot initiate a player lunge');
assert.deepEqual(masteryIds, ['pokeCombo'], 'mounted tap inherits the real poke combo mastery');
assert.equal(staminaSpent[0], Combat.comboData.pokeCombo[0].staminaCost * 0.8);
strikes[0].onStrike();
strikes[0].onComplete();
const expected = Math.round(20 * Combat.comboData.pokeCombo[0].damageMul * 1.2 * momentum);
assert.equal(hits[0].amount, expected, 'mounted melee damage includes actual impact momentum');
assert.equal(hits[0].opts.abilityId, 'pokeCombo', 'mounted strike retains combo mastery/hit attribution');
assert.equal(hits[0].opts.afflictionBonuses.weak, 1, 'mastery affliction is inherited');

// Releasing a scheduled strike after dismount must never create a phantom on-foot hit.
timeMs += 400;
Combat.input.pressStart(1);
timeMs += 80;
Combat.input.pressEnd(1);
assert.equal(strikes.length, 2);
riding = 'none';
strikes[1].onStrike();
strikes[1].onComplete();
assert.equal(hits.length, 1, 'dismount blocks a mounted strike impact');
assert.equal(lunges, 0);
assert.equal(Combat.loadout.getSlot('tap1'), 'pokeCombo', 'on-foot combo restored');

// Slot choices are independent and persist per weapon without mutating tap1/hold1.
assert.equal(Combat.abilities.get('exhaustCutter').category, 'quickAttack', 'real quick-attack ability is available');
assert.equal(Combat.loadout.setSlot('tap2', 'exhaustCutter', 'mounted'), true);
assert.equal(Combat.loadout.getSlot('tap2', 'mounted'), 'exhaustCutter');
assert.equal(Combat.loadout.getSlot('tap2', 'foot'), 'exhaustCutter'); // Existing foot defaults are unchanged.
assert.equal(store.characters[0].combatLoadout.__mountedCombatLoadouts['test-hatchet'].tap2, 'exhaustCutter');
const saved = Combat.loadout.serialize();
Combat.loadout.load(saved);
assert.equal(Combat.loadout.getSlot('tap2', 'mounted'), 'exhaustCutter');
// Quick Attack tap reuses its real mastery and swaps rider lunge for a mount burst.
riding = 'mounted';
const quick = Combat.abilities.get('exhaustCutter'); // Production Quick Attack (not a fake registered ability).
const quickStagesBefore = strikes.length;
const quickBurstsBefore = bursts.length;
quick.onTap();
assert.equal(strikes.length, quickStagesBefore + 1, 'mounted quick uses production staged attack timeline');
assert.equal(bursts.length, quickBurstsBefore + 1, 'mounted quick replaces its lunge with a speed burst');
assert.equal(lunges, 0, 'mounted quick does not move the player with a lunge');
const hitsBeforeQuickDismount = hits.length; // Delayed strike must be harmless after dismounting.
riding = 'none';
strikes[quickStagesBefore].onStrike();
strikes[quickStagesBefore].onComplete?.();
assert.equal(hits.length, hitsBeforeQuickDismount, 'mounted quick cannot hit as a phantom foot strike after dismount');

// Charged Breaker remains the original heavy ability, with its mastery and
// visible charge, but the release accelerates the mount rather than the rider.
riding = 'mounted';
const heavy = Combat.abilities.get('chargedBreaker'); // Locked mounted hold1 resolves to the production heavy ability.
const heavyStagesBefore = strikes.length;
const heavyBurstsBefore = bursts.length;
heavy.onHoldStart();
assert.equal(regenBlocked, true, 'heavy hold blocks stamina regeneration while charging');
heavy.onHoldEnd();
assert.equal(regenBlocked, false, 'heavy release restores stamina regeneration');
assert.equal(strikes.length, heavyStagesBefore + 1, 'charged mounted strike is still scheduled');
assert.equal(bursts.length, heavyBurstsBefore + 1, 'charged heavy releases the mount gallop multiplier');
assert(bursts.at(-1).multiplier >= 2.4, 'charged heavy surge is stronger than ordinary cruise');
assert.equal(lunges, 0, 'mounted heavy release never calls the player lunge');

heavy.onHoldStart();
assert.equal(regenBlocked, true);
riding = 'none';
const heavyStrikesBeforeDismount = strikes.length;
const heavyBurstsBeforeDismount = bursts.length;
heavy.onHoldEnd();
assert.equal(strikes.length, heavyStrikesBeforeDismount, 'dismounted heavy hold cannot release a phantom foot strike');
assert.equal(bursts.length, heavyBurstsBeforeDismount, 'dismount cannot trigger a stale mount burst');
assert.equal(lunges, 0, 'dismounted heavy hold cannot produce an on-foot lunge');
assert(holdCancelled > 0, 'dismounted heavy cancels its held weapon pose');
assert.equal(regenBlocked, false, 'dismount fully releases heavy stamina regeneration block');
// A scripted cliff crossing retains the mounted loadout for its duration,
// but does not permit a quick/heavy to fall through as a rider lunge.
riding = 'climbLeap';
const cliffStrikesBefore = strikes.length;
const cliffLungesBefore = lunges;
timeMs += 1000;
Combat.input.pressStart(1);
timeMs += 100;
Combat.input.pressEnd(1);
assert.equal(strikes.length, cliffStrikesBefore, 'cliff crossing rejects mounted taps');
Combat.input.pressStart(1);
timeMs += 300;
Combat.input.update(0.3);
assert.equal(Combat.input.getState(1).down, false, 'cliff crossing does not leave a pending heavy hold');
assert.equal(lunges, cliffLungesBefore, 'cliff traversal cannot trigger an on-foot lunge');
riding = 'none';
console.log('mounted combat loadout, real combo/quick/heavy abilities, momentum, dismount and cliff safety passed');

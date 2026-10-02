#!/usr/bin/env node
'use strict';

// Enchantments / Immundanity / Enhanced Resources / Trinket Attunement /
// Harlyao relics — executes the real modules in a VM against a minimal
// Combat stub (no game.js), covering the design's validation list.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let testNowMs = 1000;
let randomQueue = []; // Deterministic GameRandom: shift queued values, else 0.99 (never procs).
const events = [];
const context = {
  console,
  performance: { now: () => testNowMs },
  Date,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  GameRandom: { random: () => (randomQueue.length ? randomQueue.shift() : 0.99) },
};
const listeners = {};
context.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
context.dispatchEvent = event => { for (const fn of listeners[event.type] || []) fn(event); return true; };
context.window = context;
context.globalThis = context;
vm.createContext(context);
const load = file => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

load('docs/config/config.js');
context.document = { addEventListener() {}, getElementById: () => null, querySelector: () => null }; // After config.js (which installs browser-only hooks when a document exists). No DOM: UI renderers early-out.
context.SCRATCHBONES_CONFIG = { game: { combat: { resourceSystem: { pukeChancePerSec: 0 } } } };
load('docs/js/combat/resource-system.js');
const RS = context.ResourceSystem;
context.GameRandom.random = () => (randomQueue.length ? randomQueue.shift() : 0.99); // resource-system.js installs the shared seeded GameRandom; drive it deterministically.

function makeEntity(extra = {}) {
  const e = { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100, x: 0, y: 0, areaId: 'arena', ...extra };
  RS.initEntity(e);
  return e;
}

const player = makeEntity({ name: 'Player', angle: 0 });
let gear = {}; // Plays the role of game.js's gearInventory (character save record).
let weapon = 'sword';
const slotAbilities = { tap1: 'swingCombo', tap2: 'opportunistJab', hold1: 'chargedBreaker', hold2: 'counterShield' };
const categories = { swingCombo: 'combo', opportunistJab: 'quickAttack', chargedBreaker: 'offensiveHold', acceleratingFlurry: 'offensiveHold', counterShield: 'defensiveHold' };
const hostileObjects = [];
const companionObjects = [];
const knockbacks = [];
let saves = 0;
function inCone(fromX, fromY, facing, toX, toY, rangePx, halfCone) {
  const dx = toX - fromX, dy = toY - fromY;
  if (Math.hypot(dx, dy) > rangePx) return false;
  let diff = Math.atan2(dy, dx) - facing;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff) <= halfCone;
}
context.Combat = {
  deps: {
    player, hostileObjects, companionObjects, TILE: 64,
    currentWeaponKey: () => weapon,
    getGearInventory: () => gear,
    saveGearInventory: () => { saves++; },
    getCurrentArea: () => 'arena',
    isDevMode: () => false,
    inCone,
    applyKnockback: (target, fromX, fromY, speed, meta) => knockbacks.push({ target, speed, meta }),
    showToast: () => {},
    weaponDamageTypeForTool: () => 'sharp',
    toolMasteryLevel: () => 5,
  },
  loadout: {
    SLOT_IDS: ['tap1', 'tap2', 'hold1', 'hold2'],
    get: () => ({ ...slotAbilities }),
    getSlot: slot => slotAbilities[slot],
  },
  abilities: { get: id => (categories[id] ? { id, category: categories[id], label: id } : null) },
};

load('docs/js/perk-system.js');
load('docs/js/combat/companion-offense.js');
load('docs/js/combat/combat-attack-events.js');
load('docs/js/combat/combat-enchantments.js');
context.__hobunjiPlayerProfile = { abilityProgression: { plain: { chargedBreaker: { 1: 0 } }, magic: { chargedBreaker: { 1: 0 } } } }; // CombatProgression loads its saved choices from the profile at startup.
load('docs/js/combat/combat-progression.js');
delete context.__hobunjiPlayerProfile;
load('docs/js/trinket-system.js');
load('docs/js/harlyao-relics.js');
const { EnchantmentSystem: ES, CombatAttackEvents: CAE, TrinketSystem: TS, CompanionOffense: CO, HarlyaoRelics: HR, PerkSystem } = context;
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message); // VM-realm arrays/objects fail strict cross-realm deepEqual.
const log = () => ES.debugSnapshot().recentEvents.join('\n');
const reset = () => { gear = {}; weapon = 'sword'; };

// ── 1-3: Base limit, independent Flourishes ────────────────────────
reset();
assert.equal(ES.addBase('sword', 'burning'), true);
assert.equal(ES.addBase('sword', 'frostbitten'), true);
assert.equal(ES.addBase('sword', 'mirrored'), false, '3. a third Base enchantment is rejected');
same([...ES.stateFor('sword').base], ['burning', 'frostbitten'], '3. rejection leaves the two existing Base enchantments intact');
assert.equal(ES.equipBase('sword', 2, 'mirrored'), false, '3. no hidden third Base index');
assert.equal(ES.addBase('sword', 'burning'), false, 'the same Base enchantment cannot occupy both slots');
assert.equal(ES.setFlourish('sword', 'tap1', 'sicced'), true);
assert.equal(ES.setFlourish('sword', 'hold1', 'fury'), true);
assert.equal(ES.setFlourish('sword', 'tap1', 'burning'), false, 'Base enchantments cannot be Flourishes');
assert.equal(ES.flourishForSlot('tap1', 'sword'), 'sicced');
assert.equal(ES.flourishForSlot('hold1', 'sword'), 'fury', '3. each slot holds its own Flourish');
assert.equal(ES.flourishForSlot('tap2', 'sword'), null);
ES.setFlourish('sword', 'tap1', 'moralized');
assert.equal(ES.flourishForSlot('tap1', 'sword'), 'moralized', 'one Flourish per slot: setting replaces');
assert.ok(saves > 0, 'enchantment edits persist through saveGearInventory');

// 1. Two Base enchantments operate simultaneously on one hit.
const enemy = makeEntity({ name: 'Bandit', x: 40, y: 0 });
hostileObjects.push(enemy);
let ctx = CAE.prepare({ attacker: player, abilityId: 'swingCombo', comboStep: 1, comboFinisher: false });
CAE.hit(ctx, { target: enemy, actualDamage: 10 });
assert.ok(RS.getAffliction(enemy, 'burningHealth') > 0, '1. Burning applied');
assert.ok(RS.getAffliction(enemy, 'frostbittenStamina') > 0, '1. Frostbitten applied on the same hit');

// ── 9-11: Immundanity ─────────────────────────────────────────────
function immFor(state) { gear = { weaponEnchantments: { w: state } }; return ES.getWeaponImmundanity('w'); }
// Planes: sicced=Tothal fury=Hronal moralized=Kanthic resolve=Ohthic frostbitten=Tothal burning=Hronal mirrored=Kanthic livingGust=Ohthic livingFlame=Hronal
assert.equal(immFor({ base: ['frostbitten'], flourishes: {} }), 1, 'Tothal 1 → 1');
assert.equal(immFor({ base: ['frostbitten', 'burning'], flourishes: {} }), 0, '9. Tothal + Hronal cancel');
assert.equal(immFor({ base: ['frostbitten'], flourishes: { tap1: 'sicced', hold1: 'fury' } }), 1, 'Tothal 2, Hronal 1 → 1');
assert.equal(immFor({ base: ['frostbitten', 'burning'], flourishes: { tap1: 'sicced', hold1: 'fury' } }), 0, '11. Tothal 2, Hronal 2 → 0 (one-for-one, not Cartesian)');
assert.equal(immFor({ base: ['mirrored', 'livingGust'], flourishes: {} }), 0, '10. Kanthic + Ohthic cancel');
assert.equal(immFor({ base: ['frostbitten', 'mirrored'], flourishes: { tap1: 'sicced' } }), 3, 'Tothal 2, Kanthic 1 → 3');
assert.equal(ES.getEnchantmentPowerMultiplier('w'), 1.3, '12. +10% enchantment power per Immundanity');
assert.ok(Math.abs(ES.getMasteryPowerMultiplier('w') - 0.7) < 1e-9, '12. −10% mastery power per Immundanity');
gear = { weaponEnchantments: { w: { base: ['frostbitten', 'mirrored'], flourishes: { tap1: 'sicced', tap2: 'moralized', hold1: 'sicced', hold2: 'moralized' } } } };
assert.equal(ES.getWeaponImmundanity('w'), 6);
assert.ok(Math.abs(ES.getMasteryPowerMultiplier('w') - 0.4) < 1e-9);
gear.weaponEnchantments.w.flourishes = { tap1: 'sicced', tap2: 'moralized', hold1: 'sicced', hold2: 'moralized' };
gear.weaponEnchantments.w.base = ['frostbitten', 'mirrored'];
// Force a huge Immundanity through the fallback-free path: mastery never negative.
const hugeKey = 'huge';
gear.weaponEnchantments[hugeKey] = { base: ['frostbitten', 'mirrored'], flourishes: { tap1: 'sicced', tap2: 'moralized', hold1: 'sicced', hold2: 'moralized' } };
assert.ok(ES.getMasteryPowerMultiplier(hugeKey) >= 0, 'mastery multiplier never negative');

// 12. Immundanity scales only mastery-derived effects (combat-progression), not perks.
gear = { weaponEnchantments: {} };
gear.weaponEnchantments.magic = { base: ['frostbitten'], flourishes: { tap1: 'sicced' } }; // Immundanity 2
const plainFx = context.CombatProgression.getEffects('plain', 'chargedBreaker');
const magicFx = context.CombatProgression.getEffects('magic', 'chargedBreaker');
const plainTotal = [...Object.values(plainFx.afflictions), ...Object.entries(plainFx.stats).filter(([k]) => k !== 'rangeMul' && k !== 'lungeMul').map(([, v]) => v)].reduce((a, b) => a + Math.abs(b), 0);
const magicTotal = [...Object.values(magicFx.afflictions), ...Object.entries(magicFx.stats).filter(([k]) => k !== 'rangeMul' && k !== 'lungeMul').map(([, v]) => v)].reduce((a, b) => a + Math.abs(b), 0);
assert.ok(plainTotal > 0, 'fixture chooses a real mastery option');
assert.ok(Math.abs(magicTotal - plainTotal * 0.8) < 1e-9, '12. mastery-derived effects ×0.8 at Immundanity 2');

// ── 4-8: Flourish trigger qualification ───────────────────────────
reset();
ES.setFlourish('sword', 'tap1', 'moralized');
ES.setFlourish('sword', 'tap2', 'moralized');
ES.setFlourish('sword', 'hold1', 'moralized');
ES.setFlourish('sword', 'hold2', 'moralized');
const moralized = () => RS.getAffliction(player, 'moralizedStamina');
const clearMoralized = () => RS.removeAffliction(player, 'moralizedStamina', 999);
for (const step of [1, 2]) {
  CAE.hit(CAE.prepare({ abilityId: 'swingCombo', comboStep: step, comboFinisher: false }), { target: enemy, actualDamage: 5 });
}
assert.equal(moralized(), 0, '4. Combo Flourish does not fire on Combo I/II');
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', comboStep: 3, comboFinisher: true }), { target: enemy, actualDamage: 5 });
assert.ok(moralized() > 0, '4. Combo Flourish fires on Combo III');
assert.match(log(), /Combo Flourish triggered/);
clearMoralized();
CAE.hit(CAE.prepare({ abilityId: 'opportunistJab', quickConditionalBonus: false, quickBonusEffectProc: false }), { target: enemy, actualDamage: 5 });
assert.equal(moralized(), 0, '5. Quick Attack without its conditional bonus cannot fire');
CAE.hit(CAE.prepare({ abilityId: 'opportunistJab', quickConditionalBonus: true, quickBonusEffectProc: false }), { target: enemy, actualDamage: 5 });
assert.equal(moralized(), 0, '5. matching a Quick Attack condition during cooldown does not fire its Flourish');
CAE.hit(CAE.prepare({ abilityId: 'opportunistJab', quickConditionalBonus: true, quickBonusEffectProc: true }), { target: enemy, actualDamage: 5 });
assert.ok(moralized() > 0, '5. cooldown-ready Quick Attack bonus proc qualifies');
clearMoralized();
CAE.hit(CAE.prepare({ abilityId: 'chargedBreaker', chargePercentage: 0.9, fullCharge: false }), { target: enemy, actualDamage: 5 });
assert.equal(moralized(), 0, '6. partial charge cannot fire');
CAE.hit(CAE.prepare({ abilityId: 'chargedBreaker', chargePercentage: 1, fullCharge: true }), { target: enemy, actualDamage: 5 });
assert.ok(moralized() > 0, '6. full charge fires');
clearMoralized();

// 7. Flurry: per-hit proc chance for duration effects.
slotAbilities.hold1 = 'acceleratingFlurry';
randomQueue = [0.18];
CAE.hit(CAE.prepare({ abilityId: 'acceleratingFlurry', isFlurry: true, flurryHitIndex: 0 }), { target: enemy, actualDamage: 2 });
assert.ok(moralized() > 0, '7. flurry proc at 0.18 < 0.25');
assert.match(log(), /Flurry Flourish rolled 0\.18 \/ 0\.25 → PROC/);
clearMoralized();
randomQueue = [0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37];
for (let i = 0; i < 8; i++) CAE.hit(CAE.prepare({ abilityId: 'acceleratingFlurry', isFlurry: true, flurryHitIndex: i }), { target: enemy, actualDamage: 2 });
assert.equal(moralized(), 0, '7. failed per-hit rolls never multiply the effect');
assert.equal(ES.TUNING.FLURRY_FLOURISH_NUMERIC_MULTIPLIER, 0.25);
assert.equal(ES.TUNING.FLURRY_FLOURISH_PROC_CHANCE, 0.25);
slotAbilities.hold1 = 'chargedBreaker';

// 8. Defensive Flourish on block / near-hit dodge (published by the ability modules).
CAE.defensive({ attacker: player, abilityId: 'counterShield', defensiveResult: 'block', target: enemy });
assert.ok(moralized() > 0, '8. block triggers the Defensive Flourish');
assert.match(log(), /Defensive Flourish triggered on block/);
clearMoralized();
CAE.defensive({ attacker: player, abilityId: 'counterShield', defensiveResult: 'nearHitDodge', target: enemy });
assert.ok(moralized() > 0, '8. near-hit dodge triggers the Defensive Flourish');

// ── Quick Attack stackable percentage debuffs + Bleedout ──────────
const quickSharpTree = context.CombatProgression.getTree('opportunistJab', 'sharp'); // Level-three options preserve the first cooldown-debuff indexes and append the broader pool.
const quickDebuffIds = quickSharpTree[2].filter(option => option.quickBonusDebuff?.id).map(option => option.quickBonusDebuff.id); // Used to prove every authored percentage debuff is selectable.
same(quickDebuffIds, ['exposed', 'sapped', 'unsteady', 'reeling', 'heavy', 'sluggish', 'brittle', 'taxed', 'enfeebled', 'inhibited'], 'Quick Attack level 3 exposes the complete stackable debuff pool with the original first three indexes preserved');
const bleedoutChoice = quickSharpTree[2].find(option => option.quickBonusInstantEffect?.id === 'bleedout'); // Used to verify the one-shot alternative lives beside timed choices.
assert.equal(bleedoutChoice?.quickBonusInstantEffect?.amount, 6, 'Bleedout authors six base points so the default 2× Quick bonus power realizes 12');

const exposedTarget = makeEntity();
const firstExpose = RS.applyTimedDebuff(exposedTarget, 'exposed', 12, { power: 2, source: 'test' }); // First stack establishes the refreshed stack window.
assert.equal(firstExpose.stacks, 1);
testNowMs += 5000;
const secondExpose = RS.applyTimedDebuff(exposedTarget, 'exposed', 12, { power: 2, source: 'test' }); // A second cooldown-spaced proc must stack instead of replacing the first.
assert.equal(secondExpose.stacks, 2);
assert.equal(RS.applyDamage(exposedTarget, 10, {}), 13, 'two 2× Exposed stacks add to +30% direct damage rather than multiplying into compounding percentages');
for (let i = 0; i < 5; i++) RS.applyTimedDebuff(exposedTarget, 'exposed', 12, { power: 2, source: 'test' });
assert.equal(RS.getTimedDebuffs(exposedTarget)[0].stacks, 5, 'same-name debuffs cap at five stacks');
testNowMs += 12001;
assert.equal(RS.applyDamage(exposedTarget, 10, {}), 10, 'the refreshed timed stack expires on the combat clock');

const modifierTarget = makeEntity({ health: 50, stamina: 100, footing: 100 }); // Exercises every non-regeneration percentage hook without needing game.js.
RS.applyTimedDebuff(modifierTarget, 'reeling', 12, { power: 2 });
RS.applyTimedDebuff(modifierTarget, 'heavy', 12, { power: 2 });
RS.applyTimedDebuff(modifierTarget, 'sluggish', 12, { power: 2 });
RS.applyTimedDebuff(modifierTarget, 'brittle', 12, { power: 2 });
RS.applyTimedDebuff(modifierTarget, 'taxed', 12, { power: 2 });
RS.applyTimedDebuff(modifierTarget, 'enfeebled', 12, { power: 2 });
RS.applyTimedDebuff(modifierTarget, 'inhibited', 12, { power: 2 });
assert.ok(Math.abs(RS.timedDebuffModifier(modifierTarget, 'knockbackTaken') - 1.3) < 1e-9, 'Reeling is +30% knockback at default Quick-bonus power');
assert.ok(Math.abs(RS.timedDebuffModifier(modifierTarget, 'moveSpeed') - 0.85) < 1e-9, 'Heavy is -15% movement per default-power stack');
assert.ok(Math.abs(RS.timedDebuffModifier(modifierTarget, 'dodgeLungeDistance') - 0.85) < 1e-9, 'Heavy unifies movement and dodge/lunge distance');
assert.ok(Math.abs(RS.getExhaustionSpeed(modifierTarget) - 0.85) < 1e-9, 'Sluggish reduces central attack timing');
assert.ok(Math.abs(RS.timedDebuffModifier(modifierTarget, 'outgoingDamage') - 0.85) < 1e-9, 'Enfeebled exposes a source-side direct-damage multiplier');
RS.spendFooting(modifierTarget, 10, 'test');
assert.equal(modifierTarget.footing, 88, 'Brittle increases 10 Footing damage to 12 at default Quick-bonus power');
RS.spendStamina(modifierTarget, 20, 'test');
assert.equal(modifierTarget.stamina, 77, 'Taxed increases a 20 Stamina action cost to 23 at default Quick-bonus power');
RS.applyHealthRecovery(modifierTarget, 10);
assert.equal(modifierTarget.health, 58, 'Inhibited reduces 10 Health recovery to 8 at default Quick-bonus power');

const normalRecovery = makeEntity({ stamina: 0, footing: 0 });
const slowedRecovery = makeEntity({ stamina: 0, footing: 0 });
RS.applyTimedDebuff(slowedRecovery, 'sapped', 12, { power: 2 });
RS.applyTimedDebuff(slowedRecovery, 'unsteady', 12, { power: 2 });
RS.tick(normalRecovery, 0.25);
RS.tick(slowedRecovery, 0.25);
assert.ok(slowedRecovery.stamina < normalRecovery.stamina, 'Sapped reduces central Stamina recovery');
assert.ok(slowedRecovery.footing < normalRecovery.footing, 'Unsteady reduces central Footing recovery');

const bleedTarget = makeEntity({ health: 100 }); // Bleedout must consume existing buildup and never fabricate the missing remainder.
RS.addAffliction(bleedTarget, 'bleedingHealth', 20);
const bleedout = RS.bleedOut(bleedTarget, 12, { source: 'test' });
assert.equal(bleedout.consumed, 12);
assert.equal(bleedout.damage, 12);
assert.equal(RS.getAffliction(bleedTarget, 'bleedingHealth'), 8);
assert.equal(bleedTarget.health, 88);
const shortBleedout = RS.bleedOut(bleedTarget, 20, { source: 'test' });
assert.equal(shortBleedout.consumed, 8, 'Bleedout clamps to the Bleeding Health actually available');
assert.equal(RS.getAffliction(bleedTarget, 'bleedingHealth'), 0);

// ── 15: Moralized / Resolute 3:1 ──────────────────────────────────
reset();
const p2 = makeEntity();
RS.addEnhancedResource(p2, 'moralizedStamina', 4);
const pay = RS.spendStamina(p2, 12, 'test');
assert.equal(RS.getAffliction(p2, 'moralizedStamina'), 0, '15. 4 Moralized consumed');
assert.equal(pay.enhancedPaid, 12);
assert.equal(p2.stamina, 100, '15. 4 Moralized paid all 12 Stamina');
RS.addEnhancedResource(p2, 'resoluteFooting', 2);
RS.spendFooting(p2, 9, 'hit');
assert.equal(p2.footing, 97, '15. 2 Resolute Footing absorb 6 of 9 Footing loss');
RS.addEnhancedResource(p2, 'resoluteHealth', 5);
RS.applyDamage(p2, 15, {});
assert.equal(p2.health, 100, '15. 5 Resolute Health absorb 15 Health loss');

// ── 14: Furious Stamina tempo only for the funded portion ─────────
const p3 = makeEntity();
RS.addEnhancedResource(p3, 'furiousStamina', 6);
RS.addEnhancedResource(p3, 'moralizedStamina', 10);
const charge = RS.spendStamina(p3, 12, 'charge', { actionKind: 'offensiveHeldCharge' });
assert.equal(charge.consumed[0].id, 'furiousStamina', 'Furious outranks Moralized only for an action it benefits (priority mechanism, not a one-off check)');
assert.ok(Math.abs(charge.tempoMultiplier - (6 * 3 + 6 * 1) / 12) < 1e-9, '14. only the 6 Furious-funded points run at 3×');
const walk = makeEntity();
RS.addEnhancedResource(walk, 'furiousStamina', 6);
RS.addEnhancedResource(walk, 'moralizedStamina', 10);
const ordinary = RS.spendStamina(walk, 12, 'dodge');
assert.equal(ordinary.consumed[0].id, 'moralizedStamina', 'Moralized is used first for ordinary costs');
assert.equal(ordinary.tempoMultiplier, 1, '14. no acceleration outside offensive held actions');

// ── 16: Mirrored uses actual damage ───────────────────────────────
reset();
ES.addBase('sword', 'mirrored');
const mirrorBefore = RS.getAffliction(player, 'mirroredHealth');
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', damage: 50 }), { target: enemy, actualDamage: 0 });
assert.equal(RS.getAffliction(player, 'mirroredHealth'), mirrorBefore, '16. zero actual damage grants nothing');
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', damage: 50 }), { target: enemy, actualDamage: 7 });
assert.ok(Math.abs(RS.getAffliction(player, 'mirroredHealth') - mirrorBefore - 7 * ES.getEnchantmentPowerMultiplier('sword')) < 0.11, '16. Mirrored equals post-mitigation damage (× enchantment power)');

// ── 17: Kindling conversion ───────────────────────────────────────
const k = makeEntity();
RS.addAffliction(k, 'kindlingHealth', 6);
RS.addAffliction(k, 'burningHealth', 1);
assert.equal(RS.getAffliction(k, 'kindlingHealth'), 0, '17. ordinary Burning converts Kindling with 100% probability');
assert.equal(RS.getAffliction(k, 'burningHealth'), 7, '17. Kindling becomes equivalent Burning');
const k2 = makeEntity();
RS.addAffliction(k2, 'kindlingHealth', 4);
randomQueue = [0.05];
RS.addAffliction(k2, 'kindlingHealth', 2);
assert.equal(RS.getAffliction(k2, 'burningHealth'), 6, 'spontaneous Kindling ignition converts the whole stack');

// ── 18: Living Flame roll transfer (3× actually cured, no proc loop) ─
reset();
ES.addBase('sword', 'livingFlame');
const near = makeEntity({ name: 'Near', x: 50, y: 0 });
const far = makeEntity({ name: 'Far', x: 900, y: 0 });
hostileObjects.length = 0;
hostileObjects.push(near, far);
let hitEvents = 0;
const off = CAE.on('hit', () => { hitEvents++; });
context.dispatchEvent(new context.CustomEvent('hobunji-burning-roll-cured', { detail: { entity: player, removed: 4 } }));
off();
const expected = 4 * 3 * ES.getEnchantmentPowerMultiplier('sword');
assert.ok(Math.abs(RS.getAffliction(near, 'burningHealth') - expected) < 0.11, '18. 3× the Burning actually cured, to enemies in radius');
assert.equal(RS.getAffliction(far, 'burningHealth'), 0, '18. enemies outside the radius receive nothing');
assert.equal(hitEvents, 0, '18. the transfer is not an attack event (no recursive procs)');

// ── 19-20: Living Gust ────────────────────────────────────────────
reset();
ES.addBase('sword', 'livingGust');
hostileObjects.length = 0;
const center = makeEntity({ name: 'Center', x: 60, y: 0 });
const periph = makeEntity({ name: 'Periph', x: 60 * Math.cos(0.5), y: 60 * Math.sin(0.5) }); // 0.5 rad: outside 0.4 half-cone, inside 0.6
const outside = makeEntity({ name: 'Outside', x: 60 * Math.cos(1.2), y: 60 * Math.sin(1.2) });
hostileObjects.push(center, periph, outside);
knockbacks.length = 0;
const gustCtx = CAE.prepare({ abilityId: 'swingCombo', rangePx: 100, halfConeRad: 0.4, knockbackPxS: 200, metadata: { attackAngle: 0 } });
const hitSet = new Set([center]);
const affected = ES.applyPeripheralGust(gustCtx, hitSet);
assert.equal(affected, 1, '19. only the peripheral target gets the gust');
assert.equal(knockbacks[0].target, periph);
const gustPower = ES.getEnchantmentPowerMultiplier('sword'); // Living Gust alone: Ohthic 1 → Immundanity 1 → ×1.1.
assert.ok(Math.abs(knockbacks[0].speed - 200 * (1 + 0.25 * gustPower) * 0.5) < 1e-9, '19. peripheral target gets half of the (power-scaled) +25% knockback');
assert.equal(periph.health, 100, '19. no damage outside the real hit cone');
assert.ok(gustCtx.modifiers.lunge > 1.24, '21. lunge goes through the attack context modifier (+25%)');
assert.equal(gustCtx.causedAttackerProne, false, '20. no ×3 while Footing stays above zero');
assert.equal(gustCtx.modifiers.damage, 1);
player.footing = 5; player.prone = false;
const proneCtx = CAE.prepare({ abilityId: 'swingCombo' });
assert.equal(proneCtx.causedAttackerProne, true, '20. its own Footing cost toppled the wielder');
assert.equal(proneCtx.modifiers.damage, 3, '20. ×3 offensive payload');
assert.equal(proneCtx.modifiers.affliction, 3);
assert.match(log(), /Living Gust prone bonus ×3/);
player.footing = 0; player.prone = true;
const alreadyProne = CAE.prepare({ abilityId: 'swingCombo' });
assert.equal(alreadyProne.causedAttackerProne, false, '20. being prone already is not enough');
assert.equal(alreadyProne.modifiers.damage, 1);
player.footing = 100; player.prone = false;

// ── 13 + 25: Sicced targeting and Engraved Whistle stacking ───────
reset();
ES.setFlourish('sword', 'tap1', 'sicced');
const companion = makeEntity({ isCompanion: true, master: player, stableRole: 'companion' });
companionObjects.push(companion);
const a = makeEntity({ name: 'A', health: 80 });
const b = makeEntity({ name: 'B', health: 30 });
const c = makeEntity({ name: 'C', health: 50 });
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', comboFinisher: true }), { target: a, actualDamage: 1 });
assert.equal(ES.getCurrentSiccedTarget(), a, '13. Sicced target is exclusive');
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', comboFinisher: true }), { target: b, actualDamage: 1 });
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', comboFinisher: true }), { target: c, actualDamage: 1 });
assert.equal(ES.getCurrentSiccedTarget(), c, '13. newest Sicced target takes over immediately');
c.health = 0;
assert.equal(ES.getCurrentSiccedTarget(), b, '13. fallback picks the living Sicced enemy with the lowest Health');
assert.match(log(), /Companion retargeted Sicced enemy: B/);
b.health = 0; a.health = 0;
assert.equal(ES.getCurrentSiccedTarget(), null, '13. normal AI resumes with no living Sicced enemy');
a.health = 80;
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', comboFinisher: true }), { target: a, actualDamage: 1 });
const siccedOnly = CO.getModifiers(companion, a);
assert.ok(siccedOnly.damage > 1 && siccedOnly.footing === siccedOnly.damage && siccedOnly.affliction === siccedOnly.damage, 'Sicced scales the complete offensive output');
const uid = TS.grant('engravedWhistle');
assert.equal(TS.equip(uid).ok, true);
const both = CO.getModifiers(companion, a);
assert.ok(Math.abs(both.damage - siccedOnly.damage * 1.3) < 1e-9, '25. Whistle × Sicced damage stack multiplicatively');
assert.ok(Math.abs(both.affliction - siccedOnly.affliction * 1.4) < 1e-9, '25. Whistle × Sicced affliction stack');
const unmarked = CO.getModifiers(companion, makeEntity());
assert.equal(unmarked.damage, 1.3, '25. Whistle alone off the Sicced target');
const scaled = CO.scaleHit(companion, a, 10, { afflictionBonuses: { bleedingHealth: 1 } });
assert.ok(Math.abs(scaled.amount - 10 * both.damage) < 1e-9);
assert.ok(Math.abs(scaled.opts.afflictionBonuses.bleedingHealth - both.affliction) < 1e-9, '25. affliction buildup scaled through the shared hit path');
assert.equal(CO.getModifiers(makeEntity({ isCompanion: false }), a).damage, 1, 'wild attackers are never empowered');

// ── 22-24: Attunement ─────────────────────────────────────────────
reset();
const ids = ['harlyaoReachShard', 'harlyaoStridingBone'];
const ones = [];
for (let i = 0; i < 8; i++) ones.push(TS.grant(ids[i % 2]));
for (const u of ones) assert.equal(TS.equip(u).ok, true);
assert.equal(TS.usedAttunement(), 8, '22. eight 1-point trinkets are legal');
const extra = TS.grant('harlyaoReachShard');
const rejected = TS.equip(extra);
assert.equal(rejected.ok, false);
assert.equal(rejected.reason, 'insufficient-attunement');
assert.equal(TS.equippedEntries().length, 8, '23. rejection unequips nothing');
reset();
const n1 = TS.grant('iconNaoung'), n2 = TS.grant('iconNarShangBo'), n3 = TS.grant('iconKruurenShai');
assert.equal(TS.equip(n1).ok, true);
assert.equal(TS.equip(n2).ok, true);
assert.equal(TS.equip(n3).ok, false, 'three Icons (9) exceed the 8 budget');
same(TS.equippedEntries().map(e => e.id), ['iconNaoung', 'iconNarShangBo']);
reset();
const crown = TS.grant('harlyaoWarCrown'), bead = TS.grant('harlyaoTirelessBead'), knuckle = TS.grant('harlyaoTopplingKnuckle');
assert.equal(TS.equip(crown).ok, true);
assert.equal(TS.equip(bead).ok, true, '5 + 3 = 8 is legal');
assert.equal(TS.equip(knuckle).ok, false, '5 + 3 + 2 rejected');
reset();
const crown2 = TS.grant('harlyaoWarCrown'), bead2 = TS.grant('harlyaoTirelessBead'), bone = TS.grant('harlyaoStridingBone');
assert.equal(TS.equip(crown2).ok, true);
assert.equal(TS.equip(bone).ok, true);
assert.equal(TS.equip(bead2).ok, false, '5 + 4 (War Crown + Striding Bone + Tireless Bead = 9) is rejected');
assert.equal(TS.usedAttunement(), 6);

// 24. Town Icons modify their intended stats through ResourceSystem.
reset();
const naoung = TS.grant('iconNaoung');
const baseMaxHealth = RS.getEffectiveMax(player, 'health');
TS.equip(naoung);
assert.ok(Math.abs(RS.getEffectiveMax(player, 'health') - baseMaxHealth * 1.25) < 1e-9, '24. Nao\'ung raises Max Health');
assert.equal(RS.statModifier(player, 'healthRegenInCombat'), 2.5, '24. Nao\'ung boosts in-combat Health regen');
assert.equal(RS.statModifier(player, 'staminaRegen'), 1, 'no stray Stamina effect');
assert.equal(RS.statModifier(enemy, 'maxHealth'), 1, 'trinkets affect only the wearer');
// In-combat (not rested) vs rested regen with the Icon.
player.health = 50; player.lastAttackAttemptAt = testNowMs; // just fought → not rested
RS.tick(player, 1, { healthRegenPerSec: 1 });
const inCombatGain = player.health - 50;
assert.ok(Math.abs(inCombatGain - 2.5) < 0.11, '24. in-combat regen uses the in-combat bonus');
TS.unequip(naoung);
const nar = TS.grant('iconNarShangBo'), kru = TS.grant('iconKruurenShai');
TS.equip(nar); TS.equip(kru);
assert.equal(RS.statModifier(player, 'maxStamina'), 1.25);
assert.equal(RS.statModifier(player, 'staminaRegen'), 1.35);
assert.equal(RS.statModifier(player, 'maxFooting'), 1.3);
assert.equal(RS.statModifier(player, 'footingRegen'), 1.5);

// Harlyao trinkets reuse the Combat perk vocabulary (bonus ranks).
reset();
const lungeBefore = context.CombatProgression.getEffects('sword', 'swingCombo').stats.lungeMul;
TS.equip(TS.grant('harlyaoStridingBone'));
assert.equal(PerkSystem.rank('combat', 'increaseLungeDistance'), 2, 'bonus ranks show through rank()');
assert.equal(PerkSystem.purchasedRank('combat', 'increaseLungeDistance'), 0, 'bonus ranks are not spent points');
assert.ok(Math.abs(context.CombatProgression.getEffects('sword', 'swingCombo').stats.lungeMul - lungeBefore - 0.24) < 1e-9, 'Striding Bone reaches ability lunge through the perk path');
const lootBundle = { gold: 5, trinket_harlyaoQuickFang: 1 };
const parts = TS.claimLoot(lootBundle, 'harlyaoRuin');
same(Object.keys(lootBundle), ['gold'], 'trinket loot never reaches the inventory grant');
assert.equal(parts.length, 1);
assert.ok(TS.ownedEntries().some(e => e.id === 'harlyaoQuickFang'));

// ── 26-27: Save round-trip and old saves ──────────────────────────
reset();
ES.addBase('sword', 'burning');
ES.setFlourish('sword', 'hold2', 'resolve');
const saveUid = TS.grant('iconNaoung');
TS.equip(saveUid);
const saved = JSON.parse(JSON.stringify(gear)); // gearInventory is what saveGearInventory writes.
gear = saved;
same([...ES.stateFor('sword').base], ['burning'], '26. Base enchantments survive reload');
assert.equal(ES.flourishForSlot('hold2', 'sword'), 'resolve', '26. Flourishes survive reload');
assert.equal(TS.isEquipped(saveUid), true, '26. equipped trinkets survive reload');
assert.equal(TS.usedAttunement(), 3);
const oldSave = { tools: { hatchet_nativeCopper: true }, charms: [] };
gear = oldSave;
assert.equal(ES.getWeaponImmundanity('hatchet_nativeCopper'), 0, '27. old saves: no enchantments');
same(TS.equippedEntries(), [], '27. old saves: no trinkets');
assert.equal(TS.capacity(), 8, '27. default Attunement capacity 8');
assert.equal(oldSave.tools.hatchet_nativeCopper, true, '27. nothing removed');
// Over-budget save: preserved, but equipping more is blocked.
const overA = { uid: 'a', id: 'harlyaoWarCrown' }, overB = { uid: 'b', id: 'harlyaoBloodPact' }, overC = { uid: 'c', id: 'harlyaoReachShard' };
gear = { trinkets: [overA, overB, overC], equippedTrinkets: ['a', 'b'] };
assert.equal(TS.usedAttunement(), 8);
gear.trinkets.push({ uid: 'd', id: 'harlyaoHexSigil' });
gear.equippedTrinkets.push('d');
assert.equal(TS.usedAttunement(), 11, 'over-budget loadout is preserved');
assert.equal(TS.equip('c').ok, false, 'no further equips while over budget');
assert.equal(gear.equippedTrinkets.length, 3, 'nothing was silently unequipped');

// ── Harlyao relics + Garanki ─────────────────────────────────────
reset();
const TOOL_ITEM_DEFS = { sword: { label: 'Sword', slots: ['weapon'] } };
const ITEM_DEFS = {};
const inventory = { gold: 10000 };
const texturesRequested = [];
HR.init({
  TOOL_ITEM_DEFS, ITEM_DEFS, inventoryItems: [], inventory,
  getGearInventory: () => gear, saveGearInventory: () => {}, saveMemberWorldData: () => {},
  ensureToolTexture: key => texturesRequested.push(key), showToast: () => {},
});
gear.tools = { sword: true };
const relic = { shape: 'longsword', uid: 'abc123', enchantments: { base: ['burning', 'livingGust'], flourishes: { tap1: 'sicced', hold2: 'fury' } } };
const boundKey = HR.grantBoundRelic(relic);
assert.equal(inventory[boundKey], 1, 'bound relic lands in the world-scoped inventory');
same(HR.decodeBoundKey(boundKey).enchantments, { base: ['burning', 'livingGust'], flourishes: { tap1: 'sicced', hold2: 'fury' } }, 'the key round-trips every enchantment');
delete ITEM_DEFS[boundKey];
HR.ensureInventoryItemDefs(inventory);
assert.ok(ITEM_DEFS[boundKey]?.harlyaoBoundRelic, 'bound relic item def rebuilds from its key after reload');
assert.equal(ES.isBaseUnlocked('burning'), false, 'nothing learned before unbinding');
const price = HR.unbindPrice(relic.enchantments);
assert.equal(price, HR.TUNING.UNBIND_BASE_PRICE + 4 * HR.TUNING.UNBIND_PRICE_PER_ENCHANTMENT);
const res = HR.unbind(boundKey);
assert.equal(res.ok, true);
assert.equal(inventory[boundKey], undefined, 'bound stack consumed');
assert.equal(inventory.gold, 10000 - price, 'Garanki charged his fee');
assert.equal(gear.tools[res.toolKey], true, 'unbound relic is now a gear weapon');
assert.ok(TOOL_ITEM_DEFS[res.toolKey]?.slots.includes('weapon'));
assert.ok(texturesRequested.includes(res.toolKey), 'relic weapon textures load through the shared tool path');
same([...ES.stateFor(res.toolKey).base], ['burning', 'livingGust'], 'relic keeps its enchantments');
assert.equal(ES.flourishForSlot('tap1', res.toolKey), 'sicced');
assert.equal(ES.isBaseUnlocked('burning'), true);
assert.equal(ES.isFlourishUnlocked('sicced', 'tap1'), true, 'Flourish learned for its own slot');
assert.equal(ES.isFlourishUnlocked('sicced', 'tap2'), false, 'slot permutations unlock separately');
// Applying learned enchantments to another weapon.
const gold0 = inventory.gold;
assert.equal(HR.applyBase('sword', 0, 'burning').ok, true);
assert.equal(inventory.gold, gold0 - HR.TUNING.APPLY_BASE_PRICE);
assert.equal(HR.applyBase('sword', 1, 'mirrored').ok, false, 'unlearned Base cannot be applied');
assert.equal(HR.applyFlourish('sword', 'tap2', 'sicced').ok, false, 'unlearned slot permutation cannot be applied');
assert.equal(HR.applyFlourish('sword', 'tap1', 'sicced').ok, true);
assert.equal(ES.flourishForSlot('tap1', 'sword'), 'sicced');
// Reload: relic tool re-registers from gear.
const reloaded = JSON.parse(JSON.stringify(gear));
delete TOOL_ITEM_DEFS[res.toolKey];
gear = reloaded;
assert.equal(HR.restore(), 1);
assert.ok(TOOL_ITEM_DEFS[res.toolKey], 'unbound relic weapon survives reload');
// Rolled relics are never empty.
for (let i = 0; i < 40; i++) {
  randomQueue = [0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.2, 0.1, 0.4];
  const rolled = HR.rollEnchantments();
  assert.ok(rolled.base.length + Object.keys(rolled.flourishes).length >= 1, 'a relic always teaches something');
}

console.log('enchantments / immundanity / enhanced resources / attunement / Harlyao relics checks passed');

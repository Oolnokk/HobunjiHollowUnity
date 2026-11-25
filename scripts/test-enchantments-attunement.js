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
const companionPanels = new Map(); // Captures the real feature registrations for companion-action regression coverage.
const context = {
  console,
  DevCompanion: { registerCheatPanel: panel => companionPanels.set(panel.id, panel) },
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
load('docs/js/combat/fey-illusions.js'); // Tests the real sensory effects through ResourceSystem.
load('docs/js/combat/fey-hyped-attacks.js'); // Tests the staged second attack rather than a cosmetic delayed impact.
context.__hobunjiPlayerProfile = { abilityProgression: { plain: { chargedBreaker: { 1: 0 } }, magic: { chargedBreaker: { 1: 0 } } } }; // CombatProgression loads its saved choices from the profile at startup.
load('docs/js/combat/combat-progression.js');
delete context.__hobunjiPlayerProfile;
load('docs/js/trinket-system.js');
load('docs/js/artifact-collection.js');
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
assert.equal(ES.setFlourish('sword', 'hold1', 'fury'), false);
assert.equal(ES.setFlourish('sword', 'tap2', 'fury'), true);
assert.equal(ES.setFlourish('sword', 'tap1', 'burning'), false, 'Base enchantments cannot be Flourishes');
assert.equal(ES.flourishForSlot('tap1', 'sword'), 'sicced');
assert.equal(ES.flourishForSlot('tap2', 'sword'), 'fury', '3. each slot holds its own Flourish');
assert.equal(ES.flourishForSlot('hold1', 'sword'), null);
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
assert.equal(immFor({ base: ['frostbitten'], flourishes: { tap1: 'sicced', tap2: 'fury' } }), 1, 'Tothal 2, Hronal 1 → 1');
assert.equal(immFor({ base: ['frostbitten', 'burning'], flourishes: { tap1: 'sicced', tap2: 'fury' } }), 0, '11. Tothal 2, Hronal 2 → 0 (one-for-one, not Cartesian)');
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

// ── 14: Furious Stamina snapshots the amount before payment ────────
const p3 = makeEntity();
RS.addEnhancedResource(p3, 'furiousStamina', 6);
RS.addEnhancedResource(p3, 'moralizedStamina', 10);
const charge = RS.spendStamina(p3, 12, 'charge', { actionKind: 'offensiveHeldCharge' });
assert.equal(charge.consumed[0].id, 'furiousStamina', 'Furious outranks Moralized only for an action it benefits (priority mechanism, not a one-off check)');
assert.ok(Math.abs(charge.tempoMultiplier - 1.12) < 1e-9, '14. pre-payment 6 Furious points give +12% tempo');
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
assert.ok(Math.abs(scaled.opts.afflictionBonuses.bleedingHealth - both.affliction) < 1e-9, '25. independent Attack Power uses the full stacked affliction multiplier');
assert.ok(siccedOnly.knockback > 1, 'Sicced also empowers the defensive Guard Charge impulse');
assert.equal(CO.getModifiers(makeEntity({ isCompanion: false }), a).damage, 1, 'wild attackers are never empowered');
a.areaId = 'forest';
b.health = 30; b.areaId = 'mine';
CAE.hit(CAE.prepare({ abilityId: 'swingCombo', comboFinisher: true }), { target: b, actualDamage: 1 });
assert.equal(ES.getCurrentSiccedTarget('forest'), a, 'newest mark elsewhere cannot hide a local mark');
assert.equal(ES.getCurrentSiccedTarget('mine'), b, 'local mark is still available in its own area');
b._denHidden = true;
assert.equal(ES.getCurrentSiccedTarget('mine'), null, 'hidden mark cannot hijack targeting');
a._downed = true;
assert.equal(ES.getCurrentSiccedTarget('forest'), null, 'downed mark cannot hijack targeting');
assert.equal(ES.getCompanionTargetPowerMultiplier(companion, a), 1, 'invalid mark cannot empower an attack');

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
context.CharacterMetaSave = { update(mutate) {
  try { mutate({ id: 'test-character' }, { characters: [{ id: 'test-character' }] }); return true; }
  catch { return false; }
} }; // The game adapter saves character gear and world-member inventory in one update.
load('docs/js/gear-member-transaction.js');
context.GearMemberTransaction.init({
  inventory, getGearInventory: () => gear, captureMemberWorldData: meta => meta,
  buildInventoryGrid() {}, buildEquipmentSlots() {}, showToast() {},
});
const texturesRequested = [];
HR.init({
  TOOL_ITEM_DEFS, ITEM_DEFS, inventoryItems: [], inventory,
  getGearInventory: () => gear, saveGearInventory: () => {}, saveMemberWorldData: () => {},
  ensureToolTexture: key => texturesRequested.push(key), showToast: () => {},
});
let collectionSave = null; // Real collection progression supplies service gates for the relic/enchantment behavior tests below.
context.WorldMetaStore = { loadArtifactCollection: () => collectionSave, saveArtifactCollection: (_id, value) => { collectionSave = value; return true; } };
context.ArtifactCollection.init({ ITEM_DEFS, inventoryItems: [], inventory, tothalWorldId: () => 'test-world' });
assert.equal(HR.unbind('missing').reason, 'collection', 'unbinding starts locked');
for (const key of Object.keys(context.ArtifactCollection.ARTIFACTS).slice(0, 6)) { inventory[key] = 1; assert.equal(context.ArtifactCollection.donate(key).ok, true); }
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
load('docs/js/tool-mastery.js');
context.ToolMastery.init({ getGearInventory: () => gear, TOOL_ITEM_DEFS });
const relicToolKey = 'harlyaoRelic_longsword_abc123'; // Used to seed former-owner affinity before the actual unbinding action.
gear.toolMastery = { [relicToolKey]: { xp: 300 }, sword: { xp: 150 } };
gear.toolPlating = { [relicToolKey]: { mode: 'pattern', pattern: {} } };
const res = HR.unbind(boundKey);
assert.equal(res.ok, true);
assert.equal(res.toolKey, relicToolKey);
assert.equal(context.ToolMastery.toolMasteryLevel(res.toolKey), 0, 'unbinding resets former-owner mastery');
assert.equal(gear.toolMastery.sword.xp, 150, 'unbinding preserves other weapon mastery');
assert.equal(gear.toolPlating[res.toolKey], undefined, 'unbinding clears stale verdigris patterns');
assert.equal(TOOL_ITEM_DEFS[res.toolKey].metalKey, 'tinBronze', 'unbound relics use the normal mastery-driven bronze recolor pipeline');
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


// Companion grants/editors run the same authoritative mutation and save paths.
reset();
const enchanting = companionPanels.get('enchantment-editing'); // Registered by the real enchantment module.
assert.equal(enchanting.onAction('base', { key: 'sword', index: 0, value: 'burning' }).ok, true);
assert.equal(ES.stateFor('sword').base[0], 'burning');
assert.equal(enchanting.onAction('base', { key: 'sword', index: 5, value: 'burning' }).ok, false);
assert.equal(enchanting.onAction('base', { key: 'sword', index: 0, value: 'invalid' }).ok, false);
weapon = 'axe';
assert.equal(enchanting.onAction('base', { key: 'sword', index: 0, value: '' }).ok, false, 'stale weapon selectors cannot edit a previous weapon');
assert.equal(ES.stateFor('sword').base[0], 'burning');
const trinkets = companionPanels.get('trinket-grants'); // Registered by the real trinket module.
const choice = trinkets.render().actions[0].options.find(option => option.value); // Uses authored dropdown options rather than a copied definition.
assert.equal(trinkets.onAction('grant', { value: choice.value }).ok, true);
assert.equal(TS.ownedEntries().length, 1);
assert.equal(trinkets.onAction('grant', { value: 'invalid' }).ok, false);
assert.equal(companionPanels.get('relic-grants').onAction('grant').ok, true);


// ── Fey illusions: real exertion responses, resource reservations,
// enhanced second strikes, seeded turns, save migration and neutral origin. ──
{
  reset();weapon='fey-testing-blade';
  const fey=context.FeyIllusions;
  assert(fey?.EFFECTS.feyDementedStamina&&fey?.EFFECTS.feyHypedPulse);
  assert.equal(fey.debugSnapshot().registered,false,'Fey defers HUD registration until shared owner is ready');
  let feyBuffProvider=null;
  context.EffectBuffBar={registerProvider(id,callback){assert.equal(id,'fey-illusions');feyBuffProvider=callback;return true;},refresh(){}};
  assert.equal(fey.ensureBuffProvider(),true);
  assert.equal(fey.ensureBuffProvider(),true,'HUD registration stays idempotent');
  assert.equal(typeof feyBuffProvider,'function');
  const feyIds=Object.keys(ES.DEFINITIONS).filter(id=>ES.DEFINITIONS[id].alignment==='Fey');
  same(feyIds.sort(),['feyDementedStamina','feyPanickedStamina','feyTurnabout','feyHypedPulse','feyDreadPulse'].sort());
  assert.equal(ES.getWeaponImmundanity('fey-testing-blade'),0);
  for(const id of ['feyDementedStamina','feyPanickedStamina'])assert.equal(ES.addBase('fey-testing-blade',id),true);
  assert.equal(ES.setFlourish('fey-testing-blade','tap1','feyDreadPulse'),true);
  assert.equal(ES.getWeaponImmundanity('fey-testing-blade'),0);
  const migrated=ES.cleanWeaponState({base:['feyPhantomWound','burning'],flourishes:{tap1:'feyMazeStep'}});
  same(migrated.base,['feyDementedStamina','burning'],'old Fey Base remaps on load');
  assert.equal(migrated.flourishes.tap1,'feyHypedPulse','old Fey Flourish remaps on load');
  gear.weaponEnchantments['fey-mixed']=migrated;
  assert.equal(ES.getWeaponImmundanity('fey-mixed'),1,'ordinary Hronal still counts');
  assert.equal(fey.potency('fey-mixed'),1,'Fey ignores positive Immundanity');

  const victim=makeEntity({name:'Illusion-only target',health:75,footing:64,stamina:83,angle:0,facing:0});
  assert.equal(fey.apply('feyDementedStamina',victim,{weaponKey:'fey-testing-blade'}),true);
  assert.equal(fey.apply('feyPanickedStamina',victim,{weaponKey:'fey-testing-blade'}),true);
  assert.equal(RS.getAffliction(victim,'dementedStamina'),9);
  assert.equal(RS.getAffliction(victim,'panickedStamina'),9);
  assert.equal(victim.health,75,'an illusory sensation is not actual injury');
  assert.equal(victim.footing,64,'an illusory sensation does not instantly damage footing');
  randomQueue=[0.99]; // Chooses positive signed drift once per actual payment.
  RS.spendStamina(victim,10,'ordinary exertion',{durationS:.22});
  assert.equal(RS.getAffliction(victim,'panickedStamina'),9,'other stamina goes first');
  fey.update(.11,victim);
  assert(victim.angle>0 && victim.angle<10*Math.PI/180,'direction interpolates across action');
  fey.update(.11,victim);
  assert(Math.abs(victim.angle-10*Math.PI/180)<.00001,'10 stamina causes exactly 10° of rotation');
  RS.spendStamina(victim,4,'ordinary exertion');
  assert.equal(RS.getAffliction(victim,'panickedStamina'),9,'ordinary exertion does not immediately spend panic reserve');
  victim.dodging=true;victim.dodgeT=.2;
  const payment=RS.spendStamina(victim,3,'roll dodge',{actionKind:'combatDodge'});
  assert.equal(payment.panicSpent,9,'dodge burns full panic reserve as a surcharge');
  assert.equal(RS.getAffliction(victim,'panickedStamina'),0,'no double spending of panic');
  fey.update(.016,victim);
  assert(victim.dodgeT>.35,'panic adds 10% roll duration per panic point');
  victim.isCompanion=true;victim.master=player; // Models a real player-side actor rather than assuming an unaffiliated enemy can friendly-fire the player's pets.
  const ally=makeEntity({name:'Roll-path companion',x:32,y:0,footing:100,isCompanion:true,master:player}); // Existing companion roster resolves panic collisions by swept path.
  companionObjects.push(ally);
  victim.x=64;fey.update(.016,victim);
  assert(ally.footing<100,'panic roll damages an intersected ally’s Footing');
  assert(knockbacks.some(k=>k.target===ally&&k.meta?.source==='fey-panicked-roll'),'panic roll uses the shared ally knockback seam');
  companionObjects.pop();
  const wallImpacts=[];
  context.KnockbackCollisionImpact={resolveStrength:(actor,desc,strength)=>{wallImpacts.push({actor,desc,strength});}};
  assert.equal(fey.onDodgeBlocked(victim),true,'blocked panic rolls resolve through knockback collision owner');
  assert.equal(fey.onDodgeBlocked(victim),false,'one blocked dodge gets only one wall impact');
  assert.equal(wallImpacts.length,1);
  assert.equal(wallImpacts[0].strength,.9,'wall impact strength is proportional to Panicked Stamina');
  victim.dodging=false;fey.update(.016,victim);
  randomQueue=[0];
  assert.equal(fey.apply('feyTurnabout',victim,{weaponKey:'fey-testing-blade'}),true);
  assert(Math.abs(Math.abs(victim.facing-victim.angle))<.000001,'turn proc changes both facing sources');
  randomQueue=[.99];
  assert.equal(fey.apply('feyTurnabout',victim,{weaponKey:'fey-testing-blade'}),false,'90% proc miss does nothing');
  const originalES=context.EnchantmentSystem;
  context.EnchantmentSystem={...originalES,getEnchantmentPowerMultiplier:()=>0};
  assert.equal(fey.apply('feyDementedStamina',victim,{weaponKey:'fey-testing-blade'}),false,'explicit 0% gate suppresses Fey');
  context.EnchantmentSystem=originalES;

  // Verify actual hit event uses the two on-hit afflictions and the new Panic Surge.
  const feyImpactTarget=makeEntity({name:'Fey combat-event target',health:77,footing:55});
  const feyImpact=CAE.prepare({attacker:player,abilityId:'swingCombo',comboStep:3,comboFinisher:true});
  CAE.hit(feyImpact,{target:feyImpactTarget,actualDamage:0});
  assert(RS.getAffliction(feyImpactTarget,'dementedStamina')>0,'Base applies Demented on real hits');
  assert(RS.getAffliction(feyImpactTarget,'panickedStamina')>9,'Flourish adds panic beyond Base');
  assert.equal(feyImpactTarget.health,77,'Fey magical component cannot directly injure');
  assert.equal(feyImpactTarget.footing,55,'Fey magical component cannot directly remove footing');

  // Hyped pays through central stamina owner, then arms one scaled echo impact.
  assert.equal(fey.apply('feyHypedPulse',player,{weaponKey:'fey-testing-blade',attacker:player}),true);
  const hypedPayment=RS.spendStamina(player,8,'combo attack',{actionKind:'combatCombo'});
  assert(hypedPayment.consumed.some(x=>x.id==='hypedStamina'&&x.rawConsumed===8));
  const echo=CAE.prepare({attacker:player,abilityId:'swingCombo',damage:25,rangePx:40,halfConeRad:1,knockbackPxS:100});
  assert.equal(echo.metadata.feyHypedUsed,8);
  const echoTarget=makeEntity({name:'Echo target',health:90,x:10});
  hostileObjects.push(echoTarget); // The staged second strike must find this target through the real hostile roster, not invent a hit off-roster.
  let secondary=null;
  const hypedStages=[]; // Actual first/second actions inspected without requiring a browser frame loop.
  const hypedVisuals=[]; // Captures both full authored pose durations for verifying the 2x speed rule.
  context.Combat.beginStagedAction=opts=>{
    const stage={...opts,totalS:(opts.windupS||0)+(opts.strikeS||0)+(opts.recoverS||0),cancelled:false};
    hypedStages.push(stage);
    return stage;
  };
  context.Combat.init=deps=>{context.Combat.deps=deps;};
  assert.equal(context.FeyHypedAttacks.installCombatBridge(),true);
  context.Combat.deps.triggerWeaponSwingVisual=(duration,options)=>hypedVisuals.push({duration,options});
  context.Combat.init(context.Combat.deps);
  context.Combat.meleeHit=(_actor,target)=>target===echoTarget; // The actual collider accepts only this single intersecting creature, not every hostile in the arena.
  context.Combat.deps.damageCreature=(target,damage,x,y,knockback,opts)=>{secondary={target,damage,knockback,opts};};
  context.Combat.deps.triggerWeaponSwingVisual(.30,{anim:'sweep',holdS:.1}); // Initial authored presentation belongs to the original strike.
  const firstStage=context.Combat.beginStagedAction({windupS:.2,strikeS:.1,recoverS:0});
  CAE.hit(echo,{target:echoTarget,actualDamage:0});
  firstStage.onComplete(firstStage);
  assert.equal(context.FeyHypedAttacks.isReplaying(player),true,'the first completed strike locks incoming weapon inputs until its Hyped follow-up finishes');
  assert.equal(hypedStages.length,2,'first attack schedules exactly one independent second staged attack');
  assert.equal(hypedVisuals.length,2,'Hyped attack replays the actual authored animation');
  assert(Math.abs(hypedVisuals[1].duration-.15)<1e-6,'second authored animation runs at exactly double speed');
  hypedStages[1].onStrike(); // A second independently tested hit, not a copy of first on-hit damage.
  assert(secondary,'Hyped paid attack strikes independently a second time');
  assert.equal(secondary.damage,4,'8 Hyped stamina produces a 16%-power second strike');
  assert.equal(secondary.knockback,16,'secondary knockback scales with the same factor');
  hypedStages[1].onComplete?.();
  assert.equal(context.FeyHypedAttacks.isReplaying(player),false,'the completed second strike releases its input lock');
  assert.equal(context.FeyHypedAttacks.debugSnapshot().replayCount,1,'second impact is recorded once');
  assert.equal(CAE.prepare({attacker:player,abilityId:'swingCombo'}).metadata.feyHypedUsed,undefined,'echo credit spent once');

  const hypeReserved=RS.getAffliction(player,'hypedStamina');
  RS.spendStamina(player,2,'walking',{actionKind:'walking'});
  RS.spendStamina(player,2,'thrown spear',{actionKind:'offensiveHeldCharge',abilityId:'thrownWeapon'});
  assert.equal(RS.getAffliction(player,'hypedStamina'),hypeReserved,'Hyped stamina is not consumed by walking or the separate projectile/ammo pipeline');

  // The real player's hallucination rotates the camera and movement basis,
  // not their persistent facing angle or customized camera setting.
  RS.addAffliction(player,'dementedStamina',8);
  const playerAngleBefore=player.angle;
  randomQueue=[.99]; // Consistent random sign for one action in this harness.
  RS.spendStamina(player,4,'normal movement',{durationS:.2});
  fey.update(.1,player);
  const yaw=fey.movementRotationRad(player);
  assert(Math.abs(Math.abs(yaw)-2*Math.PI/180)<.0001,'half action rotates the gameplay movement basis by half its 4° total');
  assert(Math.abs(fey.cameraYawDeg(player)+yaw*180/Math.PI)<.0001,'camera and movement use one additive yaw with correct camera azimuth sign');
  assert.equal(player.angle,playerAngleBefore,'Demented illusion cannot overwrite the player body facing/camera settings');
  fey.update(.1,player);
  assert(Math.abs(Math.abs(fey.movementRotationRad(player))-4*Math.PI/180)<.0001,'full movement-camera interpolation ends at precisely 4°');
  const yawBeforeTimedSpend=fey.movementRotationRad(player);
  randomQueue=[.99]; // Deterministically choose one direction for this second, independently timed exertion.
  RS.spendStamina(player,2,'timed movement',{durationS:.22});
  assert.equal(fey.setActionDuration(player,.4),true,'actual authored action time replaces the 220ms fallback');
  fey.update(.2,player);
  assert(Math.abs(Math.abs(fey.movementRotationRad(player)-yawBeforeTimedSpend)-Math.PI/180)<.0001,
    'halfway through a 400ms action, 2 spent stamina produce exactly 1° of the 2° turn');
  fey.update(.2,player);
  const gameFeyHooks=fs.readFileSync('docs/game.js','utf8'); // Uses real closure-owned gameplay seam, not a duplicate mock camera.
  assert(gameFeyHooks.includes('window.FeyIllusions?.cameraYawDeg?.(player)'), 'real gameplay camera azimuth consumes Fey yaw');
  assert(gameFeyHooks.includes('window.FeyIllusions?.movementRotationRad?.(player)'), 'non-shoulder movement consumes the same yaw');
  assert(gameFeyHooks.includes('window.FeyIllusions?.isPanickedRolling?.(player)'), 'ordinary dodge hot path skips Fey-only collision work');

  // A Hyped first swing that misses still makes its paid second swing, with its
  // own present-time hit test rather than requiring a first-hit target ledger.
  RS.addEnhancedResource(player,'hypedStamina',3);
  RS.spendStamina(player,3,'combo',{actionKind:'combatCombo',abilityId:'swingCombo'});
  const whiff=CAE.prepare({attacker:player,abilityId:'swingCombo',weaponKey:weapon,damage:10,rangePx:40,halfConeRad:1,knockbackPxS:50});
  context.Combat.deps.triggerWeaponSwingVisual(.2,{anim:'thrust'});
  const whiffStage=context.Combat.beginStagedAction({windupS:.1,strikeS:.1,recoverS:0});
  secondary=null;
  whiffStage.onComplete(whiffStage); // No CAE.hit from first swing, by construction.
  hypedStages.at(-1).onStrike(); // Target is now in range and can be struck by the second attack.
  assert(secondary&&secondary.damage>0,'an independently aimed second swing can hit when the first swing missed');
  hypedStages.at(-1).onComplete?.();

  // Actual ability consumers query the committed Hyped credit before calculating
  // windup/strike durations. Once the first is already 2x, the echo must be the
  // SAME duration, not another 2x on top (which would be 4x normal).
  RS.addEnhancedResource(player,'hypedStamina',4);
  RS.spendStamina(player,4,'combo',{actionKind:'combatCombo',abilityId:'swingCombo'});
  assert.equal(context.FeyHypedAttacks.speedMultiplierForNextAction(player,'swingCombo'),2,'a funded first attack has twice the ordinary speed');
  const accelerated=CAE.prepare({attacker:player,abilityId:'swingCombo',weaponKey:weapon,damage:15,rangePx:40,halfConeRad:1,knockbackPxS:50});
  assert.equal(accelerated.metadata.feyHypedUsed,4);
  context.Combat.deps.triggerWeaponSwingVisual(.15,{anim:'sweep'});
  const acceleratedStage=context.Combat.beginStagedAction({windupS:.1,strikeS:.05,recoverS:0});
  CAE.hit(accelerated,{target:echoTarget,actualDamage:0,metadata:{feyPrimaryDamage:40,feyPrimaryKnockback:200}}); // Deliberately differs from context's weaker base 15/50.
  acceleratedStage.onComplete(acceleratedStage);
  const equallyFastEcho=hypedStages.at(-1);
  assert(Math.abs(equallyFastEcho.totalS-.15)<1e-6,'second staged swing is also 2x normal speed, not an accidental 4x');
  assert(Math.abs(hypedVisuals.at(-1).duration-.15)<1e-6,'second authored visual retains the accelerated first duration');
  secondary=null;
  equallyFastEcho.onStrike();
  assert(Math.abs(secondary?.damage-3.2)<1e-6,'4 Hyped points copy 8% of the mastered first hit (40), not the weaker 15 base damage');
  assert(Math.abs(secondary?.knockback-16)<1e-6,'Hyped also copies 8% of the fully mastered first 200 knockback');
  equallyFastEcho.onComplete?.();
  for(const file of ['combat-combo.js','combat-quickattacks.js','combat-flurry.js','combat-charged-breaker.js']) {
    const source=fs.readFileSync('docs/js/combat/'+file,'utf8'); // Tests each actual ability's stage-tempo integration, not only a mocked combat facade.
    assert(source.includes('hypedAttackTempo') && source.includes('speedMultiplierForNextAction'),file+' must accelerate its initial paid swing');
    assert(source.includes('setActionDuration') || source.includes('durationS },'),file+' must ease Demented rotation over the real action length');
  }

  RS.addEnhancedResource(player,'hypedStamina',2);
  RS.spendStamina(player,2,'combo',{actionKind:'combatCombo',abilityId:'swingCombo'});
  CAE.prepare({attacker:player,abilityId:'swingCombo',weaponKey:weapon,damage:10,rangePx:40,halfConeRad:1});
  const countBeforeCancel=hypedStages.length;
  const interrupted=context.Combat.beginStagedAction({windupS:.3,strikeS:.1,recoverS:0});
  interrupted.onCancel(interrupted);
  assert.equal(hypedStages.length,countBeforeCancel+1,'cancelled primary cannot create an extra Hyped attack');
  assert.equal(context.FeyHypedAttacks.debugSnapshot().activeHypedAttacks,0,'cancelled actions release their strong target references');
  // NPC Hyped: eligible resource payments must fund exactly two real staged
  // attacks from that NPC, never the player's unrelated staged-action bridge.
  const npc=makeEntity({name:'Hyped NPC',isBandit:true,health:100,stamina:100,areaId:'arena'});
  const npcTarget=makeEntity({name:'NPC opponent',health:100,x:18,areaId:'arena'});
  const nHype=context.FeyHypedAttacks;
  RS.addEnhancedResource(npc,'hypedStamina',8);
  const npcBefore=RS.getAffliction(npc,'hypedStamina');
  RS.spendStamina(npc,4,'patrol',{actionKind:'walking'});
  assert.equal(RS.getAffliction(npc,'hypedStamina'),npcBefore,'NPC walking leaves Hyped enhanced resource untouched');
  RS.spendStamina(npc,8,'NPC melee',{actionKind:'combatNpcMelee',abilityId:'npcMelee'});
  const npcPayment=nHype.claimNpcMelee(npc);
  assert.equal(npcPayment?.used,8,'NPC melee gets a separately paid Hyped transaction');
  assert.equal(npcPayment?.tempo,2,'NPC attack runs at precisely twice normal speed');
  assert.equal(nHype.claimNpcMelee(npc),null,'one NPC payment cannot be claimed twice');
  assert.equal(nHype.claimNpcMelee(player),null,'player pending credits cannot be stolen by NPC attack stages');
  const npcResults=[]; // First and second actual committed payloads share the NPC's normal damage authority.
  let npcCanHit=true, npcComplete=0, npcStrikeCount=0, npcEchoStarts=0, npcEchoMovementRatio=0; // Confirms the original NPC movement owner stages one scaled second lunge.
  const npcStagesBefore=hypedStages.length;
  const npcOptions={
    windupS:.2,strikeS:.1,recoverS:0,
    data:{isBandit:true,attacker:npc,voiceAbilityId:'opportunistJab'},
    feyHypedNpcTarget:npcTarget, // NPC stage must reject a target that changed map before the second contact.
    onFeyHypedNpcEchoStart(ratio){npcEchoStarts++;npcEchoMovementRatio=ratio;}, // Actual bandit owner uses the same callback to launch its second independently swept lunge.
    onStrike(){
      npcStrikeCount++;
      if (!npcCanHit) return; // An original miss cannot skip the paid, independently checked second attack.
      const second=nHype.npcDamagePayload(npc,npcTarget,40,200,{tag:'sharp',afflictionBonuses:{bleedingHealth:2},footingDamageMultiplier:1.4});
      npcResults.push(second || {damage:40,knockback:200,opts:{tag:'sharp',afflictionBonuses:{bleedingHealth:2}}});
    },
    onComplete(){npcComplete++;},
    onCancel(){npcComplete=-1;},
  };
  const npcFirst=nHype.beginNpcMelee(npc,npcOptions,npcPayment);
  npc._banditAction=npcFirst;
  assert(Math.abs(npcFirst.windupS-.1)<.00001&&Math.abs(npcFirst.strikeS-.05)<.00001,
    'NPC original attack windup and strike are both accelerated, not just its animation');
  npcFirst.onStrike(npcFirst);
  npcFirst.onComplete(npcFirst);
  assert.equal(npcComplete,0,'NPC combo cooldown/retreat cannot run between paired attacks');
  assert.equal(npcEchoStarts,1,'the second NPC strike starts one fresh lunge before its actual staged attack');
  assert(Math.abs(npcEchoMovementRatio-.16)<.000001,'the second NPC lunge scales distance by 2% per committed Hyped point');
  assert.equal(hypedStages.length,npcStagesBefore+2,'NPC attack creates exactly two authoritatively staged actions');
  const npcSecond=npc._banditAction;
  assert(Math.abs(npcSecond.windupS-.1)<.00001&&Math.abs(npcSecond.strikeS-.05)<.00001,'NPC second attack also runs at 2x');
  npcSecond.onStrike(npcSecond);
  npcSecond.onComplete(npcSecond);
  assert.equal(npcStrikeCount,2,'same authored NPC attack executes two independent actual strikes');
  assert.equal(npcComplete,1,'NPC authored completion runs once, after both strikes');
  assert.equal(npcResults[0].damage,40);
  assert(Math.abs(npcResults[1].damage-6.4)<.00001,'8 Hyped points copy 16% of actual first NPC damage');
  assert(Math.abs(npcResults[1].knockback-32)<.00001,'NPC secondary knockback respects the same ratio');
  assert(Math.abs(npcResults[1].opts.afflictionBonuses.bleedingHealth-.32)<.00001,'NPC second status magnitude copies committed original');
  assert.equal(npcResults[1].opts.footingDamageMultiplier,1.4,'Footing effect does not get incorrectly multiplied by the ratio twice');
  assert.equal(npc._feyHypedNpcSequence,undefined,'completed NPC attacks release all target snapshots and stage state');

  // A missed first NPC swing can still hit on the second actual hit test.
  RS.addEnhancedResource(npc,'hypedStamina',5);
  RS.spendStamina(npc,5,'NPC melee',{actionKind:'combatNpcMelee',abilityId:'npcMelee'});
  const npcNext=nHype.claimNpcMelee(npc);
  npcResults.length=0;npcStrikeCount=0;npcComplete=0;npcCanHit=false;
  const whiffNpc=nHype.beginNpcMelee(npc,npcOptions,npcNext);
  npc._banditAction=whiffNpc;
  whiffNpc.onStrike(whiffNpc);
  npcCanHit=true;
  whiffNpc.onComplete(whiffNpc);
  const catchNpc=npc._banditAction;
  catchNpc.onStrike(catchNpc);
  catchNpc.onComplete(catchNpc);
  assert.equal(npcResults.length,1,'second NPC strike can catch a target that dodged the original');
  assert(Math.abs(npcResults[0].damage-4)<.00001,'a fresh second NPC hit is 10% power with 5 Hyped points');

  // A target changed to another map after a valid first strike is never
  // damaged by the still-scheduled independent second collision check.
  RS.addEnhancedResource(npc,'hypedStamina',2);
  RS.spendStamina(npc,2,'NPC melee',{actionKind:'combatNpcMelee',abilityId:'npcMelee'});
  npcResults.length=0;npcStrikeCount=0;npcComplete=0;npcCanHit=true;
  const leftAreaNpc=nHype.beginNpcMelee(npc,npcOptions,nHype.claimNpcMelee(npc));
  npc._banditAction=leftAreaNpc;
  leftAreaNpc.onStrike(leftAreaNpc);
  leftAreaNpc.onComplete(leftAreaNpc);
  npcTarget.areaId='different-area';
  npc._banditAction.onStrike();
  npc._banditAction.onComplete();
  assert.equal(npcStrikeCount,1,'the second NPC strike cannot run on a target removed to another area');
  assert.equal(npcResults.length,1,'cross-area Hyped does not create ghost hits');
  npcTarget.areaId='arena'; // Restore shared fixture for subsequent cancel and ordinary combat tests.

  // NPC staggers/death cancel the pending echo without leaking stale status.
  RS.addEnhancedResource(npc,'hypedStamina',3);
  RS.spendStamina(npc,3,'NPC melee',{actionKind:'combatNpcMelee',abilityId:'npcMelee'});
  const interruptedNpc=nHype.beginNpcMelee(npc,npcOptions,nHype.claimNpcMelee(npc));
  const beforeNpcCancel=hypedStages.length;
  interruptedNpc.onCancel(interruptedNpc);
  assert.equal(hypedStages.length,beforeNpcCancel,'cancelled NPC action schedules no extra strike');
  assert.equal(npcEchoStarts,3,'a cancelled NPC attack never starts another lunge'); // Three completed NPC pairs (including map-change whiff) each requested one echo-lunge.
  assert.equal(npc._feyHypedNpcSequence,undefined,'NPC cancellation cleans paid state');
  assert.equal(nHype.npcDamagePayload(npc,npcTarget,5,10),null,'ordinary later hits get no stale Hyped multiplier');
  assert.equal(nHype.debugSnapshot().npcReplayCount>=2,true,'mobile diagnostics count independently tested NPC second contacts');

  // Validate actual gameplay and offscreen-duel call sites instead of a mock-only executor.
  const banditHypeSource=fs.readFileSync('docs/js/combat/combat-bandit.js','utf8');
  const stagedDuelHypeSource=fs.readFileSync('docs/js/combat/npc-duel-staging.js','utf8');
  const resourceHypeSource=fs.readFileSync('docs/js/combat/resource-system.js','utf8');
  assert.equal((banditHypeSource.match(/c\._banditAction = beginBanditMeleeStage\(c, \{/g)||[]).length,3,
    'real NPC combo, quick and heavy stages use the shared Hyped executor');
  assert(banditHypeSource.includes('npcDamagePayload?.(c, target, amount, knockbackPxS, opts)'),
    'real NPC damage-to-player and damage-to-NPC owner applies the scaled second payload');
  assert(banditHypeSource.includes('firstLunge.distancePx * ratio') && banditHypeSource.includes('beginBanditLunge(c, firstLunge.distancePx * ratio'),
    'the second NPC lunge is swept by the original NPC movement owner and scaled by the committed Hyped ratio');
  assert(stagedDuelHypeSource.includes('claimNpcMelee?.(c)'),
    'fully offscreen NPC battles cannot silently discard paid Hyped');
  assert(resourceHypeSource.includes('combatNpcMelee'),'NPC Hyped must remain action-eligible in enhanced-resource definitions');

  // Execute the actual shipped BanditCombat combo with paid Hyped; this
  // catches wiring errors between the shared staged executor, NPC strike
  // handler, lunge owner, actor-specific damage and combo-chain bookkeeping.
  {
    const npcCode=fs.readFileSync('docs/js/combat/combat-bandit.js','utf8');
    const npcSlice=(start,end)=>{
      const a=npcCode.indexOf(start),b=npcCode.indexOf(end,a);
      assert(a>=0&&b>a,'BanditCombat NPC seam found: '+start);
      return npcCode.slice(a,b);
    };
    const npcBanditSource=npcSlice('  function beginBanditMeleeStage(','  function resolvedBanditCombatTarget(')
      +npcSlice('  function damageBanditCombatTarget(','  // Mirrors combat-quickattacks.js')
      +npcSlice('  function payBanditAttack(','  function fireBanditQuickAttack(');
    const liveStages=hypedStages; // Existing Combat.beginStagedAction test bridge records the real NPC stage options too.
    const liveLunges=[],liveNpcHits=[]; // Compare original and second real damage/lunge dispatch without reimplementing the bandit attack.
    const savedComboData=context.Combat.comboData,savedComboPose=context.Combat.comboStepPose;
    const savedAimSolution=context.Combat.meleeAimSolution,savedMeleeHit=context.Combat.meleeHit,savedAudio=context.AudioSystem;
    const npcDef={attackDamage:20,attackRangePx:45,attackCooldownS:1,attackTag:'blunt',
      attackStaminaCost:8,weaponShapeStats:{speed:1,power:1,range:1,efficiency:1}};
    const npcCombatant=makeEntity({name:'Stage integration NPC',isBandit:true,areaId:'arena',x:0,y:0,
      _banditComboIndex:0,def:npcDef});
    const npcOpponent=makeEntity({name:'Stage integration target',areaId:'arena',x:30,y:0});
    const stageNpcDeps={TILE:64,HOSTILE_BITE_KNOCKBACK_PX_S:200,
      damagePlayer:(damage,x,y,knockback)=>{liveNpcHits.push({damage,knockback});return damage;},
      damageCreature:()=>{throw Error('NPC attacking player must use the real player damage path');}};
    const npcCombatScope={
      window:context,performance:context.performance,Math,deps:stageNpcDeps,
      beginBanditLunge(c,durationPx,durationS,hitTest,target){
        c._banditLunging=true;c._banditLungeDistancePx=durationPx;c._banditLungeDur=durationS;
        c._banditLungeT=durationS;c._banditLungeHitTest=hitTest;
        liveLunges.push({distance:durationPx,duration:durationS});
      },
      cancelBanditLunge(c){c._banditLunging=false;},
      finishBanditAction(c){c._banditAction=null;},
      releaseBanditAttackTurn(){}, // Real coordinator tested separately; this extracted Fey-damage fixture supplies its lifecycle dependency.
      banditAttackBaseline:def=>({damage:def.attackDamage,rangePx:def.attackRangePx,knockbackPxS:200}),
      spawnBanditTrailArc(){},banditRetreatDurationS:()=>.2,
      BANDIT_COMBO_CHAIN_GAP_S:.1,BANDIT_LUNGE_HALT_MARGIN:.68,
    };
    try {
      context.Combat.comboData={swingCombo:[
        {name:'First swing',damageMul:2,rangeMul:2,halfConeDeg:55,knockbackMul:1,windupS:.2,strikeS:.1,lungeMul:1,anim:'thrust',dirSign:1},
        {name:'Second swing',damageMul:1,rangeMul:1,halfConeDeg:45,knockbackMul:1,windupS:.2,strikeS:.1,lungeMul:1,anim:'thrust',dirSign:1},
      ]};
      context.Combat.comboStepPose=()=>({});
      context.Combat.meleeAimSolution=()=>({pitch:0});
      context.Combat.meleeHit=()=>true;
      context.AudioSystem={playWeaponHitSfx(){}};
      vm.createContext(npcCombatScope);
      vm.runInContext(npcBanditSource,npcCombatScope,{filename:'combat-bandit.js#hyped-npc-integration'});
      RS.addEnhancedResource(npcCombatant,'hypedStamina',8);
      const firstIndex=liveStages.length;
      assert.equal(npcCombatScope.fireBanditComboStep(npcCombatant,npcDef,{tap1:'swingCombo'},npcOpponent),true);
      const firstStage=liveStages[firstIndex];
      assert(firstStage&&Math.abs(firstStage.totalS-.15)<.00001,'real NPC combo first stage is sped up 2x');
      firstStage.onStrike(firstStage);firstStage.onComplete(firstStage);
      const secondStage=liveStages[firstIndex+1];
      assert(secondStage&&Math.abs(secondStage.totalS-.15)<.00001,'real NPC combo echo stage is sped up 2x');
      secondStage.onStrike(secondStage);secondStage.onComplete(secondStage);
      assert.equal(liveNpcHits.length,2,'real NPC melee damage authority dispatches exactly two independently tested strikes');
      assert.equal(liveNpcHits[0].damage,40);
      assert(Math.abs(liveNpcHits[1].damage-6.4)<.00001,'real NPC second hit preserves the first hit’s true damage and scales 2% per Hyped point');
      assert(Math.abs(liveNpcHits[1].knockback/liveNpcHits[0].knockback-.16)<.00001);
      assert.equal(liveLunges.length,2,'the second real NPC combo stage launches its own swept lunge');
      assert(Math.abs(liveLunges[1].distance/liveLunges[0].distance-.16)<.00001);
      assert.equal(npcCombatant._banditComboLandCount,1,'two Hyped hits count as one combo step for NPC chain timing');
      assert.equal(npcCombatant._banditAction,null,'completed NPC echo clears the combat owner');
    } finally {
      context.Combat.comboData=savedComboData;context.Combat.comboStepPose=savedComboPose;
      context.Combat.meleeAimSolution=savedAimSolution;context.Combat.meleeHit=savedMeleeHit;
      context.AudioSystem=savedAudio;
    }
  }

  hostileObjects.pop(); // Restore the original combat roster before unrelated relic/quest assertions.

  // A Fey Flourish bound to a defensive slot cannot report a fake effect.
  ES.setFlourish('fey-testing-blade','hold2','feyDreadPulse');
  const feyDefensiveScope=fs.readFileSync('docs/js/combat/combat-enchantments.js','utf8');
  assert(feyDefensiveScope.includes("def.alignment === 'Fey'"),'defensive Fey handlers explicitly fail closed');

  // The loaded Harlyao bound relic authority supports both origins, and
  // neither the ordinary boss chest nor Boney's Fey roll can borrow the other's shapes.
  const feyShapes=new Set(['dagger','daggersword','fishingspear','hatchet']);
  const ruinShapes=new Set(['longsword','warhammer','broadsword']);
  for(let n=0;n<50;n++) {
    const relic=HR.makeFeyRelic();
    assert(feyShapes.has(relic.shape));
    const ids=[...relic.enchantments.base,...Object.values(relic.enchantments.flourishes)];
    assert(ids.length>=1,'Fey loot cannot be empty');
    assert(ids.every(id=>ES.DEFINITIONS[id].alignment==='Fey'),'Boney loot cannot learn non-Fey ruin enchantments');
    const key=HR.encodeBoundKey(relic);
    assert(key.startsWith('feyBound_'));
    const decoded=HR.decodeBoundKey(key);
    assert.equal(decoded.shape,relic.shape);
    assert.equal(decoded.origin,'Fey');
    assert(ruinShapes.has(HR.makeRelic().shape),'Harlyao boss relic shapes stay separate');
    assert(HR.rollEnchantments().base.every(id=>ES.DEFINITIONS[id].alignment!=='Fey'));
  }
  assert.equal(HR.decodeBoundKey('feyBound_longsword_abcd_BfeyPhantomWound_F'),null,'Fey key cannot impersonate Harlyao sword');
  assert.equal(HR.decodeBoundKey('feyBound_dagger_abcd_Bburning_F'),null,'Fey key cannot smuggle another origin');
}
console.log('Fey Immundanity, real Stamina illusions, proc, scaled echo, migrations and bound relics passed');

 
// Planar lore: real event bus and resource transactions, no mastery statuses.
{
  reset();
  const key = 'realm-test-blade'; // Private weapon and fresh NPC actors isolate resource arithmetic.
  const attacker = makeEntity({ name: 'Realm wielder' });
  const target = makeEntity({ name: 'Realm target' });
  const hit = (patch = {}) => CAE.hit(null, {
    attacker, target, weaponKey: key, slotId: 'tap1', attackCategory: 'combo',
    comboFinisher: true, actualDamage: 4, ...patch,
  });
  const equip = (base = [], flourishes = {}) => ES.load({ [key]: { base, flourishes } });
  const close = (value, expected) => assert(Math.abs(value - expected) < 0.0001, `${value} != ${expected}`);
  const amount = (actor, id) => RS.getAffliction(actor, id);
  const clear = (actor, id) => RS.removeAffliction(actor, id, 1000);
  const newBases = [
    ['stormwake', 'Tothal', 'undertowStamina', 6.6],
    ['stonebind', 'Hronal', 'leadboundStamina', 5.5],
    ['soulweight', 'Kanthic', 'soulweightedHealth', 6.6],
  ]; // One equipped planar enchantment gives +10% Immundanity.
  for (const [id, alignment, status, expected] of newBases) {
    equip([id]);
    assert.equal(ES.DEFINITIONS[id].alignment, alignment);
    assert.equal(ES.DEFINITIONS[id].type, 'Base');
    assert(RS.AFFLICTIONS[status]);
    CAE.prepare({ attacker, target, weaponKey: key });
    assert.equal(amount(target, status), 0, 'preparation alone never inflicts a Base');
    hit({ comboFinisher: false });
    close(amount(target, status), expected);
    assert.equal(RS.getTimedDebuffs(target).length, 0, 'realm effects never reuse mastery debuffs');
    const dead = makeEntity({ health: 0 });
    hit({ target: dead });
    assert.equal(amount(dead, status), 0, 'no buildup on corpses');
    for (let i = 0; i < 30; i++) hit();
    close(amount(target, status), 100); // Canonical maximum-resource cap.
    clear(target, status);
  }
  equip(['stormwake', 'stonebind']);
  assert.equal(ES.getWeaponImmundanity(key), 0);
  hit();
  close(amount(target, 'undertowStamina'), 6);
  close(amount(target, 'leadboundStamina'), 5);
  clear(target, 'undertowStamina');
  clear(target, 'leadboundStamina');
  equip(['soulweight', 'ancestralSight']);
  assert.equal(ES.getWeaponImmundanity(key), 0);
  hit();
  close(amount(target, 'soulweightedHealth'), 6);
  close(amount(attacker, 'weightlessStamina'), 5);
  clear(target, 'soulweightedHealth');
  clear(attacker, 'weightlessStamina');

  // Undertow: recovery, not expenditure; black Stamina recovery is independent.
  target.stamina = 30;
  RS.addAffliction(target, 'undertowStamina', 10);
  RS.restoreStamina(target, 4);
  close(target.stamina, 30);
  close(amount(target, 'undertowStamina'), 6);
  RS.restoreStamina(target, 10);
  close(target.stamina, 34);
  close(amount(target, 'undertowStamina'), 0);
  RS.addAffliction(target, 'undertowStamina', 10);
  RS.tick(target, 0.5, { staminaRegenPerSec: 4, healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert(amount(target, 'undertowStamina') < 10, 'natural recovery pays the same reserve');
  close(target.stamina, 34);
  target.exhaustion.active = true; target.exhaustion.blackStamina = 30;
  const debt = amount(target, 'undertowStamina');
  RS.restoreStamina(target, 10, { exhaustionAmount: 5 });
  close(target.exhaustion.blackStamina, 35);
  close(amount(target, 'undertowStamina'), debt);
  target.exhaustion.active = false;
  clear(target, 'undertowStamina');

  // Leadbound occupies current ordinary Stamina and never charges enhanced payments.
  target.stamina = 100;
  RS.addAffliction(target, 'leadboundStamina', 50);
  close(RS.movementMultiplier(target, 'walk'), .625);
  close(RS.movementMultiplier(target, 'dodge'), .625);
  close(RS.movementMultiplier(target, 'lunge'), .625);
  close(RS.getSegmentBox(target, 'stamina', 'leadboundStamina').leftPoints, 50);
  RS.addAffliction(target, 'weightlessStamina', 25);
  close(RS.movementMultiplier(target, 'walk'), .9375);
  close(RS.timedDebuffModifier(target, 'moveSpeed'), .9375);
  close(RS.timedDebuffModifier(target, 'dodgeLungeDistance'), .9375);
  close(RS.timedDebuffModifier(target, 'attackSpeed'), 1);
  RS.applyTimedDebuff(target, 'heavy', 12, { power: 2 });
  close(RS.movementMultiplier(target, 'walk'), .9375 * .85);
  close(RS.movementMultiplier(target, 'dodge'), .9375 * .85);
  close(RS.movementMultiplier(target, 'lunge'), .9375 * .85);
  RS.clearTimedDebuff(target, 'heavy');
  RS.addEnhancedResource(target, 'moralizedStamina', 2);
  RS.spendStamina(target, 6, 'ordinary');
  close(amount(target, 'leadboundStamina'), 50);
  RS.spendStamina(target, 10, 'ordinary');
  close(amount(target, 'leadboundStamina'), 40);
  close(amount(target, 'weightlessStamina'), 25);
  RS.tick(target, 2, { staminaRegenPerSec: 0, healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert(amount(target, 'leadboundStamina') < 40);
  clear(target, 'leadboundStamina');
  clear(target, 'weightlessStamina');
  target.stamina = 10;
  RS.addAffliction(target, 'leadboundStamina', 100);
  close(amount(target, 'leadboundStamina'), 10);
  RS.addAffliction(target, 'weightlessStamina', 10);
  RS.spendStamina(target, 5, 'ordinary');
  close(amount(target, 'leadboundStamina'), 5);
  close(amount(target, 'weightlessStamina'), 10);
  clear(target, 'leadboundStamina');
  clear(target, 'weightlessStamina');
  close(RS.movementMultiplier(target, 'walk'), 1);

  // Soulweight: ordinary direct Health loss drains ordinary Stamina, no debt.
  target.health = 100; target.stamina = 3;
  RS.addAffliction(target, 'soulweightedHealth', 8);
  RS.addEnhancedResource(target, 'mirroredHealth', 5);
  close(RS.applyDamage(target, 5), 0);
  close(target.stamina, 3);
  close(RS.applyDamage(target, 5), 5);
  close(target.stamina, 0);
  close(amount(target, 'soulweightedHealth'), 5);
  assert.equal(target.exhaustion.active, false);
  clear(target, 'soulweightedHealth');

  // Veilmark bypasses only a finite portion, without inflating incoming damage.
  target.health = 100;
  RS.addEnhancedResource(target, 'mirroredHealth', 20);
  RS.addAffliction(target, 'veilmarkedHealth', 6);
  close(RS.applyDamage(target, 10), 6);
  close(amount(target, 'mirroredHealth'), 16);
  close(amount(target, 'veilmarkedHealth'), 0);
  clear(target, 'mirroredHealth');

  const flourishes = [
    ['stormRenewal', 'currentStamina', 8.8, 2.2],
    ['bedrock', 'temperedFooting', 11, 2.8],
    ['blackBargain', 'pactHealth', 8.8, 2.2],
  ];
  for (const [id, status, full, quarter] of flourishes) {
    assert(RS.ENHANCED_RESOURCE_DEFS[status]);
    equip([], { tap1: id });
    hit({ comboFinisher: false });
    close(amount(attacker, status), 0);
    hit();
    close(amount(attacker, status), full);
    clear(attacker, status);
    hit({ attackCategory: 'offensiveHold', isFlurry: true, comboFinisher: false });
    close(amount(attacker, status), quarter);
    clear(attacker, status);
    equip([], { hold2: id });
    CAE.defensive({ attacker, weaponKey: key, slotId: 'hold2', defensiveResult: 'block' });
    close(amount(attacker, status), full);
    clear(attacker, status);
  }

  attacker.stamina = 40;
  RS.addEnhancedResource(attacker, 'currentStamina', 8);
  RS.spendStamina(attacker, 4, 'attack', { actionKind: 'combatCombo' });
  close(attacker.stamina, 36);
  close(amount(attacker, 'currentStamina'), 8);
  RS.spendStamina(attacker, 6, 'roll dodge');
  close(attacker.stamina, 36);
  close(amount(attacker, 'currentStamina'), 5);
  RS.spendStamina(attacker, 4, 'evade', { actionKind: 'combatDodge' });
  close(amount(attacker, 'currentStamina'), 3);
  clear(attacker, 'currentStamina');

  attacker.footing = 50; attacker.stamina = 20;
  RS.addEnhancedResource(attacker, 'temperedFooting', 50);
  close(RS.attackPowerForAttack({ attacker, attackPower: 12 }), 24);
  const victim = makeEntity();
  close(RS.applyDamage(victim, 4, { attacker, attackPower: 10, afflictionBonuses: { bleedingHealth: .5 } }), 4);
  close(amount(victim, 'bleedingHealth'), 10);
  close(RS.spendFooting(attacker, 6), 0);
  close(attacker.stamina, 20);
  close(amount(attacker, 'temperedFooting'), 44);
  RS.spendFooting(attacker, 48);
  close(attacker.footing, 46);
  close(amount(attacker, 'temperedFooting'), 0);
  close(RS.attackPowerForAttack({ attacker, attackPower: 12 }), 12);

  attacker.health = 100; attacker.stamina = 50;
  RS.addEnhancedResource(attacker, 'pactHealth', 8);
  close(RS.applyDamage(attacker, 10), 0);
  close(amount(attacker, 'pactHealth'), 3);
  close(amount(attacker, 'soulweightedHealth'), 5);
  close(attacker.stamina, 50);
  close(RS.applyHealthAfflictionDamage(attacker, 4), 4);
  close(amount(attacker, 'pactHealth'), 3);
  close(amount(attacker, 'soulweightedHealth'), 5);
  close(RS.applyDamage(attacker, 8), 2);
  close(attacker.stamina, 48);
  close(amount(attacker, 'pactHealth'), 0);
  close(amount(attacker, 'soulweightedHealth'), 6);

  clear(attacker, 'soulweightedHealth');
  RS.addEnhancedResource(attacker, 'guardianHealth', 8);
  close(RS.applyDamage(attacker, 4), 4);
  close(amount(attacker, 'guardianHealth'), 8);
  close(RS.applyHealthAfflictionDamage(attacker, 10), 0);
  close(amount(attacker, 'guardianHealth'), 3);
  close(RS.applyHealthAfflictionDamage(attacker, 8), 2);

  // Ohth's Base grants the wielder rather than the victim.
  equip(['ancestralSight']);
  clear(attacker, 'weightlessStamina');
  hit({ comboFinisher: false });
  close(amount(attacker, 'weightlessStamina'), 5.5);
  close(amount(target, 'weightlessStamina'), 0);
  clear(attacker, 'weightlessStamina');
  RS.addAffliction(attacker, 'weightlessStamina', 100);
  close(RS.timedDebuffModifier(attacker, 'moveSpeed'), 3);
  close(RS.timedDebuffModifier(attacker, 'dodgeLungeDistance'), 3);
  close(RS.timedDebuffModifier(attacker, 'attackSpeed'), 1);
  clear(attacker, 'weightlessStamina');
  attacker.stamina = 100;
  RS.addAffliction(attacker, 'weightlessStamina', 20);
  RS.addAffliction(attacker, 'woundedStamina', 10);
  close(RS.getSegmentBox(attacker, 'stamina', 'woundedStamina').leftPoints, 20);
  RS.spendStamina(attacker, 70, 'ordinary');
  close(amount(attacker, 'weightlessStamina'), 20);
  RS.spendStamina(attacker, 10, 'ordinary');
  close(amount(attacker, 'woundedStamina'), 0);
  close(amount(attacker, 'weightlessStamina'), 20);
  RS.spendStamina(attacker, 5, 'ordinary');
  close(amount(attacker, 'weightlessStamina'), 15);
  RS.tick(attacker, 2, { staminaRegenPerSec: 0, healthRegenPerSec: 0, footingRegenPerSec: 0 });
  assert(amount(attacker, 'weightlessStamina') < 15, 'Weightless fades on the affliction tick');
  clear(attacker, 'weightlessStamina');
  equip([], { tap2: 'ancestralMercy', hold1: 'ancestralMercy' });
  hit({ slotId: 'tap2', attackCategory: 'quickAttack', quickBonusEffectProc: true });
  close(amount(attacker, 'unshackledStamina'), 9.6);
  clear(attacker, 'unshackledStamina');
  hit({ slotId: 'hold1', attackCategory: 'offensiveHold', isFlurry: true });
  close(amount(attacker, 'unshackledStamina'), 2.4);
  clear(attacker, 'unshackledStamina');
  RS.addEnhancedResource(attacker, 'unshackledStamina', 100);
  close(RS.attackTempoMultiplier(attacker, 'combatCombo'), 3);
  close(RS.attackTempoMultiplier(attacker, 'combatQuickAttack'), 1);
  const combo = RS.spendStamina(attacker, 12, 'combo', { actionKind: 'combatCombo' });
  close(combo.tempoMultiplier, 3);
  close(amount(attacker, 'unshackledStamina'), 88);
  close(RS.attackTempoMultiplier(attacker, 'combatCombo'), 2.76);
  assert(!ES.allowsFlourishSlot('fury', 'hold1'));
  assert(!ES.allowsFlourishSlot('ancestralMercy', 'tap1'));
  assert(ES.allowsFlourishSlot('ancestralMercy', 'hold2'));
  assert(!ES.setFlourish(key, 'tap1', 'ancestralMercy'));
  assert(context.HOBUNJI_CONFIG.resourceRings.afflictionColors.weightlessStamina);
  assert(context.HOBUNJI_CONFIG.resourceRings.afflictionColors.unshackledStamina);

  const savedState = { base: ['stormwake', 'ancestralSight'], flourishes: { tap1: 'blackBargain', hold2: 'ancestralMercy' } };
  equip(savedState.base, savedState.flourishes);
  ES.load(ES.serialize());
  same(ES.stateFor(key), savedState);
  const relic = { shape: 'longsword', uid: 'realmtest123', enchantments: savedState };
  const decoded = HR.decodeBoundKey(HR.encodeBoundKey(relic));
  assert(decoded);
  same(decoded.enchantments, savedState);
  for (const [, , id] of newBases) assert(context.HOBUNJI_CONFIG.resourceRings.afflictionColors[id]);
  for (const [, id] of flourishes) assert(context.HOBUNJI_CONFIG.resourceRings.afflictionColors[id]);
}
console.log('Planar enchantments: unique buildup, transactions, defensive/flurry triggers and persistence passed');

// The live game's Drunken Health compatibility adapter replaces applyDamage.
// Exercise its actual script (the preceding core animation IIFE is unrelated to this test).
{
  const source = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8');
  const start = source.indexOf('(() => {\n  "use strict";\n\n  const RS = window.ResourceSystem;');
  assert(start >= 0, 'live damage adapter must be present');
  vm.runInContext(source.slice(start), context, { filename: 'combat-core.js (Drunken Health adapter)' });
  assert(RS.__drunkenAfflictionsInstalled);
  const actor = makeEntity();
  RS.addEnhancedResource(actor, 'pactHealth', 8);
  assert.equal(RS.applyDamage(actor, 10), 0);
  assert.equal(RS.getAffliction(actor, 'soulweightedHealth'), 5);
  RS.addAffliction(actor, 'veilmarkedHealth', 4);
  assert.equal(RS.applyDamage(actor, 8), 4);
  assert.equal(actor.stamina, 96);
  assert.equal(RS.getAffliction(actor, 'pactHealth'), 1);
  assert.equal(RS.getAffliction(actor, 'soulweightedHealth'), 3, 'only old pact debt discharges');
  RS.addEnhancedResource(actor, 'guardianHealth', 5);
  RS.addAffliction(actor, 'woundedStamina', 10);
  actor.stamina = 10;
  RS.spendStamina(actor, 5, 'attack');
  assert.equal(actor.health, 96, 'Guardian absorbs Wounded expenditure damage');
  assert.equal(RS.getAffliction(actor, 'guardianHealth'), 2.5);
  assert.equal(RS.getAffliction(actor, 'pactHealth'), 1, 'Pact is reserved for direct damage');
  const drunk = makeEntity();
  RS.addAffliction(drunk, 'drunkenHealth', 6);
  RS.addAffliction(drunk, 'veilmarkedHealth', 5);
  assert.equal(RS.applyDamage(drunk, 10), 4);
  assert.equal(RS.getAffliction(drunk, 'bleedingHealth'), 6, 'Drunken conversion still precedes planar protection');
  assert.equal(RS.getAffliction(drunk, 'veilmarkedHealth'), 1);
}
console.log('Planar enchantments through live Drunken Health adapter passed');

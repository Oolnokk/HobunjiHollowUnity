'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = path => fs.readFileSync(path, 'utf8'); // Loads production modules, never a reimplemented combat fixture.

async function testFamilyProficiency() {
  let gear = { toolMastery: {}, weaponFamilyProficiency: { axes: { xp: 39 } } }; // Reassigned later to verify old-save migration and character isolation.
  const slots = { weapon: 'hatchet', ranged: 'crossbow' }; // Proves kills credit the actual weapon and not a different ranged slot.
  const defs = { // Each real shape family and a nonqualifying ranged weapon are represented.
    hatchet: { label: 'Hatchet', shapeKey: 'hatchet', slots: ['axe', 'weapon'] },
    fishingspear: { shapeKey: 'fishingspear', slots: ['harpoon', 'weapon'] },
    dagger: { shapeKey: 'dagger', slots: ['weapon'] },
    warhammer: { shapeKey: 'warhammer', slots: ['weapon'] },
    pickshovel: { shapeKey: 'pickshovel', slots: ['pick', 'weapon'] },
    crossbow: { shapeKey: 'crossbow', slots: ['ranged'] },
  };
  let saves = 0; // Counts the canonical gear persistence writes for earned kills.
  const runtime = { console, performance: { now: () => 1000 }, queueMicrotask, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, document: { readyState: 'complete', addEventListener() {} } };
  runtime.window = runtime;
  runtime.dispatchEvent = () => {};
  runtime.WorldPopupText = { showChange() {}, queueLevelUp() { return true; } };
  runtime.EquipmentPanel = { init() {} };
  runtime.Combat = { init(deps) { this.deps = deps; }, update() {} };
  vm.createContext(runtime);
  vm.runInContext(source('docs/js/mastery-policy.js'), runtime);
  runtime.EquipmentPanel.init({ getGearInventory: () => gear, equipmentSlots: slots, TOOL_ITEM_DEFS: defs, saveGearInventory() { saves++; }, showToast() {} });
  const combatDeps = { equipmentSlots: slots, TOOL_ITEM_DEFS: defs, gearInventory: () => gear, currentWeaponKey: () => slots.weapon, getEquippedRangedKey: () => slots.ranged,
    damageCreature(enemy, amount) { enemy.health = Math.max(0, enemy.health - amount); },
    awardWeaponMasteryXp() {}, awardRangedMastery() {} };
  runtime.Combat.init(combatDeps);
  await Promise.resolve();
  const policy = runtime.HobunjiMasteryPolicy;
  for (const [item, family] of [['hatchet','axes'], ['fishingspear','polearms'], ['dagger','blades'], ['warhammer','bludgeons'], ['pickshovel','improvised'], ['crossbow',null]]) {
    assert.equal(policy.weaponFamily(item), family, 'weapon classification: ' + item);
  }
  const shapesWindow = {}; // The real weapon-shape registry is the authoritative finite set of currently supported melee donors.
  vm.runInContext(source('docs/js/combat/weapon-shape-stats.js'), { window: shapesWindow });
  for (const shape of Object.keys(shapesWindow.WeaponShapeStats.SHAPES)) {
    defs[shape] ||= { shapeKey: shape, slots: ['weapon'] }; // Preserve the fixture's real dual-role axe/spear slots when adding other authored donors.
    assert.ok(policy.weaponFamily(shape), 'no shipped melee weapon shape should lack a proficiency: ' + shape);
  }
  runtime.ModularWeapons = { decode: key => key === 'forged' ? { shaft: 'long', head: 'hammer' } : null,
    getConfig: () => ({ heads: { hammer: { sourceShape: 'warhammer' } } }) };
  assert.equal(policy.weaponFamily('forged'), 'bludgeons', 'the forged head, not its pole shaft, determines family');
  const enemy = () => ({ health: 10, def: { health: 60, damage: 8 } }); // Fixed enemy difficulty keeps each XP award deterministic.
  combatDeps.damageCreature(enemy(), 20);
  assert.equal(gear.toolMastery.hatchet.xp, 1.3, 'the rank-0 kill uses its original mastery rate');
  assert.equal(gear.weaponFamilyProficiency.axes.xp, 40.3, 'the same kill advances separate family proficiency');
  assert.equal(policy.proficiencyForWeapon('hatchet').level, 1);
  combatDeps.damageCreature(enemy(), 20);
  assert.equal(gear.toolMastery.hatchet.xp, 2.73, 'rank 1 boosts the following kill by 10%');
  assert.equal(gear.weaponFamilyProficiency.axes.xp, 41.6, 'family XP itself is never accelerated');
  policy.awardToolUse('hatchet', 1, 'axe');
  assert.equal(gear.toolMastery.hatchet.xp, 3.73, 'ordinary axe work stays at its historical unboosted XP rate');
  assert.equal(gear.weaponFamilyProficiency.axes.xp, 41.6, 'ordinary tool work does not train combat proficiency');
  const originalCharacterGear = gear; // Restored below to verify another character cannot inherit this character's ranks.
  gear = { toolMastery: {} }; // Older save without the new proficiency map initializes lazily on the first qualifying kill.
  slots.weapon = 'fishingspear';
  combatDeps.damageCreature(enemy(), 20);
  assert.equal(gear.weaponFamilyProficiency.polearms.xp, 1.3, 'old saves receive an independent family XP record');
  assert.equal(policy.proficiencyForWeapon('fishingspear').level, 0, 'new character starts at zero despite previous character progress');
  gear.weaponFamilyProficiency.bludgeons = { xp: 'Infinity' };
  assert.equal(policy.proficiencyForFamily('bludgeons').level, 0, 'malformed imported XP cannot fabricate a maximum rank');
  gear = originalCharacterGear;
  slots.weapon = 'dagger';
  combatDeps.damageCreature(enemy(), 20);
  assert.equal(gear.weaponFamilyProficiency.blades.xp, 2.5, 'a dedicated blade earns blade experience only');
  assert.equal(gear.toolMastery.dagger.xp, 2.5, 'a different family begins at its own unboosted rate');
  assert.equal(policy.proficiencyForWeapon('hatchet').level, 1, 'the previous family persists after changing weapons');
  assert.equal(policy.proficiencyForWeapon('dagger').level, 0);
  assert.ok(saves >= 4, 'both XP tracks persist through the existing character gear save');
  const last = policy.getDebug();
  assert.equal(last.weaponFamilyProficiencies.axes.level, 1, 'mobile debug exposes family ranks');
  assert.equal(last.lastKill.family, 'blades', 'debug records the kill weapon family');
}

function testSpecialFinishers() {
  let now = 1000; // Simulated combat clock for timeout and invulnerability assertions.
  let hittable = new Set(); // Controls exactly which targets connect during each authored strike.
  const pending = []; // Staged actions are resolved by the test on demand.
  let damage = []; // Per-target outgoing damage and flags from the production combo executor.
  let sfx = 0; // Counts special-finisher confirmation cues, independently of ordinary weapon impacts.
  const lungeStops = []; // Checks that special reach cannot stop movement on an unqualified bystander.
  const target = id => ({ id, def: { label: id }, x: 10, y: 0, health: 500, areaId: 'test' });
  const a = target('a'), b = target('b'), player = { x: 0, y: 0, angle: 0 };
  let weapon = 'hatchet'; // Weapon ownership can change between combo taps.
  const abilities = {};
  const profile = { characterId: 'test' }; // Real mastery state belongs to the character.
  const runtime = { console, performance: { now: () => now * 1000 }, document: { addEventListener() {} },
    localStorage: { getItem: () => null }, CustomEvent: class {}, };
  runtime.window = runtime;
  runtime.__hobunjiPlayerProfile = profile;
  runtime.AttackPoseTemplates = { poseFor: () => null };
  runtime.ResourceSystem = { spendStamina() {}, getExhaustionSpeed: () => 1, getProneAttackMultiplier: () => 1,
    bleedOut() { return { consumed: 0 }; }, applyTimedDebuff() { return { durationS: 1 }; } };
  runtime.AudioSystem = { playQuickAttackBonusSfx() { sfx++; } };
  runtime.EnchantmentSystem = { getMasteryPowerMultiplier: () => 1 };
  runtime.CombatAttackEvents = { prepare: input => ({ ...input, modifiers: { damage: 1, affliction: 1, footingDamage: 1, knockback: 1, lunge: 1 } }),
    scaleAfflictions: source => source, hit() {} };
  runtime.Combat = { deps: null, abilities: { register(id, def) { abilities[id] = def; } }, isStaggered: () => false,
    meleeHit: (_attacker, enemy, geometry) => hittable.has(enemy) && geometry.rangePx >= (enemy.requiredRangePx || 0), // The weapon's REAL reach must qualify each enemy separately.
    playerMeleeThreat: () => ({ source: 'test' }),
    beginStagedAction(spec) { pending.push(spec); return spec; } };
  runtime.Combat.deps = { player, TILE: 64, currentWeaponKey: () => weapon, currentWeaponDamageType: () => 'sharp',
    toolMasteryLevel: () => 5, weaponDamageTypeForTool: () => 'sharp', spendMotesOfProwess: () => true,
    weaponAbility: () => ({ damage: 20, rangePx: 100, knockbackPxS: 400 }), hostileObjects: new Set([a,b]),
    getCurrentArea: () => 'test', getPlayerMeleeAimPitch: () => 0, clearVegetationInAttackCone: () => 0,
    beginCombatLunge(_distance, _duration, _start, geometry) { lungeStops.push(geometry); }, // Observe the actual movement owner's stop cone.
    triggerWeaponSwingVisual() {}, playWeaponHitSfx() {}, showToast() {}, awardWeaponMasteryXp() {},
    damageCreature(enemy, amount, _x, _y, _knockback, options) {
      damage.push({ target: enemy.id, amount, special: !!options.specialComboFinisher, afflictions: options.afflictionBonuses });
      enemy.health -= amount;
    } };
  vm.createContext(runtime);
  vm.runInContext(source('docs/js/combat/combat-progression.js'), runtime);
  vm.runInContext(source('docs/js/combat/combat-combo.js'), runtime);
  const progression = runtime.CombatProgression;
  assert.ok(progression.choose(weapon, 'swingComboFinisher', 1, 0), 'special mastery is selectable at earned weapon rank');
  assert.equal(progression.getEffects(weapon, 'swingComboFinisher').quickBonusAfflictions.bleedingHealth, 0.5);
  const tree = progression.getTree('swingComboFinisher', 'sharp');
  const option = tree[1].find(o => o.quickBonusInstantEffect?.id === 'bleedout'); // This is a shared Quick Attack scroll unlock, not a new finisher-only item.
  assert.ok(option && option.effectId);
  const items = { ITEM_DEFS: {}, inventoryItems: [], inventory: {} };
  progression.registerItems(items);
  const scroll = progression.itemKey('sharp', 2, option.effectId, 'scroll');
  items.inventory[scroll] = 1;
  assert.ok(progression.readMasteryItem(scroll), 'an existing quick-bonus scroll unlocks the special finisher choice');
  assert.ok(progression.choose(weapon, 'swingComboFinisher', 2, tree[1].findIndex(o => o.effectId === option.effectId)));
  assert.equal(items.inventory[scroll], 0, 'scroll consumption is delegated to the existing literature system');
  const tap = (ability, targets, time) => {
    now = time;
    hittable = new Set(targets);
    abilities[ability].onTap();
    const action = pending.pop();
    assert.ok(action, 'a normal attack should enter the existing staged pipeline');
    action.onStrike();
    action.onComplete();
  };
  const reset = () => { damage = []; a.health = 500; b.health = 500; };
  tap('swingCombo', [a], 1000);
  tap('swingCombo', [a], 1000.5);
  tap('swingCombo', [a,b], 1001);
  assert.deepEqual(damage.slice(-2).map(h => [h.target,h.amount,h.special]), [['a',41,true],['b',27,false]], 'special bonuses apply per enemy; Cleave stays normal on non-qualifying targets');
  assert.ok('bleedingHealth' in damage[2].afflictions);
  assert.ok(!('bleedingHealth' in damage[3].afflictions), 'special afflictions do not leak to other targets');
  assert.equal(sfx, 1, 'one special impact produces one distinct confirmation sound');
  const reachOptionIndex = tree[2].findIndex(o => o.stat?.rangeMul === 0.12); // Uses the original Extended Reach effect from the scroll catalog.
  assert.ok(reachOptionIndex >= 2, 'special reach upgrade must be a learned scroll option');
  const reachScroll = progression.itemKey('sharp', 3, tree[2][reachOptionIndex].effectId, 'scroll');
  items.inventory[reachScroll] = 1;
  assert.ok(progression.readMasteryItem(reachScroll));
  assert.ok(progression.choose(weapon, 'swingComboFinisher', 3, reachOptionIndex));
  reset();
  tap('swingCombo', [a], 1016);
  tap('swingCombo', [a], 1016.5);
  a.requiredRangePx = 73; // Ordinary Cleave has range 69; qualified +12% reach extends it past 73.
  b.requiredRangePx = 73; // A bystander outside the ordinary range must not inherit qualified reach.
  tap('swingCombo', [a,b], 1017);
  delete a.requiredRangePx;
  delete b.requiredRangePx;
  assert.deepEqual(damage.map(h => [h.target, h.special]), [['a', false],['a', false],['a', true]], 'special reach is target-qualified rather than a blanket cone enlargement');
  assert.ok(Math.abs(lungeStops.at(-1).rangePx - 69) < 1e-9, 'lunge stopping must use Cleave’s normal reach, not a bonus radius that includes unqualified enemies');
  reset();
  tap('swingCombo', [a], 1003);
  tap('swingCombo', [], 1003.5);
  tap('swingCombo', [a], 1004);
  assert.equal(damage.at(-1).special, false, 'a missed second swing leaves ordinary Cleave');
  reset();
  tap('swingCombo', [a], 1006);
  tap('swingCombo', [b], 1006.5);
  tap('swingCombo', [a,b], 1007);
  assert.ok(damage.every(h => !h.special), 'two different enemies cannot satisfy the same-target condition');
  reset();
  tap('swingCombo', [a], 1009);
  a.invulnUntil = 1010000;
  tap('swingCombo', [a], 1009.5);
  delete a.invulnUntil;
  tap('swingCombo', [a], 1010);
  assert.equal(damage.at(-1).special, false, 'an iframe dodge does not count as a connected setup hit');
  reset();
  tap('swingCombo', [a], 1012);
  tap('swingCombo', [a], 1012.5);
  tap('swingCombo', [a], 1015);
  assert.equal(damage.at(-1).special, false, 'timeout resets the combo and its hit history');
  reset();
  tap('pokeCombo', [a], 1020);
  tap('pokeCombo', [a], 1020.5);
  tap('pokeCombo', [a], 1021);
  assert.equal(damage.at(-1).special, true, 'the thrusting combo also has a condition-qualified special finisher');
  assert.equal(runtime.Combat.comboData.lastSpecialFinisher.comboId, 'pokeCombo');
  assert.equal(runtime.Combat.comboData.lastSpecialFinisher.specialProcs, 1, 'the in-game mobile diagnostic exposes the earned proc');
  // The production Combat.beginStagedAction may synchronously cancel a player action
  // when CharacterActionLocks reports tools/actions locked. Such cancellations
  // must not strand a busy combo action or credit an opener that never struck.
  const beginNormally = runtime.Combat.beginStagedAction; // Restored after exercising immediate rejection.
  runtime.Combat.beginStagedAction = action => {
    action.onCancel();
    return { cancelled: true, phase: 'done' };
  };
  now = 1030;
  abilities.swingCombo.onTap();
  runtime.Combat.beginStagedAction = beginNormally;
  reset();
  tap('swingCombo', [a], 1030.5);
  assert.equal(damage.length, 1, 'combo must accept input again after immediate action cancellation');
  assert.equal(damage[0].amount, 20, 'cancelled attack cannot advance the next swing to step two');
  assert.equal(damage[0].special, false, 'cancelled attack cannot seed an earned special finisher');
}

(async () => {
  await testFamilyProficiency();
  testSpecialFinishers();
  console.log('weapon-family proficiency and special combo finisher tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

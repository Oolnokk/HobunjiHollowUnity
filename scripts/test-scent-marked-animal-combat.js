'use strict';
// Run: node scripts/test-scent-marked-animal-combat.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {
  console, performance: { now: () => 1000 }, GameRandom: { random: () => 1 },
  CustomEvent: class CustomEvent {}, dispatchEvent() {},
  document: { addEventListener() {} }, Combat: { deps: {} },
};
ctx.window = ctx;
vm.createContext(ctx);
function load(file) { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
load('docs/js/combat/resource-system.js');
load('docs/js/amphibious-fishing.js');
load('docs/js/combat/animal-scent-targeting.js');
load('docs/js/combat/combat-progression.js');
const rs = ctx.ResourceSystem;
const targeting = ctx.AnimalScentTargeting;
assert(rs.AFFLICTIONS.scentMarkedHealth, 'Scent-marked Health is registered');
const approximately = (a, b, msg) => assert(Math.abs(a - b) < 0.15, msg + ': got ' + a + ', expected ' + b);
function actor(extra = {}) {
  const entity = { x: 0, y: 0, areaId: 'forest', health: 100, maxHealth: 100,
    stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100, afflictions: {}, ...extra };
  rs.initEntity(entity);
  return entity;
}
const wildSource = { creatureKey: 'nelk' };
const petSource = { creatureKey: 'voorg', isCompanion: true };
let victim = actor();
rs.addAffliction(victim, 'scentMarkedHealth', 12);
rs.applyDamage(victim, 5, { attacker: wildSource, afflictionBonuses: { bleedingHealth: 0.4 } });
approximately(victim.health, 90, 'wild strike cashes out up to its own damage');
approximately(rs.getAffliction(victim, 'scentMarkedHealth'), 7, 'wild strike spends mark');
approximately(rs.getAffliction(victim, 'bleedingHealth'), 2, 'scent cannot multiply original buildup');

victim = actor();
rs.addAffliction(victim, 'scentMarkedHealth', 8);
rs.applyDamage(victim, 6, { attacker: petSource });
approximately(victim.health, 88, 'animal companion spends scent');
approximately(rs.getAffliction(victim, 'scentMarkedHealth'), 2, 'companion uses limited budget');

victim = actor();
rs.addAffliction(victim, 'scentMarkedHealth', 8);
rs.applyDamage(victim, 6, { fromCompanion: petSource });
approximately(victim.health, 88, 'companion wrapper carries animal identity');

victim = actor();
rs.addAffliction(victim, 'scentMarkedHealth', 8);
rs.applyDamage(victim, 6, { attacker: { creatureKey: 'harlyao', isBandit: true } });
approximately(victim.health, 94, 'humanoid hit does not get animal bonus');
approximately(rs.getAffliction(victim, 'scentMarkedHealth'), 8, 'humanoid does not spend scent');
rs.applyDamage(victim, 0, { attacker: wildSource });
approximately(rs.getAffliction(victim, 'scentMarkedHealth'), 8, 'zero-damage hits do not spend scent');

victim = actor();
rs.addAffliction(victim, 'scentMarkedHealth', 10);
rs.applyDamage(victim, 5, {
  amphibiousFish: true, attacker: { creatureKey: 'gurumahi' },
  afflictionBonuses: { scentMarkedHealth: 0.55 },
});
approximately(victim.health, 90, 'Fish Leap uses the shared scent payout');
approximately(rs.getAffliction(victim, 'scentMarkedHealth'), 7.8, 'Fish Leap builds scent after consuming it');

rs.AFFLICTIONS.__testBlowgunScent = { ...rs.AFFLICTIONS.scentMarkedHealth,
  rangedAliasFor: 'scentMarkedHealth', rangedScale: 40 };
victim = actor();
rs.applyDamage(victim, 2, { afflictionBonuses: { __testBlowgunScent: 0.15 } });
approximately(rs.getAffliction(victim, 'scentMarkedHealth'), 12, 'Bshuakauitl 40x alias builds the real mark');
assert.equal(rs.getAffliction(victim, '__testBlowgunScent'), 0, 'no phantom alias remains');

const player = actor({ id: 'player', x: 20 });
const playerPet = actor({ id: 'ally', isCompanion: true, x: 25 });
const predator = actor({ creatureKey: 'nelk', state: 'chase', homeX: 0, homeY: 0,
  targetPlayer: player, def: { hostile: true, aggroRangePx: 100, leashRangePx: 120 } });
rs.addAffliction(playerPet, 'scentMarkedHealth', 5);
assert.equal(targeting.prioritizeWild(predator, [player], [playerPet], 'forest', () => true), playerPet);
assert.equal(predator.state, 'patrol-chase', 'wild animal changes attack target');
rs.removeAffliction(playerPet, 'scentMarkedHealth', 5);
targeting.prioritizeWild(predator, [player], [playerPet], 'forest', () => true);
assert.equal(predator.targetPlayer, player, 'wild animal restores its earlier opponent');

const enemyPet = actor({ isCompanion: true, banditCompanion: true });
const master = { x: 0, y: 0 };
rs.addAffliction(playerPet, 'scentMarkedHealth', 5);
assert.equal(targeting.prioritizeEnemyCompanion(enemyPet, master, player, [playerPet], 'forest', 100, player), playerPet);
assert.equal(targeting.prioritizeEnemyCompanion(enemyPet, master, player, [playerPet], 'forest', 15, player), player);
const peaceful = actor({ creatureKey: 'puktuk', state: 'idle', homeX: 0, homeY: 0,
  def: { hostile: false, aggroRangePx: 100, leashRangePx: 100 } });
assert.equal(targeting.prioritizeWild(peaceful, [player], [playerPet], 'forest', () => true), null,
  'passive wild animals cannot be provoked solely by a scent');
predator._fleeCooldownUntil = 2000; // Post-flight grace still wins over an attractive mark.
assert.equal(targeting.prioritizeWild(predator, [player], [playerPet], 'forest', () => true), null,
  'scent never bypasses a wild animal\'s post-retreat re-aggro cooldown');

const abilities = ['opportunistJab', 'exhaustCutter', 'backstabFlick', 'mercySpike',
  'swingComboFinisher', 'pokeComboFinisher'];
for (const id of abilities) for (const type of ['sharp', 'blunt'])
  for (const options of ctx.CombatProgression.getTree(id, type))
    assert(options.some(option => option.quickBonusAfflictions?.scentMarkedHealth === 0.55),
      id + '/' + type + ' must offer Scent Brand at every mastery rank');

assert.match(read('docs/js/combat/ranged-weapons.js'), /onlyRangedType: 'blowgun'/);
assert.match(read('docs/js/combat/ranged-weapon-archetypes.js'), /'poisonedHealth', 'scentMarkedHealth'/);
assert.match(read('docs/game.js'), /AnimalScentTargeting\?\.prioritizeWild\?\./);
assert.match(read('docs/game.js'), /AnimalScentTargeting\?\.prioritizeEnemyCompanion\?\./);
assert.match(read('docs/index.html'), /js\/combat\/animal-scent-targeting\.js/);
console.log('scent-marked animal combat tests passed');

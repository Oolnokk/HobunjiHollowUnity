#!/usr/bin/env node
'use strict';
// Headless regression for duration-only Knockdown, prone vulnerability and blunt Quick Attack mastery.
const assert = require('node:assert/strict'); // Tests the shipped runtime and mastery modules, not duplicate gameplay logic.
const fs = require('node:fs'); // Supplies the production scripts and authored loot pool.
const vm = require('node:vm'); // Runs real browser modules with simulated monotonic game time.

function run() {
  let timeMs = 1000; // Monotonic clock advanced manually to test precise effect expiry.
  let transitions = 0; // Counts initial faux-ragdoll launches; repeated applications must not replay them.
  const window = {
    dispatchEvent() {},
    HobunjiKnockdown: { enter: () => { transitions++; } },
    Combat: { deps: { toolMasteryLevel: () => 5, weaponDamageTypeForTool: () => 'blunt', spendMotesOfProwess: () => true } },
    __hobunjiPlayerProfile: { characterId: 'testHero' },
  }; // Shared browser global read by ResourceSystem and CombatProgression.
  const owned = {}; // Owned mastery literature is consumed when a choice becomes unlocked.
  let saved = JSON.stringify({ characters: [{ id: 'testHero' }] }); // Persistent selection state read by CombatProgression.
  const context = {
    window,
    performance: { now: () => timeMs },
    document: { addEventListener() {} },
    localStorage: { getItem: () => saved, setItem: (_key, value) => { saved = value; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  }; // Minimal window, without DOM rendering or console/devtools.
  vm.runInNewContext(fs.readFileSync('docs/js/combat/resource-system.js', 'utf8'), context);
  const resources = window.ResourceSystem; // The real debuff registry, timers, and damage amplification.
  const actor = { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 75, maxFooting: 100, prone: false };
  resources.initEntity(actor);

  assert.equal(resources.TIMED_DEBUFFS.knockdown.durationStacksInstead, true);
  const initial = resources.applyTimedDebuff(actor, 'knockdown', 1, { source: 'test' });
  assert.equal(initial.stacks, 1);
  assert.equal(initial.remainingS, 1);
  assert.equal(transitions, 1, 'first application starts the actual game pose hook');
  assert.equal(actor.footing, 75, 'the debuff does not drain Footing');
  timeMs += 250;
  const extended = resources.applyTimedDebuff(actor, 'knockdown', 1, { stacks: 2, power: 1.5 });
  assert.equal(extended.stacks, 1, 'extra granted stacks become seconds, never visible stacks');
  assert.equal(extended.remainingS, 3.75, '0.75 remaining plus 2 × 1.5 seconds');
  assert.equal(transitions, 1, 'refreshing knockdown cannot replay the launch');
  timeMs += 3751;
  assert.equal(resources.hasTimedDebuff(actor, 'knockdown'), false, 'the cumulative duration expires');
  const reapplied = resources.applyTimedDebuff(actor, 'knockdown', 1);
  assert.equal(reapplied.remainingS, 1);
  assert.equal(transitions, 2, 'reapplying after expiry starts a fresh ragdoll');
  assert.equal(resources.clearTimedDebuff(actor, 'knockdown'), true);
  assert.equal(resources.hasTimedDebuff(actor, 'knockdown'), false);

  const normal = resources.applyTimedDebuff(actor, 'exposed', 12);
  assert.equal(normal.stacks, 1);
  const normalAgain = resources.applyTimedDebuff(actor, 'exposed', 12);
  assert.equal(normalAgain.stacks, 2, 'ordinary debuffs still gain stacks, not duration');
  assert.equal(normalAgain.remainingS, 12);
  assert.equal(resources.getProneAttackMultiplier(actor), 1);
  actor.prone = true;
  actor._temporaryKnockdownProne = true;
  assert.equal(resources.getProneAttackMultiplier(actor), 1.75);
  actor._temporaryKnockdownProne = false;
  assert.equal(resources.getProneAttackMultiplier(actor), 2.5, '0-Footing ragdoll is stronger even while Footing refills');
  assert.equal(resources.applyTimedDebuff({ health: 0 }, 'knockdown', 1), null, 'dead victims are not knocked down');
  assert.equal(resources.applyTimedDebuff({ health: 1, _downed: true }, 'knockdown', 1), null, 'downed victims are protected');

  vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-progression.js', 'utf8'), context);
  const progression = window.CombatProgression; // Actual mastery catalog and per-weapon selection API.
  const id = 'debuff_durationS_1_id_knockdown'; // Stable registered mastery effect ID, also used in the loot schema.
  const catalogEntry = progression.getEffectCatalog().find(item => item.id === id);
  assert.ok(catalogEntry);
  assert.equal(catalogEntry.types.includes('blunt'), true);
  assert.equal(catalogEntry.types.includes('sharp'), false, 'only blunt attacks unlock this option');
  const learning = { ITEM_DEFS: {}, inventoryItems: [], inventory: owned, saveMemberWorldData() {} }; // Registration creates readable inventory items.
  progression.registerItems(learning);
  for (const ability of ['opportunistJab', 'exhaustCutter', 'backstabFlick', 'mercySpike']) {
    const legacyThirdRank = progression.getTree(ability, 'blunt')[2]; // Prior save indexes must retain their original meaning.
    assert.equal(legacyThirdRank[3].quickBonusDebuff.id, 'exposed', ability + ' legacy Exposed index');
    assert.equal(legacyThirdRank[4].quickBonusDebuff.id, 'sapped', ability + ' legacy Sapped index');
    assert.equal(legacyThirdRank[5].quickBonusDebuff.id, 'unsteady', ability + ' legacy Unsteady index');
    for (let rank = 1; rank <= 5; rank++) {
      const row = progression.getTree(ability, 'blunt')[rank - 1];
      assert.equal(row.filter(option => option.effectId === id).length, 1, ability + ' rank ' + rank);
    }
    assert.ok(!progression.getTree(ability, 'sharp').some(row => row.some(option => option.effectId === id)), 'sharp attacks must not gain knockdown');
  }
  for (let rank = 1; rank <= 5; rank++) {
    const key = progression.itemKey('blunt', rank, id, 'tablet');
    owned[key] = 1;
    assert.equal(progression.readMasteryItem(key), true, 'every rank is teachable');
    const index = progression.getTree('opportunistJab', 'blunt')[rank - 1].findIndex(option => option.effectId === id);
    assert.equal(progression.choose('club', 'opportunistJab', rank, index), true, 'knockdown may be assigned repeatedly');
  }
  const effects = progression.getEffects('club', 'opportunistJab').quickBonusDebuffs.filter(effect => effect.id === 'knockdown');
  assert.equal(effects.length, 5, 'five selected mastery ranks contribute five seconds per successful proc');
  assert.equal(effects.reduce((total, entry) => total + entry.durationS, 0), 5);

  const loot = JSON.parse(fs.readFileSync('docs/config/loot/loot-pools.json', 'utf8')).pools; // Checks real learnable sources for every rank.
  for (const [rank, pool] of [[1, 'mastery_ghoul'], [2, 'mastery_ruin_hronal'], [3, 'mastery_ruin_hronal'], [4, 'mastery_final_hronal'], [5, 'mastery_lich_hronal']]) {
    assert.ok(loot[pool].mastery.effects[rank].blunt.includes(id), 'missing rank ' + rank + ' loot source');
  }

  const game = fs.readFileSync('docs/game.js', 'utf8'); // Structural checks for the existing authored ragdoll and shared damage entrypoints.
  assert.match(game, /window\.HobunjiKnockdown = \{ enter: enterTimedKnockdown \}/);
  assert.match(game, /startProneThrow\(entity, isPlayer, facingAngle, direction\)/);
  assert.match(game, /function proneRecoveryReady\(entity\)/);
  assert.ok((game.match(/getProneAttackMultiplier\?\.\(/g) || []).length >= 2, 'player and creature damage paths use shared prone multipliers');
  console.log('Knockdown duration, mastery choices, loot rewards, prone multipliers and live ragdoll wiring: OK');
}
run();

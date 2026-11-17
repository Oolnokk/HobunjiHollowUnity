#!/usr/bin/env node
'use strict';

// Tests the actual eight-tier enemy policy, its call sites, and the shared smith power curve.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // All fixtures use the live repository source, not duplicate tuning tables.
const config = JSON.parse(read('docs/config/bandits/bandit-gang-config.json')); // The authority for rank HP and distance pacing.
const bandit = read('docs/js/combat/combat-bandit.js'); // The runtime consuming both rank and danger.
const bounty = read('docs/js/bounty-board.js'); // The source of danger labels and Spearhead's legacy request flow.
const tasks = read('docs/js/tasks-panel.js'); // Two persistent wanted-poster slots with new reward bands.
const arena = read('docs/js/dev-spawner.js'); // Mobile-friendly tier selector and result diagnostics.
const index = read('docs/index.html'); // Parser-time dependency and cache ordering.
const combatManifest = read('docs/js/bootstrap/classic-groups/combat-enemies.js'); // Script group actually loads BanditCombat.
const editor = read('docs/tools/enemy-loadout-editor/index.html'); // Workshop must expose the full range.

const window = {}; // Browser-compatible policy VM without game initialization.
vm.runInNewContext(read('docs/js/metal-reinforcement.js'), { window });
vm.runInNewContext(read('docs/js/enemy-tier-progression.js'), { window });
const progression = window.EnemyTierProgression;
const metals = ['nativeCopper', 'lowTinBronze', 'tinBronze', 'highTinBronze', 'arsenicalBronze', 'leadedBronze']; // Gameplay's six ordered structural metals.
const metalDefs = Object.fromEntries(metals.map((metal, i) => [metal, {tier: i + 1, label: metal}]));
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
assert.equal(progression.MAX_TIER, 7, 'eight danger tiers, zero-based');
assert.equal(progression.DANGER_LABELS.length, 8, 'eight readable danger names');
assert.equal(config.difficultyTiers.maxTier, 7, 'wilderness camps may actually reach the new maximum');
assert.equal(config.difficultyTiers.tierDistanceTiles, 12, 'danger should take longer to max out than 42 entrance tiles');
const preservedMine = config.legacyMineRankMultipliersByRank; // Mine enemies deliberately use the pre-eight-tier curves.
assert.deepEqual(Array.from(preservedMine.grunt), [0.28, 0.33, 0.4, 0.48], 'mine grunt health progression is not rewritten');
assert.deepEqual(Array.from(preservedMine.lieutenant), [0.52, 0.58, 0.66, 0.74], 'mine lieutenant health progression is not rewritten');
assert.deepEqual(Array.from(preservedMine.captain), [1.28, 1.26, 1.23, 1.2], 'mine captain health progression is not rewritten');
assert.deepEqual(Array.from(preservedMine.flasker), [0.45, 0.52, 0.59, 0.66], 'mine flasker health progression is not rewritten');
assert.equal(progression.clampTier(-8), 0, 'bad negative tier cannot weaken enemies indefinitely');
assert.equal(progression.clampTier(99), 7, 'bad positive tier cannot overlevel enemies');
assert.equal(progression.clampTier(NaN), 0, 'invalid editor input is safe');
assert.equal(progression.dangerBand(3), 'easy');
assert.equal(progression.dangerBand(4), 'hard');
for (const tier of [0,1,2,3,4,5,6,7]) {
  assert.equal(progression.progressionStep(tier), Math.floor(tier / 2), 'gear and mastery improve every second tier');
  for (const rank of ['grunt', 'lieutenant', 'captain', 'flasker']) {
    const raw = config.statMultiplierByRankAndTier[rank]; // An actual authored rank curve from the game.
    assert.equal(raw.length, 8, 'all rank curves include the new subtiers');
    const current = raw[tier] * (1 + tier * config.difficultyTiers.tierStatBonusPerTier);
    if (tier > 0) {
      const previous = raw[tier - 1] * (1 + (tier - 1) * config.difficultyTiers.tierStatBonusPerTier);
      assert(current > previous, `${rank} tier ${tier} health does not fall behind lower tier`);
    }
  }
  const metal = metals[Math.min(5, tier)]; // Gradual equipment power should stay in the player's shared 0.75-1.50 bounds.
  const power = progression.weaponMultiplier(metal, tier, metalDefs, metals);
  assert(power >= 0.75 && power <= 1.50, 'humanoid grades share player bounds');
}
close(progression.weaponMultiplier('nativeCopper', 0, metalDefs, metals), 0.75, 'first bandit copper weapon power');
close(progression.weaponMultiplier('leadedBronze', 7, metalDefs, metals), 1.50, 'highest possible hostile weapon power');
assert.equal(progression.weaponMultiplier('unknown', 7, metalDefs, metals), null, 'unknown metals fall back safely');

// Run the production mastery and metal-weapon sampling functions, not handwritten replicas.
function functionText(name) {
  const start = bandit.indexOf('function ' + name + '('); // Locates the actual procedure in CombatBandit.
  assert(start >= 0, 'Missing production function ' + name);
  const opening = bandit.indexOf('{', bandit.indexOf(')', start)); // Fixed function declarations in this test have no default objects.
  let braces = 0; // Balanced braces isolate the small pure combat helpers.
  for (let i = opening; i < bandit.length; i++) {
    if (bandit[i] === '{') braces++;
    else if (bandit[i] === '}' && --braces === 0) return bandit.slice(start, i + 1);
  }
  assert.fail('Unterminated production function ' + name);
}
const context = {
  window,
  deps: {
    clamp: (value, lower, upper) => Math.min(upper, Math.max(lower, value)),
    rnd: () => 0,
    VERDIGRIS_METAL_KEYS: metals,
    METAL_DEFS: metalDefs,
    HELD_SHAPE_DEFS: {hatchet: {slots:['weapon'], dmgType:'sharp', animStyle:'sweep'}},
    craftedToolItemKey: (shape, metal) => `${shape}_${metal}`,
    metalDmgMultiplier: key => 0.85 + 0.05 * (metalDefs[key]?.tier || 0)
  },
  configuredWeaponMetalKey: cfg => typeof cfg?.weaponMetalKey === 'string' && metalDefs[cfg.weaponMetalKey] ? cfg.weaponMetalKey : null // Direct seam to the production config override used by special humanoids.
};
vm.createContext(context);
vm.runInContext(['banditMasteryFor','banditWeaponShapeKeys','rollBanditWeaponMetalKey','banditWeaponFor'].map(functionText).join('\n'), context);
for (let tier = 0; tier <= 7; tier++) {
  assert.equal(vm.runInContext(`banditMasteryFor(globalThis.config, 'grunt', ${tier})`, Object.assign(context, {config})), Math.floor(tier / 2), 'real mastery pacing');
  const weapon = vm.runInContext(`banditWeaponFor(globalThis.config, 'grunt', ${tier})`, context);
  close(weapon.dmgMultiplier, progression.weaponMultiplier(weapon.metalKey, tier, metalDefs, metals), 'real bandit grade damage');
}
const mineConfig = {...config, _preserveMineEnemyTiers:true}; // Mine Ghouls retain their separate ten-floor level sequence.
context.mineConfig = mineConfig;
assert.equal(vm.runInContext("banditMasteryFor(mineConfig,'grunt',10)",context), 5, 'deep-mine Ghoul mastery remains maxed');
close(vm.runInContext("banditWeaponFor(mineConfig,'grunt',10).dmgMultiplier",context), 0.9, 'Ghoul weapons retain the old authored power calculation');
assert.match(bandit, /opts\.extra\?\.isMineGhoul === true/, 'mine and bandit tiers are separated before scaling');
assert.match(bandit, /tier = mineEnemy \? Math\.max\(1, Math\.min\(10,/, 'ten-tier floor enemies must not clamp to seven');
assert.match(bandit, /tier \* \(cfg\?\._preserveMineEnemyTiers \? 0\.12 :/, 'old mine stat progression is unaffected');
assert.match(bandit, /cfg\?\.legacyMineRankMultipliersByRank\?\.\[rank\]/, 'mine uses the original authored rank arrays, not the new bandit arrays');
assert.match(bandit, /cfg\?\._preserveMineEnemyTiers \? Math\.min\(4, tier\)/, 'mine flaskers cannot exceed their original potency tier 4');
const oldMineHp = (rank, tier) => Math.round(70 * preservedMine[rank][Math.min(3, tier)] * (1 + tier * 0.12)); // Exact historic health calibration.
assert.equal(oldMineHp('grunt', 10), 74, 'deepest grunt health remains calibrated');
assert.equal(oldMineHp('captain', 10), 185, 'deepest captain health remains calibrated');
assert.match(bandit, /weaponMetalPowerMultiplier: weapon\.dmgMultiplier/, 'live enemy debug reports actual graded power');
assert.match(arena, /metalPower=\$\{creature\.def\.weaponMetalPowerMultiplier/, 'mobile arena shows power without devtools');
assert.match(arena, /MAX_TIER \?\? 7/, 'arena can select tier seven');
assert.match(tasks, /\[0, 1, 2, 3\]/, 'easy wanted-poster slot spans the first four tiers');
assert.match(tasks, /\[4, 5, 6, 7\]/, 'hard wanted-poster slot spans the final four tiers');
assert.match(tasks, /posting\.offerSlot \|\| _bountySlotForTier/, 'old saved bounty offer slots are respected');
assert.match(bounty, /Dreaded/, 'new peak danger has an authored name');
assert.match(editor, /<option value="7">Tier 7<\/option>/, 'workshop can preview eight danger levels');
assert(index.indexOf('enemy-tier-progression.js') < index.indexOf('bounty-board.js'), 'enemy policy must load before bounty runtime');
assert(index.indexOf('metal-reinforcement.js') < index.indexOf('game.js?v'), 'smith policy must load before game boot');
assert.match(combatManifest, /combat-bandit\.js\?v=[A-Za-z0-9_-]+/, 'new combat changes cannot be hidden by cached old build');
console.log('Enemy progression passed: 8 tiers, 4 rank curves, shared .75-1.50 weapon grades, 10-level Ghoul compatibility, bounty and arena UI.');

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
    const raw = config.statMultiplierByRankAndTier[rank]; // The original attack and Stamina rank curve, unchanged by the new HP-only policy.
    const healthRaw = config.healthMultiplierByRankAndTier?.[rank] || raw; // Weak humanoids read the separate health curve; captains retain the old curve.
    assert.equal(raw.length, 8, 'all offensive rank curves include every danger tier');
    assert.equal(healthRaw.length, 8, 'all Health rank curves include every danger tier');
    const current = raw[tier] * (1 + tier * config.difficultyTiers.tierStatBonusPerTier); // Actual offensive rank multiplier for the tier.
    const currentHealth = healthRaw[tier] * (1 + tier * config.difficultyTiers.tierStatBonusPerTier); // Separate effective Health multiplier for the same tier.
    if (tier > 0) {
      const previous = raw[tier - 1] * (1 + (tier - 1) * config.difficultyTiers.tierStatBonusPerTier);
      const previousHealth = healthRaw[tier - 1] * (1 + (tier - 1) * config.difficultyTiers.tierStatBonusPerTier); // Protects Health-only progress at each successive tier.
      assert(current > previous, `${rank} tier ${tier} attack/Stamina curve must progress`);
      assert(currentHealth > previousHealth, `${rank} tier ${tier} Health curve must progress`);
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

// Exercise the real enemy definition factory: scaled HP must not leave a hostile
// with less Stamina than its own opening attack costs (Omgurku-vs-Porakaneki used to stall forever here).
const factoryConstants = [ // Read the actual combat tuning instead of mirroring numeric values in this fixture.
  'BANDIT_BASE_MAX_HEALTH', 'BANDIT_BASE_MAX_STAMINA', 'BANDIT_BASE_ATTACK_DAMAGE',
  'BANDIT_MASTERY_DAMAGE_PER_LEVEL', 'BANDIT_ATTACK_RANGE_TILES',
  'BANDIT_ATTACK_HALF_CONE_DEG', 'BANDIT_ATTACK_STAMINA_COST',
  'BANDIT_ATTACK_COOLDOWN_S_CAPTAIN', 'BANDIT_ATTACK_COOLDOWN_S_OTHER',
];
for (const name of factoryConstants) {
  const value = bandit.match(new RegExp('(?:const|let) ' + name + ' = ([0-9.]+);')); // Static fallback values used by the spawn factory.
  assert(value, 'Missing combat tuning: ' + name);
  context[name] = Number(value[1]);
}
context.BANDIT_RANK_LABEL = { grunt: 'Bandit', lieutenant: 'Lieutenant', captain: 'Captain', flasker: 'Flasker' };
context.deps.TILE = 64;
context.banditRangedWeaponFor = () => null;
context.rollBanditFlaskLoadout = () => [];
context.banditFlaskerTuning = () => null;
context.banditAbilityLoadout = () => ({ tap1: 'combo', tap2: null, hold1: null, hold2: null });
context.weaponEfficiency = 1; // Altered below to verify heavy, light, and malformed weapon efficiency safely.
window.WeaponShapeStats = { forShape: () => ({ power: 1, speed: 1, range: 1, efficiency: context.weaponEfficiency }) };
vm.runInContext(functionText('makeBanditDef'), context);
function actualEnemyDef(cfg, rank, tier, efficiency = 1) {
  context.scopedConfig = cfg; // The VM evaluates the production factory against exactly this authored config.
  context.weaponEfficiency = efficiency; // Mock only weapon shape coefficients, not any stamina math.
  context.testRank = rank;
  context.testTier = tier;
  return vm.runInContext('makeBanditDef(scopedConfig, testRank, testTier, 0, 1)', context);
}
for (const rank of ['grunt', 'lieutenant', 'captain', 'flasker']) {
  for (let tier = 0; tier <= 7; tier++) {
    for (const efficiency of [0.65, 1, 1.4, 0]) {
      const fighter = actualEnemyDef(config, rank, tier, efficiency); // All enemy tiers must be capable of starting combat.
      assert(Number.isFinite(fighter.attackStaminaCost) && fighter.attackStaminaCost > 0, 'bad efficiency cannot create NaN or infinite cost');
      assert(fighter.maxStamina >= fighter.attackStaminaCost * 2,
        rank + ' tier ' + tier + ', efficiency ' + efficiency + ': cannot pay for two opening attacks');
      assert(fighter.maxHealth > 0 && Number.isFinite(fighter.maxHealth), 'stamina fix must not corrupt health scaling');
    }
  }
}
assert.equal(actualEnemyDef(config, 'grunt', 0).maxHealth, 30, 'tier-zero grunt HP leaves room for repeated hits and knockback');
assert.equal(actualEnemyDef(config, 'lieutenant', 0).maxHealth, 50, 'tier-zero lieutenant HP extends combat without increasing damage');
assert.equal(actualEnemyDef(config, 'flasker', 0).maxHealth, 43, 'tier-zero flasker gains Health without becoming a lieutenant');
assert.equal(actualEnemyDef(config, 'captain', 0).maxHealth, 90, 'captain durability is unchanged');
const originalHumanoidStats = { ...config, healthMultiplierByRankAndTier: null }; // Factory comparison disables only the new HP override to catch accidental attack/Stamina amplification.
for (let tier = 0; tier <= 7; tier++) {
  for (const rank of ['grunt', 'flasker', 'lieutenant', 'captain']) {
    const actual = actualEnemyDef(config, rank, tier); // Full production factory with new Health-only multiplier.
    const before = actualEnemyDef(originalHumanoidStats, rank, tier); // Same factory, original combined offensive/stamina curve.
    const healthCurve = config.healthMultiplierByRankAndTier?.[rank] || config.statMultiplierByRankAndTier[rank]; // Captains intentionally use their original tier curve.
    const expectedHp = Math.round(context.BANDIT_BASE_MAX_HEALTH * healthCurve[tier] * (1 + tier * config.difficultyTiers.tierStatBonusPerTier)); // Verifies the authored HP for every rank and tier.
    assert.equal(actual.maxHealth, expectedHp, rank + ' tier ' + tier + ' health-only curve is applied');
    assert.equal(actual.attackDamage, before.attackDamage, rank + ' tier ' + tier + ' attack must not increase');
    assert.equal(actual.maxStamina, before.maxStamina, rank + ' tier ' + tier + ' Stamina must not increase');
    assert.equal(actual.attackCooldownS, before.attackCooldownS, rank + ' tier ' + tier + ' attack speed must not change');
    assert.equal(actual.chaseSpeed, before.chaseSpeed, rank + ' tier ' + tier + ' pursuit speed must not change');
    if (rank === 'captain') assert.equal(actual.maxHealth, before.maxHealth, 'captain health remains untouched');
    if (rank !== 'captain') assert(actual.maxHealth > before.maxHealth, rank + ' tier ' + tier + ' must become more durable');
  }
  const health = rank => actualEnemyDef(config, rank, tier).maxHealth; // Checks that each danger tier preserves the intended rank hierarchy.
  assert(health('grunt') < health('flasker') && health('flasker') < health('lieutenant') && health('lieutenant') < health('captain'), 'humanoid HP hierarchy must remain intact at tier ' + tier);
}

const originalMineStamina = Math.round(context.BANDIT_BASE_MAX_STAMINA * preservedMine.grunt[1] * (1 + 0.12)); // Existing Ghoul grunt capacity before new bandit tiers.
const mineBaseline = actualEnemyDef({ ...config, _preserveMineEnemyTiers: true }, 'grunt', 1);
assert.equal(mineBaseline.maxStamina, originalMineStamina, 'mine stamina stays historically calibrated when sufficient for one attack');
assert.equal(mineBaseline.maxHealth, Math.round(context.BANDIT_BASE_MAX_HEALTH * preservedMine.grunt[1] * (1 + 0.12)), 'mine Ghouls ignore the new wilderness HP curve');
const originalMineStats = { ...originalHumanoidStats, _preserveMineEnemyTiers: true }; // Compares the new live factory against exactly the old mine policy, including every rank.
for (const rank of ['grunt', 'flasker', 'lieutenant', 'captain']) {
  for (const depth of [1, 3, 7, 10]) {
    const now = actualEnemyDef({ ...config, _preserveMineEnemyTiers: true }, rank, depth); // Real Ghoul definition with the new Health table present.
    const before = actualEnemyDef(originalMineStats, rank, depth); // Same Ghoul without the optional Health-only table.
    assert.equal(now.maxHealth, before.maxHealth, rank + ' mine depth ' + depth + ' Health must remain unchanged');
    assert.equal(now.attackDamage, before.attackDamage, rank + ' mine depth ' + depth + ' attack must remain unchanged');
    assert.equal(now.maxStamina, before.maxStamina, rank + ' mine depth ' + depth + ' Stamina must remain unchanged');
  }
}
const mineHeavy = actualEnemyDef({ ...config, _preserveMineEnemyTiers: true }, 'grunt', 1, 0.5);
assert(mineHeavy.maxStamina >= mineHeavy.attackStaminaCost, 'even a Ghoul with an inefficient weapon cannot be permanently unable to attack');

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

const workshopPreview = read('docs/tools/enemy-loadout-editor/preview.js'); // Workshop has its own script loader, separate from the actual game.
const workshopApp = read('docs/tools/enemy-loadout-editor/app.js'); // Verify the workshop module chain is versioned.
function cacheVersion(sourceText, pattern, label) {
  const found = sourceText.match(pattern); // Match current URLs without pinning any exact cache token.
  assert(found?.[1], label + ' must have a versioned URL');
  return found[1];
}
for (const name of ['combat-bandit', 'combat-lich']) {
  const pattern = new RegExp(name + '\\.js\\?v=([A-Za-z0-9_-]+)'); // The game and workshop must use the same combat source.
  assert.equal(cacheVersion(workshopPreview, pattern, 'workshop ' + name), cacheVersion(combatManifest, pattern, 'game ' + name), name + ' workshop must not use stale combat code');
}
assert.match(workshopApp, /\.\/preview\.js\?v=[A-Za-z0-9_-]+/, 'workshop app imports its versioned preview');
assert.match(editor, /tools\/enemy-loadout-editor\/app\.js\?v=[A-Za-z0-9_-]+/, 'workshop document imports its versioned app');

console.log('Enemy progression passed: 8 tiers, 4 rank curves, shared .75-1.50 weapon grades, 10-level Ghoul compatibility, bounty and arena UI.');

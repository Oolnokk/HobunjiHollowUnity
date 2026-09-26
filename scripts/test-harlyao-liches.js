const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const lichSource = fs.readFileSync(path.join(root, 'docs/js/combat/combat-lich.js'), 'utf8');
const resourceSource = fs.readFileSync(path.join(root, 'docs/js/combat/resource-system.js'), 'utf8');
const devSpawnerSource = fs.readFileSync(path.join(root, 'docs/js/dev-spawner.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const skeletonSpecies = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/species/harlyao-skeleton.json'), 'utf8'));
const cosmeticsIndex = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/cosmetics/index.json'), 'utf8'));
const itemIndex = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/items/item-index.json'), 'utf8'));
const raggedHood = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/cosmetics/ragged_hood.json'), 'utf8'));

assert.equal(raggedHood.slot, 'hood');
assert.equal(raggedHood.meta.name, 'Ragged Hood');
for (const [variantId, variant] of Object.entries(raggedHood.speciesVariants)) {
  const layers = variant.parts?.head?.layers;
  assert(layers?.front?.image?.url, `${variantId} needs front ragged-hood art`);
  assert(layers?.back?.image?.url, `${variantId} needs rear ragged-hood art`);
  for (const layerName of ['front', 'back']) {
    const repoPath = layers[layerName].image.url.replace(/^\.\//, '');
    assert(fs.existsSync(path.join(root, 'docs', repoPath)), `${variantId} missing ${layerName} asset ${repoPath}`);
    assert.deepEqual(layers[layerName].image.colors, ['A'], `${variantId} ${layerName} must share dye A`);
  }
}
assert(raggedHood.speciesVariants['engh-sho_male']);
assert(raggedHood.speciesVariants['engh-sho_female']);
assert(cosmeticsIndex.entries.some(entry => entry.id === 'ragged_hood' && entry.path === './ragged_hood.json'));
assert(itemIndex['cosmetic:ragged_hood']);
for (const gender of ['male', 'female']) assert(skeletonSpecies[gender].allowedCosmetics.includes('ragged_hood'));

let randomValue = 0;
let nowMs = 1000;
let currentArea = 'map_dev_arena';
let damageApplied = 0;
const player = { id: 'player', areaId: 'map_dev_arena', x: 64, y: 0, health: 100, maxHealth: 100, def: {} };
const hostileObjects = new Set();
const ResourceSystem = {
  getAffliction(entity, id) { return Number(entity.afflictions?.[id]) || 0; },
  addAffliction(entity, id, amount) {
    entity.afflictions ||= {};
    const before = Number(entity.afflictions[id]) || 0;
    entity.afflictions[id] = before + amount;
    return amount;
  },
  removeAffliction(entity, id, amount) {
    entity.afflictions ||= {};
    const before = Number(entity.afflictions[id]) || 0;
    const removed = Math.min(before, Math.max(0, amount));
    entity.afflictions[id] = before - removed;
    return removed;
  },
  applyHealthAfflictionDamage(entity, amount) {
    entity.health -= amount;
    damageApplied += amount;
    return amount;
  },
};
let capturedMakeArgs = null;
const windowObject = {
  GameRandom: { random: () => randomValue },
  ResourceSystem,
  BanditCombat: {
    init() {},
    updateCombatAI() { return { handled: false }; },
    async loadGangConfig() { return { speciesWeights: {} }; },
    async makeEntity(...args) {
      capturedMakeArgs = args;
      return {
        id: 'made-lich', name: args[5]?.nameOverride || 'Lich',
        x: args[3], y: args[4], areaId: 'map_dev_arena', health: 100,
        def: { moveSpeed: 100, chaseSpeed: 140 },
        rosterRecord: args[5]?.rosterOverride,
        scene: { add() {} },
      };
    },
  },
  RangedWeapons: {
    update() {},
    actorHitbox() { return null; },
  },
  Combat: { getMovementSpeedMul: () => 1 },
  NearbyVolumeCollision: { segmentHit: () => null },
  MinionCombat: { makeEntity: async () => null },
};
const context = vm.createContext({
  window: windowObject,
  console,
  performance: { now: () => nowMs },
  Math, Number, String, Boolean, Object, Array, Set, Map, WeakMap, JSON, Promise,
});
vm.runInContext(lichSource, context, { filename: 'combat-lich.js' });
const api = windowObject.HarlyaoLichCombat;
assert(api, 'HarlyaoLichCombat global must install');
assert.equal(api.CLASS_ID, 'harlyao-lich');
assert.deepEqual(Array.from(api.TYPE_ORDER), ['tothal', 'hronal', 'kanthic']);

windowObject.BanditCombat.init({
  getCurrentArea: () => currentArea,
  player,
  hostileObjects,
  TILE: 64,
  moveCreatureToward() { return false; },
  damagePlayer() {},
  damageCreature() {},
  tileSurfaceYInArea: () => 0,
});

const allowedTothal = /dye:CLOTH:(pure|muted|dusty|dark_muted)_(green_blue|blue|blue_indigo)$/;
const allowedHronal = /dye:CLOTH:(pure|muted|dusty|dark_muted)_(red|red_orange|orange|yellow_orange|yellow)$/;
const allowedKanthic = /dye:CLOTH:(?:(?:pure|muted|dusty|dark_muted)_(?:indigo|indigo_violet|violet)|white|gray|charcoal)$/;
for (let i = 0; i <= 100; i++) {
  randomValue = Math.min(0.999999, i / 100);
  assert(allowedTothal.test(api.rollDye('tothal')), 'Tothal dye escaped green-blue through blue-indigo');
  assert(allowedHronal.test(api.rollDye('hronal')), 'Hronal dye escaped red through yellow');
  const kanthic = api.rollDye('kanthic');
  assert(allowedKanthic.test(kanthic), 'Kanthic dye escaped indigo/violet + allowed neutrals');
  assert(!/(brown|cream|silver)/.test(kanthic), 'Kanthic must exclude brown, cream, and silver');
}
for (const type of api.TYPE_ORDER) {
  randomValue = 0.37;
  const roster = api.rosterFor(type, 'female');
  assert.equal(roster.appearance.speciesId, 'harlyao-skeleton');
  assert.deepEqual(Array.from(roster.equippedCosmetics), ['ragged_hood', 'tankan_bodywrap']);
  assert.equal(roster.appliedDyes.HOOD, roster.appliedDyes.CLOTH, `${type} hood and wrap must share one dye`);
}

assert(api.TYPE_DEFS.tothal.projectile.knockbackPxS >= 900);
assert(api.TYPE_DEFS.tothal.projectile.footingDamageMultiplier >= 5);
assert(api.TYPE_DEFS.tothal.projectile.frostbittenFooting > 0);
assert(api.TYPE_DEFS.hronal.projectile.burningHealth > 0);
assert(api.TYPE_DEFS.hronal.projectile.shatteredStamina > 0);
assert(api.TYPE_DEFS.kanthic.projectile.gravityWorldS2 > api.TYPE_DEFS.hronal.projectile.gravityWorldS2 * 4, 'Kanthic blob needs unusually heavy dropoff');
assert(api.TYPE_DEFS.kanthic.projectile.speedPxS > api.TYPE_DEFS.hronal.projectile.speedPxS, 'Kanthic blob needs the quick initial flight');
assert(api.TYPE_DEFS.kanthic.projectile.entrancedHealth > 0);

randomValue = 0.2;
const slowBefore = windowObject.Combat.getMovementSpeedMul();
api.addGooSlow(player);
const slowAfter = windowObject.Combat.getMovementSpeedMul();
assert.equal(slowBefore, 1);
assert(slowAfter < 1 && slowAfter > 0.8, 'one Kanthic stack should slow but not root the player');
api.addGooSlow(player);
assert(windowObject.Combat.getMovementSpeedMul() < slowAfter, 'goo slow stacks must compound');

const lichA = { id: 'lich-a', name: 'Kanthic Lich A', areaId: 'map_dev_arena', x: 0, y: 0, health: 100, _lichCommand: 'approach' };
const lichB = { id: 'lich-b', name: 'Kanthic Lich B', areaId: 'map_dev_arena', x: 128, y: 0, health: 100, _lichCommand: 'flee' };
hostileObjects.add(lichA);
hostileObjects.add(lichB);
player.afflictions = { entrancedHealth: 0 };
player.x = 64; player.y = 0; player.health = 100;
api.applyEntranced(player, lichA, 20);
assert.equal(player._entrancedCommandState.source, lichA);
api.applyEntranced(player, lichB, 4);
assert.equal(player._entrancedCommandState.source, lichB, 'latest Entranced applicant must become referential target');

player.afflictions.entrancedHealth = 20;
api.applyEntranced(player, lichA, 0.1);
player.afflictions.entrancedHealth = 20;
player.x = 80; // Away from lichA while commanded to approach: punished.
const healthBeforeWrongMove = player.health;
windowObject.RangedWeapons.update(0.1);
assert(player.health < healthBeforeWrongMove, 'moving against Approach must convert Entranced buildup into Health damage');
assert(player.afflictions.entrancedHealth < 20);
assert(damageApplied > 0);

const healthBeforeObey = player.health;
const entrancedBeforeObey = player.afflictions.entrancedHealth;
player.x = 70; // Toward lichA while commanded to approach: fast recovery, no punishment.
windowObject.RangedWeapons.update(0.1);
assert.equal(player.health, healthBeforeObey, 'obeying Entranced command must not deal Health damage');
assert(player.afflictions.entrancedHealth < entrancedBeforeObey, 'obeying Entranced command must recover buildup');

currentArea = 'farm';
const offArena = await api.makeEntity({ type: 'tothal', x: 10, y: 10 });
assert.equal(offArena, null, 'lich constructor must refuse non-Testing-Arena areas');
currentArea = 'map_dev_arena';
const made = await api.makeEntity({ type: 'hronal', tier: 2, x: 10, y: 20, gender: 'male' });
assert(made && capturedMakeArgs, 'arena lich should delegate to shared humanoid constructor');
assert.equal(capturedMakeArgs[5].enemyClass, 'harlyao-lich');
assert.equal(capturedMakeArgs[5].rosterOverride.appliedDyes.HOOD, capturedMakeArgs[5].rosterOverride.appliedDyes.CLOTH);

const resourceContext = vm.createContext({ window: {}, console, performance: { now: () => 1000 }, Math, Number, String, Boolean, Object, Array, Set, Map, WeakMap, JSON });
vm.runInContext(resourceSource, resourceContext, { filename: 'resource-system.js' });
const realRS = resourceContext.window.ResourceSystem;
assert.equal(realRS.AFFLICTIONS.frostbittenFooting.resource, 'footing');
assert.equal(realRS.AFFLICTIONS.frostbittenFooting.family, 'control');
assert.equal(realRS.AFFLICTIONS.frostbittenFooting.recovers, true);
assert.equal(realRS.AFFLICTIONS.entrancedHealth.resource, 'health');
assert.equal(realRS.AFFLICTIONS.entrancedHealth.family, 'control');
assert.equal(realRS.AFFLICTIONS.entrancedHealth.recovers, false, 'Entranced directional recovery is owned by lich runtime');
assert.match(resourceSource, /frostbittenRegenMul = 1 - frostbittenFraction \* 0\.8/);

for (const key of ['tothal', 'hronal', 'kanthic']) {
  assert(devSpawnerSource.includes(`harlyao-lich:${key}`), `Testing Arena must expose ${key} lich button`);
}
assert.match(devSpawnerSource, /startsWith\('harlyao-lich:'\)/);
assert(indexSource.includes('js/combat/combat-lich.js?v=20260926lich1'));
assert(indexSource.includes('js/combat/resource-system.js?v=20260926lich1'));

console.log('Harlyao Lich regression checks passed.');

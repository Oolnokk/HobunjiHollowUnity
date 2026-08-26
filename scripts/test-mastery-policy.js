const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

(async () => {
  let clock = 1000;
  const events = [];
  const popups = [];
  const toasts = [];
  const deathRecoveries = []; // Used to verify lethal exceptions still complete corpse conversion.
  const gear = { tools: {}, toolMastery: {} };
  const equipmentSlots = { hoe: 'bronzehoe', shovel: 'pickshovel', weapon: 'hatchet', ranged: 'crossbow' };
  const toolDefs = {
    bronzehoe: { label: 'Bronze Hoe', slots: ['hoe'] },
    pickshovel: { label: 'Pick-Shovel', slots: ['shovel','pick','weapon'] },
    hatchet: { label: 'Hatchet', slots: ['axe','weapon'] },
    sword: { label: 'Sword', slots: ['weapon'] },
    crossbow: { label: 'Crossbow', slots: ['ranged'] },
  };
  const itemDefs = {
    heftroot: { label: 'Heftroot', sellPrice: 25 },
    bar_nativeCopper: { label: 'Native Copper Bar', sellPrice: 8 },
  };
  const grid = [[{type:'normal'},{type:'normal'},{type:'normal'}],[{type:'normal'},{type:'normal'},{type:'normal'}],[{type:'normal'},{type:'normal'},{type:'normal'}]];
  const placement = { col:1, row:2, found:false, loot:{gold:25} };
  const treasurePersist = new Map([['zoneA',{week:1, placements:[placement]}]]);
  const zoneScenes = new Map([['zoneA',{grid}]]);

  const context = {
    console,
    Math,
    Date,
    Proxy,
    WeakMap,
    WeakSet,
    Set,
    Map,
    Object,
    Array,
    Number,
    String,
    Promise,
    performance: { now: () => clock },
    queueMicrotask,
    CustomEvent: class CustomEvent { constructor(type, init={}) { this.type=type; this.detail=init.detail; } },
    document: { readyState: 'complete', addEventListener() {} },
    window: null,
  };
  context.window = context;
  context.dispatchEvent = event => events.push(event);

  context.WorldPopupText = {
    showChange(kind, amount, options) { popups.push({kind, amount, options}); },
    queueReward(kind, text) { popups.push({kind, text}); },
  };
  context.EquipmentPanel = {
    init(deps) { this.deps = deps; },
  };
  context.CookingSystem = { init(deps) { this.deps = deps; } };
  context.Fishing = { init(deps) { this.deps = deps; } };
  context.SkillSystem = {
    XP_GAINS: {crop:6},
    award(skillId, amount, reason) { this.last = {skillId, amount, reason}; return amount; },
  };
  context.WildTreasure = {
    init(deps) { this.deps = deps; },
    ensureZone() {},
    syncZoneInteractivity() {},
  };
  context.Combat = {
    init(deps) { this._deps = deps; },
    update() {},
    get deps() { return this._deps; },
  };
  context.CreatureDeath = {
    recover(enemy, fromX, fromY, error) {
      enemy.state = 'corpse';
      deathRecoveries.push({ enemy, fromX, fromY, error });
      return true;
    },
  };

  vm.createContext(context);
  const policyPath = path.join(__dirname, '..', 'docs', 'js', 'mastery-policy.js'); // Used to test the repository copy rather than an inline fixture.
  vm.runInContext(fs.readFileSync(policyPath, 'utf8'), context, { filename: policyPath });

  const equipmentDeps = {
    getGearInventory: () => gear,
    equipmentSlots,
    TOOL_ITEM_DEFS: toolDefs,
    saveGearInventory() {},
    showToast(msg, ok) { toasts.push({msg, ok}); },
    devBumpToolMasteryLevel(itemKey) {
      gear.toolMastery[itemKey] ||= {xp:0};
      gear.toolMastery[itemKey].xp += 40;
    },
  };
  context.EquipmentPanel.init(equipmentDeps);
  context.CookingSystem.init({ ITEM_DEFS: itemDefs });
  let qualityCalls = 0;
  const fishingDeps = { recordItemQuality() { qualityCalls++; } };
  context.Fishing.init(fishingDeps);
  const treasureDeps = {
    _zoneTreasurePersist: treasurePersist,
    _zoneScenes: zoneScenes,
    TileType: { TRENCH: 'trench' },
    metalBarItemKey: key => `bar_${key}`,
    METAL_DEFS: { nativeCopper:{tier:1} },
    ITEM_DEFS: itemDefs,
  };
  context.WildTreasure.init(treasureDeps);

  function damageCreature(enemy, damage) {
    enemy.health = Math.max(0, enemy.health - damage);
    if (enemy.throwAfterLethal && enemy.health <= 0) throw new Error('simulated post-lethal reward failure');
    return damage;
  }
  const combatDeps = {
    equipmentSlots,
    TOOL_ITEM_DEFS: toolDefs,
    gearInventory: () => gear,
    currentWeaponKey: () => equipmentSlots.weapon,
    getEquippedRangedKey: () => equipmentSlots.ranged,
    hostileObjects: new Set(),
    companionObjects: new Set(),
    damageCreature,
    awardWeaponMasteryXp() {
      const k=equipmentSlots.weapon; gear.toolMastery[k] ||= {xp:0}; gear.toolMastery[k].xp += 5;
    },
    awardRangedMastery(itemKey) {
      gear.toolMastery[itemKey] ||= {xp:0}; gear.toolMastery[itemKey].xp += 5;
    },
  };
  context.Combat.init(combatDeps);

  await Promise.resolve(); // allow policy arm microtask
  const policy = context.HobunjiMasteryPolicy;
  assert.equal(policy.getDebug().armed, true);

  // Generic/legacy positive writes are rejected once armed.
  gear.toolMastery.hatchet = {xp:0};
  gear.toolMastery.hatchet.xp += 5;
  assert.equal(gear.toolMastery.hatchet.xp, 0, 'legacy mastery write must be blocked');

  // Old per-hit melee callback is swallowed, independent of direct guard.
  combatDeps.awardWeaponMasteryXp();
  assert.equal(gear.toolMastery.hatchet.xp, 0, 'old melee hit award must be suppressed');

  // Nonlethal melee hit gets nothing.
  const tank = { health: 60, def:{label:'Tank',health:60,damage:8} };
  combatDeps.damageCreature(tank, 10, 0, 0, 0, {});
  assert.equal(gear.toolMastery.hatchet.xp, 0, 'nonlethal melee hit must get no XP');

  // Lethal dual-use melee tool gets difficulty-scaled base rate (1.3 here).
  const grehlr = { health: 10, def:{label:'Grehlr',health:60,damage:8} };
  combatDeps.damageCreature(grehlr, 20, 0, 0, 0, {});
  assert.equal(gear.toolMastery.hatchet.xp, 1.3, 'dual-use melee kill should get base kill XP');

  // Weapon-only melee gets double.
  equipmentSlots.weapon = 'sword';
  gear.toolMastery.sword = {xp:0};
  const bandit = { health: 10, def:{label:'Bandit',health:60,damage:8} };
  combatDeps.damageCreature(bandit, 20, 0, 0, 0, {});
  assert.equal(gear.toolMastery.sword.xp, 2.5, 'weapon-only melee kill should get double XP');

  // A post-lethal exception must not leave the target red/frozen between
  // the living registry and corpse registry.
  const interrupted = { id:'interrupted-wolf', health:10, throwAfterLethal:true, def:{label:'Gar-wolf',health:60,damage:8} };
  combatDeps.hostileObjects.add(interrupted);
  assert.doesNotThrow(() => combatDeps.damageCreature(interrupted, 20, 7, 9, 0, {}));
  assert.equal(interrupted.state, 'corpse', 'interrupted lethal transition should be recovered as a corpse');
  assert.equal(combatDeps.hostileObjects.has(interrupted), false, 'recovered corpse must leave the hostile registry');
  assert.equal(deathRecoveries.length, 1, 'death recovery should run exactly once');
  assert.equal(policy.getDebug().lastDeathRecovery.recovered, true, 'mobile debug snapshot should expose the recovery');

  // Ranged nonlethal + legacy callback gets nothing.
  gear.toolMastery.crossbow = {xp:0};
  const rangedTank = { health:60, def:{label:'Ranged Tank',health:60,damage:8} };
  combatDeps.damageCreature(rangedTank, 10, 0, 0, 0, {ranged:true});
  combatDeps.awardRangedMastery('crossbow');
  assert.equal(gear.toolMastery.crossbow.xp, 0, 'nonlethal ranged hit must get no XP');

  // Lethal ranged uses exact itemKey and double combat rate.
  const target = { health:10, def:{label:'Target',health:60,damage:8} };
  combatDeps.damageCreature(target, 20, 0, 0, 0, {ranged:true});
  combatDeps.awardRangedMastery('crossbow');
  assert.equal(gear.toolMastery.crossbow.xp, 2.5, 'ranged kill should get double XP');

  // Crop harvest: exact currently-equipped hoe, yield worth * quality.
  gear.toolMastery.bronzehoe = {xp:0};
  fishingDeps.recordItemQuality('heftroot', 3, 1);
  context.SkillSystem.award('farming', 6, 'harvested Heftroot');
  assert.equal(qualityCalls, 1);
  assert.equal(gear.toolMastery.bronzehoe.xp, 3.06, '25g 3-star crop should use quality-adjusted worth');

  // If hoe changes between quality roll and farming award, current equipped hoe gets it.
  toolDefs.betterhoe = {label:'Better Hoe',slots:['hoe']};
  equipmentSlots.hoe = 'betterhoe';
  gear.toolMastery.betterhoe = {xp:0};
  fishingDeps.recordItemQuality('heftroot', 1, 1);
  context.SkillSystem.award('farming', 6, 'harvested Heftroot');
  assert.equal(gear.toolMastery.betterhoe.xp, 2.5, 'harvest credits current hoe at award time');

  // Treasure: establish baseline, then first trench transition awards current shovel at exactly half equal-value crop rate.
  gear.toolMastery.pickshovel = {xp:0};
  context.WildTreasure.ensureZone('zoneA');
  grid[2][1].type = 'trench';
  context.WildTreasure.syncZoneInteractivity('zoneA');
  assert.equal(gear.toolMastery.pickshovel.xp, 1.25, '25g treasure should award half of 25g crop base (2.5)');
  context.WildTreasure.syncZoneInteractivity('zoneA');
  assert.equal(gear.toolMastery.pickshovel.xp, 1.25, 'same treasure dig must never reward twice');
  assert.equal(placement.masteryAwarded, true);

  // Already-dug persisted state is baseline-only and must not award on zone load.
  const savedPlacement = {col:0,row:0,found:false,loot:{gold:100}};
  treasurePersist.set('zoneB',{week:1,placements:[savedPlacement]});
  zoneScenes.set('zoneB',{grid:[[{type:'trench'}]]});
  const beforeSaved = gear.toolMastery.pickshovel.xp;
  context.WildTreasure.ensureZone('zoneB');
  context.WildTreasure.syncZoneInteractivity('zoneB');
  assert.equal(gear.toolMastery.pickshovel.xp, beforeSaved, 'already-dug save must not mint XP on load');

  // Existing dev mastery control remains permitted.
  equipmentDeps.devBumpToolMasteryLevel('hatchet');
  assert.equal(gear.toolMastery.hatchet.xp, 41.3, 'dev mastery bump should bypass gameplay guard');

  // Pure-combat classification is future-proof for swords and ranged.
  assert.equal(policy.isPureCombatWeapon('hatchet', false), false);
  assert.equal(policy.isPureCombatWeapon('sword', false), true);
  assert.equal(policy.isPureCombatWeapon('crossbow', true), true);

  console.log('mastery-policy tests passed');
  console.log(JSON.stringify(policy.getDebug(), null, 2));
})();

#!/usr/bin/env node
'use strict';

// Real wilderness chest module: generation, persisted rewards, lock wiring,
// simple attunement-cost trinkets, and save-compatible enchanted weapons.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/wild-treasure.js', 'utf8'); // Production logic exercised in this deterministic browser-like harness.
const trinketSource = fs.readFileSync('docs/js/trinket-system.js', 'utf8'); // Authored single-effect trinket costs used to check loot tier balance.
const trinketIdsByTier = { 2: ['wanderersAnklet', 'herbalistsPendant'], 3: ['rangersBeads', 'brawlersRing', 'guardiansBrooch', 'fightersBelt', 'swiftbladeRing', 'defendersBrooch', 'steadfastBeads', 'runnersCord', 'masonsRing'], 4: ['duelistsSignet', 'wardensAmulet'] }; // Expected available curios at each rarity.

for (const [tierText, ids] of Object.entries(trinketIdsByTier)) {
  const tier = Number(tierText); // Ensures rewards scale from 1, through 2, to 3 Attunement points.
  const poolLine = source.match(new RegExp('^\\s*' + tier + ': \\[([^\\]]+)\\],?$', 'm')); // Validates actual wild-chest selection, not just unused gear definitions.
  assert(poolLine, 'buried chest tier ' + tier + ' must have a trinket selection pool');
  for (const id of ids) {
    assert(poolLine[1].includes("'" + id + "'"), id + ' must actually be rollable from a tier ' + tier + ' chest');
    const match = trinketSource.match(new RegExp('\\b' + id + ': \\{([\\s\\S]*?)\\n    \\},'));
    assert(match, id + ' must be authored in the real TrinketSystem catalog');
    assert.match(match[1], new RegExp('attunementCost: ' + (tier - 1) + '\\b'), id + ' should be priced for its chest tier');
    assert.match(match[1], /source: 'buriedTreasure'/);
    assert.doesNotMatch(match[1], /handler:|perkRanks:|companion:/, 'buried curios should use a straightforward stat, not specialized handlers');
    const stats = match[1].match(/effects: \{ stats: \{ ([^}]+) \} \}/);
    assert(stats, id + ' should have a stat-only effect');
    assert.equal(stats[1].split(',').length, 1, id + ' should confer just one benefit');
  }
}

class Group { constructor() { this.children = []; this.position = { set() {} }; } add(...children) { this.children.push(...children); } }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.position = { y: 0 }; } }
class Material { constructor({ color }) { this.color = color; } }
class TextureLoader { load(path) { return { path }; } }

function harness(roll, legacyPlacement = null, disableMetals = false, twoChests = false) {
  const mapId = 'buried_tier_test'; // Shared active zone ID used by scatter, lock targeting, and chest removal.
  const TILE = { GRASS: 'grass', TRENCH: 'trench' }; // Distinguishes a buried chest from one ready to open.
  const tile = { type: TILE.GRASS, elevTier: 0 }; // First legal treasure tile, where the original chest is opened.
  const alternateTile = { type: TILE.GRASS, elevTier: 0 }; // A distinct legal tile to simulate rescatters after changing berry/reagent exclusions.
  let scatterCols = twoChests ? [0, 1] : [0]; // Controls legal sites returned on regeneration without changing their scatter-slot identity.
  const scene = { add() {}, remove() {} }; // World mesh hooks used by production ensureZone.
  const persist = new Map(); // Mimics the normal weekly treasure persistence object.
  const objects = new Map(); // World-object registry that validates in-flight lock successes.
  const meshes = new Map(); // Rendered mesh groups retained for cleanup.
  const started = []; // Captures the real lock options offered at interaction time.
  const claimed = []; // Captures actual trinket ownership calls, distinct from inventory stacks.
  const acquired = []; // Captures alchemy bottle acquisition provenance.
  const flushed = []; // Captures the canonical save flush made after a successful lock.
  const inventory = {}; // Rewards must reach this inventory exactly once.
  const calendar = { day: 1 }; // Controlled test calendar for same-week returns and next-week respawn.
  const itemDefs = { tinBar: { label: 'Tin Bar' } }; // Game canonical definitions used for reward labels.
  const masteryRolls = []; // Inspects rank tables used for rare mastery scrolls.

  if (legacyPlacement) persist.set(mapId, { week: 0, placements: [legacyPlacement] });
  const context = {
    console, Math, Date, WildernessMapGenerator: {},
    THREE: { Group, Mesh, BoxGeometry: class {}, MeshLambertMaterial: Material, TextureLoader },
    window: {
      InventoryStacks: { MAX_TOTAL: 999 },
      ConditionRegistry: { entryEligible: () => true },
      ChestLockpicking: { open(options) { started.push(options); return true; } },
      HobunjiRuntimeSave: { flushNow() { flushed.push(true); return { ok: true, captured: true }; } },
      HobunjiActivityEvents: { emit() {} },
      AlchemySystem: {
        RECIPE_DEFS: { breedingGigantism: { id: 'breedingGigantism', useMode: 'livestock' } },
        ensureRecipeItemDef(id) { return 'alchemy_' + id; },
        recordPotionAcquisition(key, qty) { acquired.push([key, qty]); },
      },
      LootRolling: { rollMasteryPool(id) { masteryRolls.push(id); return { ['masteryScroll:sharp:2:test']: 1 }; } },
      TrinketSystem: {
        DEFINITIONS: Object.fromEntries(Object.values(trinketIdsByTier).flat().map(id => [id, { id }])),
        claimLoot(bundle, source) { const id = Object.keys(bundle)[0].slice('trinket_'.length); claimed.push([id, source]); return ['💍 ' + id]; },
      },
      HarlyaoRelics: {
        makeRelic() { return { shape: 'longsword', uid: 'static1', enchantments: { base: ['fire'], flourishes: {} } }; },
        encodeBoundKey(relic) { return 'harlyaoBound_' + relic.shape + '_' + relic.uid; },
        ensureBoundItemDef(key) { itemDefs[key] = { label: 'Bound Enchanted Sword' }; return itemDefs[key]; },
      },
    },
  };
  vm.runInNewContext(source, vm.createContext(context), { filename: 'wild-treasure.js' });
  const api = context.window.WildTreasure; // The actual browser-facing API under test.
  const deps = {
    calendar, rnd: () => 0.01, getLootPools: () => ({
      treasureChest: { entries: [{ id: 'metalBars', chance: disableMetals ? 0 : 1 }, { id: 'potion', chance: 0 }, { id: 'clothing', chance: 0 }, { id: 'combatManual', chance: 0 }] },
    }), lootShopWorldState: () => ({}),
    VERDIGRIS_METAL_KEYS: ['tin'], MYSTERY_DYE_ITEM_KEY_BY_POOL: { test: 'dyeTest' },
    metalBarItemKey: metal => metal + 'Bar', METAL_DEFS: { tin: { label: 'Tin' } },
    inventory, ITEM_DEFS: itemDefs,
    _zoneScenes: new Map([[mapId, { grid: [[tile, alternateTile]], cols: twoChests ? 3200 : 2, rows: 1, scene }]]),
    _zoneTreasurePersist: persist, _zoneTreasureObjects: objects, _zoneTreasureMeshGroups: meshes,
    _zoneReagentPersist: new Map(), _zoneBerryPersist: new Map(),
    _seedFromString: text => text, _mbRng: seed => () => seed.includes(':treasure-tier:') ? roll : 0.5,
    findZoneFlatEmptyTiles: () => scatterCols.map(col => ({ col, row: 0 })),
    TileType: TILE, NORMAL_TOP: 0, TRENCH_TOP: -0.5, PLATEAU_UNIT: 1,
    getCurrentArea: () => mapId, isZoneArea: id => id === mapId,
    refreshItemScroll() {}, buildInventoryGrid() {}, buildPackClothingSection() {}, showToast() {},
    debugLog() {},
  };
  api.init(deps);
  api.ensureZone(mapId);
  const placement = persist.get(mapId).placements[0]; // Reads the actual saved placement, not test-generated loot.
  return {
    api, mapId, tile, objects, meshes, persist, placement, inventory, calendar, started, claimed, acquired, flushed, masteryRolls,
    dig() { tile.type = TILE.TRENCH; api.syncZoneInteractivity(mapId); return objects.get(mapId)?.get('0,0'); },
    moveScatterToAlternateTile() { scatterCols = twoChests ? [1, 0] : [1]; }, // Regression for a plant or berry placement that changes the eligible chest coordinates.
  };
}

for (const [roll, tier] of [[0, 1], [0.619, 1], [0.62, 2], [0.869, 2], [0.87, 3], [0.969, 3], [0.97, 4], [0.999, 4]]) {
  const h = harness(roll); // Boundary rolls exercise the exact authored chest rarity cutoffs.
  assert.equal(h.placement.tier, tier, 'persisted tier should match the tier weight selected by the zone RNG');
  const restored = JSON.parse(JSON.stringify(h.api.serializeState()[h.mapId])); // Simulate save/reload before digging.
  assert.equal(restored.placements[0].tier, tier);
  assert.equal(Object.hasOwn(restored.placements[0], '_mesh'), false, 'Three.js meshes must never contaminate save JSON');
  assert.deepEqual(restored.placements[0].loot.enchantedRelic || null, tier >= 3 ? {
    shape: 'longsword', uid: 'static1', enchantments: { base: ['fire'], flourishes: {} },
  } : null, 'higher-tier enchanted reward is rolled once and survives serialization');
  const chest = h.dig(); // A buried chest is not available until digging reveals it.
  assert(chest, 'the real zone interactivity must register the dug chest');
  assert.match(chest.getButtons()[0].label, new RegExp('Tier ' + tier));
  assert.equal(chest.onAction('obj_open_treasure_chest').ok, false);
  assert.equal(h.started[0].tier, tier, 'the lock must use the persisted chest difficulty');
  assert.equal(h.started[0].valid(), true, 'the live target is valid before opening');
  assert.equal(h.inventory.gold, undefined, 'entering the lock must never grant loot early');
  const loot = JSON.parse(JSON.stringify(h.placement.loot)); // Snapshot of pre-rolled bundle for save stability.
  assert.equal(h.placement.loot.breedingPotionKey != null, tier >= 2, 'better chests should contain breeding potions at winning rolls');
  h.started[0].onSuccess({ bonusDrops: 0 }); // Only successful lock completion grants the authored bundle.
  assert.equal(h.placement.found, true);
  assert.equal(h.flushed.length, 1, 'opening a chest flushes the canonical save once');
  assert.equal(h.started[0].valid(), false, 'already-claimed chest locks become invalid');
  assert.equal(h.inventory.tinBar, 1 + (tier - 1), 'metal bar guarantees scale by tier');
  assert.ok((h.inventory.gold || 0) >= [10, 30, 65, 120][tier - 1], 'guaranteed high-tier bonus gold increases');
  assert.equal(h.claimed.length, tier >= 2 ? 1 : 0, 'new curios are granted through TrinketSystem, not the ordinary bag');
  assert.equal(h.masteryRolls.length, tier >= 2 ? 1 : 0, 'higher-tier mastery scrolls use existing authored scroll pool');
  if (tier === 4) assert.equal(h.masteryRolls[0], 'mastery_captain', 'ancient chests can roll the stronger rank-3–4 scroll');
  if (tier >= 3) assert.equal(h.inventory.harlyaoBound_longsword_static1, 1, 'rare enchanted relic uses persisted inventory key');
  assert.deepEqual(JSON.parse(JSON.stringify(loot)), JSON.parse(JSON.stringify(loot)), 'captured bundle stays JSON-compatible');
  assert.equal(chest.onAction('obj_open_treasure_chest').ok, false, 'stale action cannot duplicate the relic or other rewards');
}

const disabledMetals = harness(0.999, null, true); // Simulates an editor-authored metalBars entry explicitly disabled while rolling a rare Ancient chest.
assert.equal(disabledMetals.placement.tier, 4);
assert.equal(disabledMetals.placement.loot.metalKeys.length, 0, 'higher-tier extra bars respect a disabled base metal loot roll');
disabledMetals.dig().onAction('obj_open_treasure_chest');
disabledMetals.started[0].onSuccess({ bonusDrops: 0 });
assert.equal(disabledMetals.inventory.tinBar, undefined, 'opening an Ancient chest does not bypass disabled metal drop settings');

const legacy = harness(0.99, { col: 0, row: 0, found: false, loot: { metalKeys: ['tin'], gold: 4 } }); // Pre-tier chest save must keep its original reward.
const legacyChest = legacy.dig();
legacyChest.onAction('obj_open_treasure_chest');
assert.equal(legacy.started[0].tier, 1, 'legacy chest without tier retains two-ring lock');
legacy.started[0].onSuccess({ bonusDrops: 1 });
assert.equal(legacy.inventory.gold, 4);
assert.equal(legacy.inventory.tinBar, 2);
assert.equal(legacy.claimed.length, 0);
// The scene cache may discard the zone's entire placement record after an opened chest disappears.
const visit = harness(0); // One real buried chest, deterministically generated at 0,0.
const dugChest = visit.dig(); // Only the actual successful lock callback should create a claim.
dugChest.onAction('obj_open_treasure_chest');
assert.equal(visit.api.serializeState()[visit.mapId].claimedTiles, undefined, 'starting a lock does not mark the chest claimed');
visit.started[0].onSuccess({ bonusDrops: 0 });
assert.equal(visit.persist.get(visit.mapId).placements.length, 0, 'opening removes the chest placement');
assert.deepEqual(Array.from(visit.api.serializeState()[visit.mapId].claimedTiles), ['0,0'], 'the opening saves a separate claim marker');
assert.deepEqual(Array.from(visit.api.serializeState()[visit.mapId].claimedSlots), [0], 'the opening also remembers the chest scatter slot');
const barsAfterOpen = visit.inventory.tinBar; // Guards against a duplicate reward from a stale re-created chest.
visit.persist.delete(visit.mapId); // Simulate accidental loss of zone data on inactive scene disposal.
visit.moveScatterToAlternateTile(); // Changed resource exclusions can move the same regenerated chest to a different coordinate.
visit.api.ensureZone(visit.mapId);
assert.equal(visit.persist.get(visit.mapId).placements.length, 0, 'returning in the same week cannot respawn an opened buried chest');
assert.equal(visit.objects.get(visit.mapId).size, 0, 'the same-week return does not install an Open interaction');
assert.equal(visit.inventory.tinBar, barsAfterOpen, 'leaving a zone does not grant another reward');
visit.persist.delete(visit.mapId); // Save after the active placement map has already been discarded.
const claimsOnly = JSON.parse(JSON.stringify(visit.api.serializeState()));
assert.equal(claimsOnly[visit.mapId].placements, undefined, 'claims-only saves do not impersonate a complete set of placements');
assert.deepEqual(claimsOnly[visit.mapId].claimedSlots, [0], 'claims-only saves retain chest identity even when coordinates change');
const resumed = harness(0); // Another runtime instance restores the saved character after a restart.
resumed.api.restoreState(claimsOnly);
resumed.moveScatterToAlternateTile(); // Different day-dependent avoidance after loading must still respect the old slot.
resumed.meshes.clear(); // A real restart has no scene meshes from the prior process.
resumed.api.ensureZone(resumed.mapId);
assert.equal(resumed.persist.get(resumed.mapId).placements.length, 0, 'save/reload plus zone rebuild preserves the opened chest claim');
assert.equal(resumed.objects.get(resumed.mapId).size, 0, 'restored chest remains unlootable');
const freshWorld = harness(0); // A different character without these claims still gets their own loot.
assert.equal(freshWorld.persist.get(freshWorld.mapId).placements.length, 1, 'claims never leak to another character');

// Two chests may exchange locations after a berry/reagent rescatters: preserve the unclaimed slot.
const two = harness(0, null, false, true); // A large zone normally spawns two independently claimable weekly chests.
assert.deepEqual(two.persist.get(two.mapId).placements.map(p => p.slot), [0, 1]);
const firstOfTwo = two.dig();
firstOfTwo.onAction('obj_open_treasure_chest');
two.started[0].onSuccess({ bonusDrops: 0 });
two.persist.delete(two.mapId);
two.moveScatterToAlternateTile(); // Slot 0 moves away; unclaimed slot 1 now occupies the old claimed coordinate.
two.api.ensureZone(two.mapId);
const survivor = two.persist.get(two.mapId).placements; // Should contain precisely the other chest, irrespective of reused coordinates.
assert.deepEqual(survivor.map(p => p.slot), [1], 'only the claimed chest slot is suppressed');
assert.equal(survivor[0].col, 0, 'an unclaimed chest remains available even when moved onto a previously claimed tile');
assert(two.objects.get(two.mapId).get('0,0'), 'the remaining chest can still be opened after switching coordinates');

visit.calendar.day = 8; // The existing weekly spawn intentionally allows fresh loot after day seven.
visit.api.ensureZone(visit.mapId);
assert.equal(visit.persist.get(visit.mapId).placements.length, 1, 'a newly started week still has its own treasure generation');
assert.equal(visit.persist.get(visit.mapId).placements[0].col, 1, 'new-week treasure may use the newly available tile');
console.log('PASS buried treasure tiers: rarity bounds, specialty loot, zone re-entry persistence, weekly refresh, legacy saves.');

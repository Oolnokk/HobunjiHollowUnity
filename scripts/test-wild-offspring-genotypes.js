#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks every live wild-species roster against offspring and genetics support.
const fs = require('node:fs'); // Reads the production registries, spawners, and deployment code.
const vm = require('node:vm'); // Runs the real modules without allocating game graphics.
const InventoryStacks = require('./lib/inventory-stacks'); // Canonical genotype grouping and inventory capacity.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Supplies the actual zone and creature declarations.
const callbacks = []; // Runs the same deferred species bootstraps used by the game.
const storage = new Map(); // Survives VM recreation to exercise saved lineage restoration.
const document = { currentScript: null, getElementById() {}, querySelectorAll: () => [], addEventListener() {}, documentElement: {} }; // DOM seams used by module initialization.
const context = vm.createContext({ console, Math, performance, document, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) } }); // Shared real registration environment.
context.window = context;
context.addEventListener = (type, callback) => { if (type === 'DOMContentLoaded') callbacks.push(callback); };
context.InventoryStacks = InventoryStacks;
context.CreatureTextureCache = { create: () => ({}) };
context.MutationObserver = class { observe() {} };
function run(file) { vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file }); }
function declaration(name, endMarker) {
  const begin = game.indexOf(`const ${name} =`); // Locates the production literal by its existing owner.
  const end = game.indexOf(endMarker, begin); // Stops before unrelated startup work.
  assert(begin >= 0 && end > begin, `${name} declaration is present`);
  vm.runInContext(game.slice(begin, end) + `\nwindow.${name} = ${name};`, context);
}

run('docs/config/scratchbones-config.js');
context.TILE = 32;
context.WILDLIFE_CREATURE_MODEL_WIDTHS = context.SCRATCHBONES_CONFIG.game.wildlife.creatureModelWidths;
declaration('CREATURE_DB', '// Overrides CREATURE_DB');
declaration('EXTERIOR_ZONES', 'EXTERIOR_ZONES.map_opening_cloud_forest');
run('docs/js/voorg-ass-registration.js');
run('docs/js/moot-registration.js'); // Makes the open-air Moot mother and recoverable baby item part of the wild-family audit.
run('docs/js/creature-genetics.js');
run('docs/js/creature-genetics-render.js');
run('docs/js/wildlife-spawn.js');
run('docs/js/den-nest-system.js');
run('docs/js/puktuk-den-nest-registration.js');
for (const callback of callbacks) callback();
context.CreatureGenetics.init({ CREATURE_DB: context.CREATURE_DB, clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });
const wildlifeDeps = { CREATURE_DB: context.CREATURE_DB, EXTERIOR_ZONES: context.EXTERIOR_ZONES, DEN_MOTHER_DEFS: context.SCRATCHBONES_CONFIG.game.wildlife.denMothers }; // Reused to exercise the real spawn owner after verifying the configuration.
context.WildlifeSpawn.init(wildlifeDeps);

const itemKinds = context.SCRATCHBONES_CONFIG.game.livestock.itemKinds; // Live item-to-species authority consumed by FarmAnimals and the Stable.
const mothers = context.SCRATCHBONES_CONFIG.game.wildlife.denMothers; // Includes synchronous Puktuk registration.
const wild = new Set(['drenkirra']); // Branch-nesting Drenkirra live outside the ground-zone species pools.
for (const zone of Object.values(context.EXTERIOR_ZONES)) {
  for (const field of ['denSpecies', 'packSpecies', 'herbivoreSpecies', 'roamingHerdSpecies', 'roamingForagerSpecies']) {
    for (const kind of zone[field] || []) wild.add(context.CreatureGenetics.SPECIES_ALIAS[kind] || kind);
  }
}
const offspring = new Map(); // Records the actual reachable offspring item for each wild family.
for (const kind of wild) {
  assert(context.CreatureGeneticsRender.SPECIES[kind], `${kind}: native sprite/genotype renderer exists`);
  const family = context.WildlifeSpawn.denGenotypeFamily(kind); // Resolves the same canonical family used by wild parents and nest contents.
  assert.equal(family, kind);
  const genotype = context.WildlifeSpawn.getOrMakeDenGenotype(`offspring_${kind}`, family); // Uses the actual shared wild-family genotype owner.
  assert.equal(context.WildlifeSpawn.getOrMakeDenGenotype(`offspring_${kind}`, family), genotype, `${kind}: parent and clutch reuse one bloodline`);
  assert(genotype?.base?.color, `${kind}: a real coat genotype is generated`);
  assert(genotype.sizeClass, `${kind}: inherited size class exists`);
  for (const pattern of context.CreatureGenetics.PATTERN_DEFS[kind] || []) assert(genotype[pattern]?.color, `${kind}: ${pattern} carries its allele color`);
  const source = kind === 'voorg-ass' ? context.VoorgAssRegistration.BABY_ITEM_KEY
    : kind === 'moot' ? context.MootRegistration.BABY_ITEM_KEY
    : mothers[kind === 'uumkaoii' ? 'uumkaoii-wild' : kind]?.nestItemKey; // Both surface Herd-Mothers are corpse pickups; the others use ground/tree nests.
  assert(source && itemKinds[source] === kind, `${kind}: wild offspring pickup maps to a raisable animal`);
  const inRoamingHerd = ['voorg-ass', 'moot'].includes(kind) && Object.values(context.EXTERIOR_ZONES).some(zone => zone.roamingHerdSpecies?.includes(kind)); // Only a configured exterior herd makes its babies genuinely recoverable in the wild.
  const reachable = inRoamingHerd || kind === 'drenkirra' || Object.values(context.EXTERIOR_ZONES).some(zone =>
    (zone.denSpecies || [...(zone.packSpecies || []), ...(zone.herbivoreSpecies || [])]).some(species => (context.CreatureGenetics.SPECIES_ALIAS[species] || species) === kind)); // An item registration alone cannot satisfy wild acquisition.
  assert(reachable, `${kind}: at least one wild source actually selects this family`);
  offspring.set(source, { kind, genotype });
}
assert.equal(wild.size, 9, 'all nine currently implemented wild animal families, including Moot, are covered');

run('docs/js/cavern-generator.js');
context.CavernGenerator.init({ EXTERIOR_ZONES: context.EXTERIOR_ZONES, DEN_MOTHER_DEFS: mothers });
for (const [roll, expected] of [[0, 'grehlr-den-mother'], [0.99, 'nazgraku']]) {
  context.WildernessMapGenerator = { makeRng: () => () => roll };
  const mapId = context.WildlifeSpawn.denCavernMapId('map_northern_cliffs', `offspring_${expected}`); // Real cavern identity enables the shared exterior/interior species lookup.
  assert.equal(context.CavernGenerator.pickDenMotherKind(mapId), expected, 'both Northern Cliffs families are selected by the real cavern generator');
}

Object.assign(wildlifeDeps, {
  TILE: 32, TileType: {}, rnd: () => 0.5, hostileObjects: new Set(),
  zoneLayouts: new Map([['map_northern_cliffs', { dens: [{ id: 'grehlr_review', x: 10, y: 10 }, { id: 'nazgraku_review', x: 40, y: 10 }], tiles: [] }]]),
  getCurrentArea: () => 'map_northern_cliffs', getCutscenePreviewActive: () => false, _isZoneArea: () => true, buildZoneScene: () => true, showToast() {},
  makeCreatureEntity: (creatureKey, x, y, options) => ({ creatureKey, x, y, health: 100, ...options }),
});
context.BanditCamps = { ensureCurrentZoneCamps() {} };
context.WildlifeSpawn.updateHostileSpawning(3);
const denNazgraku = [...wildlifeDeps.hostileObjects].filter(creature => creature.creatureKey === 'nazgraku' && creature.denKey); // Actual exterior den residents, distinct from the separate forager slot.
assert(denNazgraku.length > 0, 'Nazgraku dens spawn their real exterior family');
assert(denNazgraku.every(creature => creature.wildlifeRole === 'prey'), 'herbivorous Nazgraku den residents never receive predator faction behavior');
assert(denNazgraku.every(creature => creature.genotype?.base?.color), 'live exterior Nazgraku carry real family genotypes');

run('docs/js/farm-animals.js');
const inventory = Object.fromEntries([...offspring.keys()].map(key => [key, 2])); // Two copies exercise both farm and companion deployment after a reload.
const livestock = [], stable = []; // Captures the normal saved-world and personal-companion records.
context.FarmAnimals.init({
  LIVESTOCK_ITEM_KINDS: itemKinds, LIVESTOCK_RESOURCE_DEFS: {}, inventory,
  hasFarmPermission: () => true, clampInventoryStack() {}, loadWorldLivestock: () => livestock, saveWorldLivestock() {},
  getStable: () => stable, companionAiTypeForKind: () => 'vigilantProtector', _autoAssignStableRole() {}, saveStable() {},
});
context.__hobunjiPlayerProfile = { worldId: 'world', characterId: 'character' };
storage.set('hobunjiSaveMeta', JSON.stringify({ worlds: [{ id: 'world', members: { character: { nonGearInventory: inventory } } }] }));
run('docs/js/livestock-item-genotype-persistence.js');
for (const [key, { genotype }] of offspring) {
  context.FarmAnimals.queueItemGenotype(key, genotype);
  context.FarmAnimals.queueItemGenotype(key, genotype);
}
context.LivestockItemGenotypePersistence.reload();
for (const [key, { kind, genotype }] of offspring) {
  const saved = context.LivestockItemGenotypePersistence.groupsFor(key, inventory[key]); // Confirms the restored exact genes own both visible inventory units.
  assert.equal(saved[0].count, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(saved[0].genotype)), JSON.parse(JSON.stringify(genotype)));
  assert.equal(context.FarmAnimals.addFromItem(key).ok, true, `${kind}: farm deployment succeeds`);
  assert.equal(context.FarmAnimals.addToStable(key).ok, true, `${kind}: stable deployment succeeds`);
  for (const entry of [livestock.at(-1), stable.at(-1)]) {
    assert.equal(entry.kind, kind);
    assert.deepEqual(JSON.parse(JSON.stringify(entry.genotype)), JSON.parse(JSON.stringify(genotype)), `${kind}: deployed animal keeps its exact saved genes`);
  }
  assert.equal(inventory[key], 0);
}
assert.equal(context.LivestockItemGenotypePersistence.getDebug().queuedNow, 0, 'deployment consumes every saved lineage exactly once');

// The actual persistence adapter must roll back its in-memory queue if the browser rejects a durable metadata write.
const grehlrBabyItem = mothers.grehlr.nestItemKey; // Known legitimate Northern Cliffs nest reward used in the rollback fixture.
const grehlrGenotype = offspring.get(grehlrBabyItem).genotype; // Exact same bearded or unbearded family lineage as the den owner.
const originalSetItem = context.localStorage.setItem; // Restored immediately after simulating a full browser storage quota.
context.localStorage.setItem = (key, value) => {
  if (key === 'hobunjiSaveMeta') throw new Error('simulated storage quota exceeded');
  return originalSetItem(key, value);
};
try {
  assert.equal(context.FarmAnimals.queueItemGenotype(grehlrBabyItem, grehlrGenotype), false,
    'a rejected saved-lineage write must report failure to the den collector');
  assert.equal(context.LivestockItemGenotypePersistence.getDebug().queuedNow, 0,
    'failed persisted lineage must be removed from the in-memory FIFO');
} finally {
  context.localStorage.setItem = originalSetItem;
}
// Test the real atomic cave pickup writer, including four bearded Grehlr babies and a page reload.
const atomicDenId = 'map_i_den_map_northern_cliffs_atomicGrehlr'; // A real-format cave identity tying inventory, lineage and clutch to one saved world.
const beardedGrehlr = JSON.parse(JSON.stringify(grehlrGenotype)); // A forced bearded family shared across four baby acquisitions.
beardedGrehlr.beard = { ...(beardedGrehlr.beard || {}), color: beardedGrehlr.base.color, copies: 1, enabled: true };
const metaBeforeAtomic = JSON.parse(storage.get('hobunjiSaveMeta')); // Seed exactly one living cave before simulating a collector's hold completion.
const atomicMember = metaBeforeAtomic.worlds[0].members.character;
atomicMember.nonGearInventory.grehlrBaby = 1; // An older snapshot still has a baby already removed from the live Pack.
const atomicBag = {}; // The live Pack is empty before collecting the four bearded babies.
metaBeforeAtomic.worlds[0].denTurnover = { version: 2, year: 1, records: [{
  denKey: 'map_northern_cliffs|atomicGrehlr', zoneId: 'map_northern_cliffs', denId: 'atomicGrehlr', cavernMapId: atomicDenId,
  clutch: { remaining: 4, itemKey: grehlrBabyItem, liveBirth: true, genotype: beardedGrehlr },
}] };
storage.set('hobunjiSaveMeta', JSON.stringify(metaBeforeAtomic));
assert.equal(context.LivestockItemGenotypePersistence.acquireNestItem(grehlrBabyItem, beardedGrehlr, atomicBag,
  { areaId: 'map_i_den_unknown_mismatched', remaining: 3, liveBirth: true }), false,
'unknown cavern record cannot convert a nest baby into an untracked inventory grant');
const beforeFailedAtomic = storage.get('hobunjiSaveMeta');
assert.equal(context.LivestockItemGenotypePersistence.acquireNestItem(grehlrBabyItem, beardedGrehlr, 1,
  { areaId: atomicDenId, remaining: 3, liveBirth: true }), false,
  'a stale cached caller using the old numeric inventory argument must fail before writing');
assert.equal(storage.get('hobunjiSaveMeta'), beforeFailedAtomic);
context.localStorage.setItem = (key, value) => {
  if (key === 'hobunjiSaveMeta') throw new Error('simulated atomic write failure');
  return originalSetItem(key, value);
};
try {
  assert.equal(context.LivestockItemGenotypePersistence.acquireNestItem(grehlrBabyItem, beardedGrehlr, atomicBag,
    { areaId: atomicDenId, remaining: 3, liveBirth: true }), false,
  'one failing atomic write must reject the entire baby/lineage/clutch transaction');
  assert.equal(storage.get('hobunjiSaveMeta'), beforeFailedAtomic, 'failed write preserves all three saved records unchanged');
  assert.deepEqual(atomicBag, {}, 'failed pickup does not mutate the live Pack');
  assert.equal(context.LivestockItemGenotypePersistence.getDebug().queuedNow, 0, 'failed atomic write adds no live lineage');
} finally {
  context.localStorage.setItem = originalSetItem;
}
for (let i = 0; i < 4; i++) {
  assert.equal(context.LivestockItemGenotypePersistence.acquireNestItem(grehlrBabyItem, beardedGrehlr, atomicBag,
    { areaId: atomicDenId, remaining: 3 - i, liveBirth: true }), true,
  `Grehlr baby ${i + 1} commits exactly once`);
  assert.equal(atomicBag[grehlrBabyItem], i + 1, 'a committed baby appears in the live Pack immediately');
  const world = JSON.parse(storage.get('hobunjiSaveMeta')).worlds[0]; // Each pickup separately validates the written character and world-owned cave state.
  assert.equal(world.members.character.nonGearInventory[grehlrBabyItem], i + 1);
  assert.equal(world.members.character.livestockItemGenotypes[grehlrBabyItem].length, i + 1);
  assert.equal(world.denTurnover.records[0].clutch.remaining, 3 - i, 'saved den clutch never regenerates a stolen baby');
}
assert.equal(context.LivestockItemGenotypePersistence.acquireNestItem(grehlrBabyItem, beardedGrehlr, atomicBag,
  { areaId: atomicDenId, remaining: 0, liveBirth: true }), false,
'replaying the final pickup cannot mint extra hidden genetics');
assert.equal(context.LivestockItemGenotypePersistence.acquireNestItem(grehlrBabyItem, beardedGrehlr, atomicBag,
  { areaId: atomicDenId, remaining: 2, liveBirth: true }), false,
'stale cavern clutch count cannot mint a fifth baby');
context.LivestockItemGenotypePersistence.reload();
assert.equal(context.LivestockItemGenotypePersistence.getDebug().queuedNow, 4,
  'all four bearded bloodlines survive a page-style reload');
assert.equal(context.LivestockItemGenotypePersistence.groupsFor(grehlrBabyItem, 4)[0].count, 4,
  'the saved Pack can display all four identically bearded Grehlr babies');

assert.equal(context.CREATURE_DB.grehlr.label, 'Grehlr', 'base Grehlr species must have a valid fallback display label');
assert.equal(context.CREATURE_DB['grehlr-den-mother'].label, 'Grehlr Den-Mother', 'Den-Mother must have an authored display label');
assert.match(game, /creature\.name\.trim\(\)\.toLowerCase\(\) === 'undefined'/,
  'wildlife constructor repairs literal undefined creature names even after caller overrides');


// Execute the real hold-to-take function with a focused nest, isolating only
// raycasting/graphics. A full bag must preserve both the baby and its lineage.
const source = fs.readFileSync('docs/js/den-nest-system.js', 'utf8'); // Production acquisition path under test.
const begin = source.indexOf('  function updateNestInteraction(dt)'); // Keeps the actual mutation order intact.
const end = source.indexOf('  function debugSnapshot()', begin); // Excludes unrelated diagnostics rendering.
for (const [key, { genotype }] of offspring) {
  const nest = { itemKey: key, remaining: 1, liveBirth: true, genotype }; // Focused clutch member shares its family's real genotype.
  let held = 0, removed = 0, committed = 0; // Tests hold completion, atomic persistence and visual removal independently.
  let rejectCommit = false; // Simulates a quota error or failed lineage/clutch validation before any durable write.
  const order = []; // Ensures committed bag+genes+clutch precede the removal of the rendered baby.
  const pickup = vm.createContext({
    document, _nestTakeHudEl: null, _nestTakeLabelEl: null, _nestTakeFillEl: null, _activeNestContentHoldId: null,
    _nestContentDebug: {}, NEST_TAKE_HOLD_S: 5,
    _currentAimedNestContent: () => ({ nest, record: { id: key, type: 'baby' }, state: {} }),
    _removeContentRecord: () => { order.push('remove'); removed++; },
    deps: { player: {}, inventory: { [key]: InventoryStacks.MAX_TOTAL }, ITEM_DEFS: { [key]: { cat: 'livestock', label: 'Test offspring' } },
      getActiveAction: () => 'nest_take', getActionHeldDown: () => true, getNestHoldT: () => held, setNestHoldT: value => { held = value; },
      getCurrentArea: () => 'den', showToast() {}, clampInventoryStack() {}, buildInventoryGrid() {}, refreshItemScroll() {}, refreshActionBar() {},
      itemIconForKey: () => '' },
    window: { InventoryStacks, LivestockItemGenotypePersistence: { acquireNestItem(item, genes, bag, options) {
      assert.equal(item, key); assert.equal(genes, genotype); assert.equal(bag[key], 0); assert.equal(options.remaining, 0);
      order.push('atomic');
      if (rejectCommit) return false;
      bag[key]++;
      committed++;
      return true;
    } }, WildlifeSpawn: { updateDenClutchState: (_areaId, _nest, options) => {
      assert.equal(options.persist, false, 'cave state is already committed: no second giant save');
      order.push('sync');
      return true;
    } } },
  }); // Executes the real den interaction with its one-write persistence interface.
  vm.runInContext(source.slice(begin, end), pickup);
  pickup.updateNestInteraction(5);
  assert.equal(nest.remaining, 1, `${key}: full bag preserves clutch`);
  assert.equal(removed + committed, 0, `${key}: full bag neither removes the visual nor calls persistence`);

  pickup.deps.inventory[key] = 0;
  rejectCommit = true;
  pickup.updateNestInteraction(5);
  assert.equal(nest.remaining, 1, `${key}: a failed atomic save preserves clutch`);
  assert.equal(pickup.deps.inventory[key] || 0, 0, `${key}: a failed atomic save restores the original bag count`);
  assert.equal(removed + committed, 0, `${key}: a failed atomic save never removes a baby`);

  rejectCommit = false;
  pickup.deps.ITEM_DEFS = {}; // An invalid cave reward must not create a hidden Pack stack.
  pickup.updateNestInteraction(5);
  assert.equal(nest.remaining, 1, `${key}: unregistered reward cannot consume a nest baby`);
  assert.equal(pickup.deps.inventory[key] || 0, 0, `${key}: unregistered item cannot become an invisible inventory entry`);
  pickup.deps.ITEM_DEFS = { [key]: { cat: 'livestock', label: 'Test offspring' } };

  order.length = 0;
  pickup.updateNestInteraction(5);
  assert.equal(nest.remaining, 0, `${key}: committed acquisition decrements clutch`);
  assert.equal(pickup.deps.inventory[key], 1);
  assert.equal(removed, 1);
  assert.equal(committed, 1, `${key}: successful pickup commits exactly once`);
  assert.deepEqual(order, ['atomic', 'remove', 'sync'], `${key}: the entire bag/lineage/clutch commits before removing the baby`);

  assert.equal(pickup._nestContentDebug.lastCollectionSaveOk, true);

}
console.log('All nine wild families (including Moot) have reachable offspring, real coat/pattern/size genes, durable lineage, farm/stable deployment, and capacity-safe pickup.');

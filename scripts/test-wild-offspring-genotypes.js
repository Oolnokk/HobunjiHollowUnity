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
    : mothers[kind === 'uumkaoii' ? 'uumkaoii-wild' : kind]?.nestItemKey; // Herd-Mothers are corpse pickups; the others use ground/tree nests.
  assert(source && itemKinds[source] === kind, `${kind}: wild offspring pickup maps to a raisable animal`);
  const reachable = kind === 'voorg-ass' || kind === 'drenkirra' || Object.values(context.EXTERIOR_ZONES).some(zone =>
    (zone.denSpecies || [...(zone.packSpecies || []), ...(zone.herbivoreSpecies || [])]).some(species => (context.CreatureGenetics.SPECIES_ALIAS[species] || species) === kind)); // An item registration alone cannot satisfy wild acquisition.
  assert(reachable, `${kind}: at least one wild source actually selects this family`);
  offspring.set(source, { kind, genotype });
}
assert.equal(wild.size, 8, 'all eight currently implemented wild animal families are covered');

run('docs/js/cavern-generator.js');
context.CavernGenerator.init({ EXTERIOR_ZONES: context.EXTERIOR_ZONES, DEN_MOTHER_DEFS: mothers });
for (const [roll, expected] of [[0, 'grehlr-den-mother'], [0.99, 'nazgraku']]) {
  context.WildernessMapGenerator = { makeRng: () => () => roll };
  const mapId = context.WildlifeSpawn.denCavernMapId('map_northern_cliffs', `offspring_${expected}`); // Real cavern identity enables the shared exterior/interior species lookup.
  assert.equal(context.CavernGenerator.pickDenMotherKind(mapId), expected, 'both Northern Cliffs families are selected by the real cavern generator');
}

Object.assign(wildlifeDeps, {
  TILE: 32, TileType: {}, rnd: () => 0.5, hostileObjects: new Set(),
  zoneLayouts: new Map([['map_northern_cliffs', { dens: [{ id: 'nazgraku_review', x: 10, y: 10 }], tiles: [] }]]),
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

// Execute the real hold-to-take function with a focused nest, isolating only
// raycasting/graphics. A full bag must preserve both the baby and its lineage.
const source = fs.readFileSync('docs/js/den-nest-system.js', 'utf8'); // Production acquisition path under test.
const begin = source.indexOf('  function updateNestInteraction(dt)'); // Keeps the actual mutation order intact.
const end = source.indexOf('  function debugSnapshot()', begin); // Excludes unrelated diagnostics rendering.
for (const [key, { genotype }] of offspring) {
  const nest = { itemKey: key, remaining: 1, liveBirth: true, genotype }; // Focused clutch member shares its family's real genotype.
  let held = 0, removed = 0, queued = 0; // Tracks acquisition and metadata changes separately.
  const pickup = vm.createContext({
    document, _nestTakeHudEl: null, _nestTakeLabelEl: null, _nestTakeFillEl: null, _activeNestContentHoldId: null,
    _nestContentDebug: {}, NEST_TAKE_HOLD_S: 5,
    _currentAimedNestContent: () => ({ nest, record: { id: key, type: 'baby' }, state: {} }),
    _removeContentRecord: () => removed++,
    deps: { player: {}, inventory: { [key]: InventoryStacks.MAX_TOTAL }, ITEM_DEFS: {},
      getActiveAction: () => 'nest_take', getActionHeldDown: () => true, getNestHoldT: () => held, setNestHoldT: value => { held = value; },
      getCurrentArea: () => 'den', showToast() {}, clampInventoryStack() {}, buildInventoryGrid() {}, refreshItemScroll() {}, refreshActionBar() {}, saveMemberWorldData() {}, itemIconForKey: () => '' },
    window: { InventoryStacks, FarmAnimals: { queueItemGenotype(item, genes) { assert.equal(item, key); assert.equal(genes, genotype); queued++; } } },
  }); // Uses the same acquisition behavior for every wild baby/egg item.
  vm.runInContext(source.slice(begin, end), pickup);
  pickup.updateNestInteraction(5);
  assert.equal(nest.remaining, 1, `${key}: full bag preserves clutch`);
  assert.equal(removed + queued, 0, `${key}: full bag neither removes the visual nor queues orphan genes`);
  pickup.deps.inventory[key] = 0;
  pickup.updateNestInteraction(5);
  assert.equal(nest.remaining, 0);
  assert.equal(pickup.deps.inventory[key], 1);
  assert.equal(removed, 1);
  assert.equal(queued, 1, `${key}: successful pickup queues exactly its family genotype`);
}
console.log('All eight wild families have reachable offspring, real coat/pattern/size genes, durable lineage, farm/stable deployment, and capacity-safe nest collection.');

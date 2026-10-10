const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/cave-site-system.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');

function rngFactory(seedText) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seedText)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let a = h || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const storage = new Map();
const context = {
  console,
  setTimeout,
  clearTimeout,
  Promise,
  URL,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
  },
};
context.window = context;
context.WildernessMapGenerator = context.window.WildernessMapGenerator = { makeRng: rngFactory };
context.__farmLog = () => {};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'cave-site-system.js' });
const Cave = context.CaveSiteSystem;
assert(Cave, 'CaveSiteSystem exports');

// Existing den anchors are promoted in place, not replaced.
const workspace = {
  animalDens: [
    { id: 'animalDen_0', x: 10, y: 10, w: 3, h: 3, mouthAnchor: { x: 11, y: 13 } },
    { id: 'animalDen_1', x: 30, y: 12, w: 3, h: 3, mouthAnchor: { x: 31, y: 15 } },
    { id: 'animalDen_2', x: 52, y: 18, w: 3, h: 3, mouthAnchor: { x: 53, y: 21 } },
    { id: 'animalDen_3', x: 70, y: 25, w: 3, h: 3, mouthAnchor: { x: 71, y: 28 } },
  ],
};
const originalIds = workspace.animalDens.map(den => den.id);
const profilesA = Cave.applyWorkspaceProfiles('map_test_wilds', workspace);
assert.deepEqual(workspace.animalDens.map(den => den.id), originalIds, 'promoting caves preserves legacy den ids');
assert.equal(workspace.caveSites.length, workspace.animalDens.length, 'explicit caveSites mirrors every compatibility anchor');
assert(profilesA.some(profile => profile.layers.includes(Cave.TYPES.ANIMAL_DEN)), 'at least one animal den survives per generated cave set');
assert(workspace.animalDens.every(den => den.caveSite && typeof den.isAnimalDen === 'boolean'), 'compatibility records are tagged with cave semantics');
const deterministic = workspace.animalDens.map(den => Cave.__test.rollProfile('map_test_wilds', den).primary);
const deterministicAgain = workspace.animalDens.map(den => Cave.__test.rollProfile('map_test_wilds', den).primary);
assert.deepEqual(deterministic, deterministicAgain, 'profile rolls are deterministic');

// Two rooms joined by a single corridor tile give the separator finder an unambiguous mineable wall.
function twoRoomFloor() {
  const floor = [];
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) floor.push([c, r]);
  floor.push([6, 3]);
  for (let r = 1; r <= 5; r++) for (let c = 7; c <= 11; c++) floor.push([c, r]);
  return floor;
}
function baseMap(id) {
  return {
    id,
    name: 'A Dark Burrow',
    cols: 13,
    rows: 7,
    floor: twoRoomFloor(),
    exitCol: 1,
    exitRow: 3,
    exits: [{ id: 'den_exit', label: 'Back outside', tiles: [[1,3]], targetMap: '' }],
    furniture: [],
    oreRocks: [{ col: 2, row: 1, oreKind: 'stone' }],
    creatureSpawns: [{ kind: 'gar-wolf', col: 4, row: 3 }],
    nestCol: 4,
    nestRow: 3,
    denMotherKind: 'gar-wolf-den-mother',
  };
}
const separator = Cave.__test.findMineableSeparator(baseMap('separator_test'));
assert(separator && separator.col === 6 && separator.row === 3, 'mixed cave finds the existing corridor as a mineable partition');
assert(separator.nearKeys.length >= 20 && separator.farKeys.length >= 20, 'separator preserves substantial chambers on both sides');

function installProfile(profile) {
  Cave.__test.sitesByMapId.set(profile.mapId, JSON.parse(JSON.stringify(profile)));
}
function profile(mapId, layers) {
  return {
    id: 'cave_manual', zoneId: 'map_test_wilds', denId: mapId,
    mapId, signature: `manual:${mapId}`,
    primary: layers[0], secondary: layers[1] || null,
    layers: [...layers], exteriorLabel: 'Cave',
    discoveredLabel: Cave.__test.caveTitle(layers),
    mineableSeparator: layers.length > 1, mouthAnchor: { x: 1, y: 3 }, source: 'test',
  };
}

const mineProfile = profile('map_i_test_mine', [Cave.TYPES.ORE_MINE]);
installProfile(mineProfile);
const mineMap = Cave.decorateCavernMapData(mineProfile.mapId, baseMap(mineProfile.mapId));
assert.equal(mineMap.denMotherKind, null, 'non-animal cave strips Den-Mother');
assert.equal(mineMap.nestCol, null, 'non-animal cave strips nest');
assert(mineMap.oreRocks.length >= 7, 'ore-mine cave reuses oreRock mechanic at rich density');

const catProfile = profile('map_i_test_catacomb', [Cave.TYPES.CATACOMB]);
installProfile(catProfile);
const catMap = Cave.decorateCavernMapData(catProfile.mapId, baseMap(catProfile.mapId));
assert(catMap.caveProps.filter(item => item.key === 'ruinSanctumCoffin').length >= 3, 'catacomb places authored coffin props');
assert(!catMap.furniture.some(item => /^ruin/.test(item.itemKey)), 'authored ruin pieces stay out of FURNITURE_DEFS-keyed mapData.furniture');
assert(catMap.caveGhoulSpawns.length >= 1 && catMap.caveGhoulSpawns.every(spawn => spawn.ghoul), 'catacomb guardians are BanditCombat ghouls, not CREATURE_DB spawns');
assert.equal(catMap.creatureSpawns.length, 0, 'non-animal cave keeps no den creature spawns');

const cacheProfile = profile('map_i_test_cache', [Cave.TYPES.TRAPPED_CACHE]);
installProfile(cacheProfile);
const cacheMap = Cave.decorateCavernMapData(cacheProfile.mapId, baseMap(cacheProfile.mapId));
assert(cacheMap.caveProps.some(item => item.key === 'ruinDungeonChestT2'), 'cache places the authored dungeon chest');
assert(cacheMap.caveCache && cacheMap.caveTraps.length >= 1, 'cache has functional runtime plan plus at least one trap');

const mixedProfile = profile('map_i_test_mixed', [Cave.TYPES.BANDIT_HIDEOUT, Cave.TYPES.CATACOMB]);
installProfile(mixedProfile);
const mixedMap = Cave.decorateCavernMapData(mixedProfile.mapId, baseMap(mixedProfile.mapId));
assert(mixedMap.oreRocks.some(rock => rock.caveSeparator), 'mixed history is partitioned with an existing mineable ore-rock blocker');
assert(mixedMap.caveBanditSpawns.length >= 2, 'bandit hideout supplies runtime BanditCombat spawn points');
assert(mixedMap.caveProps.some(item => item.key === 'ruinSanctumCoffin'), 'secondary catacomb coexists beyond the same cave shell');

const ruinProfile = profile('map_i_test_ruin', [Cave.TYPES.RUIN_ENTRANCE]);
installProfile(ruinProfile);
const ruinMap = Cave.decorateCavernMapData(ruinProfile.mapId, baseMap(ruinProfile.mapId));
assert(ruinMap.caveProps.some(item => item.key === 'ruinEntranceDoor'), 'ruin cave places the authored ruin entrance door');
const ruinSeed = ruinMap.caveRuinEntrance?.seed;
assert(Number.isInteger(ruinSeed) && ruinSeed > 0 && ruinSeed === ruinSeed >>> 0, 'ruin threshold seed is a uint32 (DevRandomRuin coerces with Number(seed)>>>0)');
assert.equal(ruinSeed, Cave.decorateCavernMapData(ruinProfile.mapId, baseMap(ruinProfile.mapId)).caveRuinEntrance.seed, 'ruin seed is deterministic');

// Assignment-time hooks must capture dependencies before synchronous game initialization.
let seenDenCount = -1;
const zoneLayouts = new Map([['map_test_wilds', { dens: workspace.animalDens, transitions: workspace.animalDens.map(den => ({ targetMapId: den.caveSite.mapId, label: 'A dark burrow' })) }]]);
context.WildlifeSpawn = {
  denCavernMapId(zoneId, denId) { return `map_i_den_${zoneId}_${denId}`; },
  init(deps) { this.deps = deps; },
  updateHostileSpawning() { seenDenCount = this.deps.zoneLayouts.get('map_test_wilds').dens.length; },
  onZoneEntered() {},
  denNestCensus() { return { denCount: 999, nestTreesAlive: 0 }; },
};
context.CavernGenerator = { synthesizeCavernMapData(id) { return baseMap(id); } };
context.DevSpawner = { init(deps) { this.deps = deps; } };
assert(Cave.installIntegrations(), 'integrations install against already-loaded subsystems');
const deps = {
  zoneLayouts,
  zoneScenes: new Map(),
  getCurrentArea: () => 'map_test_wilds',
  _isZoneArea: id => id === 'map_test_wilds',
  hostileObjects: new Set(),
  player: { x: 0, y: 0 },
  TILE: 32,
};
context.WildlifeSpawn.init(deps);
context.DevSpawner.init({ grantLoot() { return []; } });
context.WildlifeSpawn.updateHostileSpawning(0.1);
const expectedAnimalDens = workspace.animalDens.filter(den => den.isAnimalDen).length;
assert.equal(seenDenCount, expectedAnimalDens, 'legacy wildlife tick only sees caves that contain animal dens');
assert.equal(zoneLayouts.get('map_test_wilds').dens.length, workspace.animalDens.length, 'full compatibility cave anchor list is restored after wildlife tick');
context.WildlifeSpawn.onZoneEntered('map_test_wilds');
assert(zoneLayouts.get('map_test_wilds').transitions.every(transition => transition.label === 'Cave'), 'exterior transition label no longer advertises a den/burrow');
const census = context.WildlifeSpawn.denNestCensus('map_test_wilds');
assert.equal(census.caveCount, workspace.animalDens.length, 'wildlife diagnostics expose generic cave total');
assert.equal(census.denCount, expectedAnimalDens, 'wildlife diagnostics retain true animal-den count');

// Cached Tothal layouts skip the generator capture; the lazy path must assign the same profiles.
const freshDens = workspace.animalDens.map(den => ({ id: den.id, x: den.x, y: den.y, w: den.w, h: den.h, mouthAnchor: den.mouthAnchor }));
zoneLayouts.set('map_cached_wilds', { dens: freshDens, transitions: [] });
const cachedSites = Cave.sitesForZone('map_cached_wilds');
const freshSites = Cave.applyWorkspaceProfiles('map_cached_wilds', { animalDens: freshDens.map(den => ({ ...den, caveSite: undefined })) });
assert.deepEqual(cachedSites.map(site => site.layers.join('+')), freshSites.map(site => site.layers.join('+')), 'cached and freshly generated zones get identical cave profiles');

// Load order: every wrapped subsystem must be loaded before this module, and this module before game.js.
const scriptIndex = name => indexHtml.search(new RegExp(`<script src="(?:js/)?${name.replace('.', '\\.')}\\?v=[A-Za-z0-9_-]+"`));
for (const dep of ['wildlife-spawn.js', 'dev-spawner.js', 'cavern-generator.js', 'cavern-ore-rocks.js', 'locale-cave-runtime.js']) {
  assert(scriptIndex(dep) >= 0 && scriptIndex(dep) < scriptIndex('cave-site-system.js'), `${dep} loads before cave-site-system.js`);
}
assert(scriptIndex('cave-site-system.js') < scriptIndex('game.js'), 'cave-site-system.js loads before game.js');

console.log(`PASS cave-site-system: ${workspace.animalDens.length} anchors -> ${expectedAnimalDens} animal den cave(s), mixed separator at ${separator.col},${separator.row}`);

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
vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/cavern-sculptor.js'), 'utf8'), context);
// Placement fixtures use a flat shell; the boundary integration test runs the real SDF carve.
context.CavernSculptor.carveFootprintCavern = floor => {
  const cols = Math.max(...floor.map(tile => tile[0])) + 1, rows = Math.max(...floor.map(tile => tile[1])) + 1; // Flat test surface covers every requested tile.
  return { mesh:{ positions:[0,0,0, cols,0,0, 0,0,rows, cols,0,rows], indices:[0,2,1,1,2,3] } };
};
vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/cavern-generator.js'), 'utf8'), context);
const expandCavernMapData = context.CavernGenerator.expandCavernMapData; // Keep the real footprint/collision/grounding owner when testing later installation hooks.
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
assert(separator && separator.col === 6 && separator.row === 3, 'separator finder picks the existing corridor as a mineable partition');
assert(separator.nearKeys.length >= 20 && separator.farKeys.length >= 20, 'separator preserves substantial chambers on both sides');

// Real cavern corridors are usually 2-3 tiles wide: the wall must span the whole corridor.
const wideFloor = [];
for (let r = 1; r <= 6; r++) for (let c = 1; c <= 6; c++) wideFloor.push([c, r]);
wideFloor.push([7, 3], [7, 4], [8, 3], [8, 4]);
for (let r = 1; r <= 6; r++) for (let c = 9; c <= 14; c++) wideFloor.push([c, r]);
const wideSeparator = Cave.__test.findMineableSeparator({ ...baseMap('wide_separator_test'), cols: 16, rows: 8, floor: wideFloor });
assert(wideSeparator && wideSeparator.cells.length === 2, 'two-wide corridor gets a two-rock wall');
assert(wideSeparator.cells.every(cell => cell.col === 7 || cell.col === 8), 'wall sits in the corridor');
const wideFloorKeys = new Set(wideFloor.map(([c, r]) => `${c},${r}`));
for (const cell of wideSeparator.cells) wideFloorKeys.delete(`${cell.col},${cell.row}`);
assert.equal(wideSeparator.nearKeys.length + wideSeparator.farKeys.length, wideFloorKeys.size, 'wall fully partitions the cave');

function installProfile(profile) {
  Cave.__test.sitesByMapId.set(profile.mapId, JSON.parse(JSON.stringify(profile)));
}
function profile(mapId, contents, inhabitant = Cave.TYPES.NONE) {
  return {
    schema: 2, id: 'cave_manual', zoneId: 'map_test_wilds', denId: mapId,
    mapId, signature: `manual:${mapId}`,
    contents, inhabitant,
    layers: [contents, inhabitant].filter(type => type !== Cave.TYPES.NONE), exteriorLabel: 'Cave',
    discoveredLabel: Cave.__test.caveTitle(contents, inhabitant),
    mouthAnchor: { x: 1, y: 3 }, source: 'test',
  };
}
function decorate(p) {
  installProfile(p);
  const map = baseMap(p.mapId); // Multi-goal animal fixtures need a second room outside the new eight-tile nest berth.
  if (p.inhabitant === 'animal_den' || p.contents === 'ruin_entrance') for (let row = 6; row <= 15; row++) {
    for (let col = 1; col <= 5; col++) map.floor.push([col,row]);
    if (p.contents === 'ruin_entrance') for (let col = 7; col <= 11; col++) map.floor.push([col,row]);
  }
  return Cave.decorateCavernMapData(p.mapId, map);
}

// Two independent layers: every contents type and every inhabitant occurs.
const CONTENTS = ['ore_mine', 'trapped_cache', 'catacomb', 'ruin_entrance', 'mushroom_cave'];
const INHABITANTS = ['animal_den', 'bandit_hideout', 'none'];
const rolled = Array.from({ length: 400 }, (_, i) => Cave.__test.rollProfile('map_roll_zone', { id: `animalDen_${i}`, x: i * 7, y: i * 3 }));
for (const type of CONTENTS) assert(rolled.some(p => p.contents === type), `contents ${type} can roll`);
for (const type of INHABITANTS) assert(rolled.some(p => p.inhabitant === type), `inhabitant ${type} can roll`);
assert(rolled.every(p => CONTENTS.includes(p.contents) && INHABITANTS.includes(p.inhabitant)), 'every cave has exactly one contents and one inhabitant');
assert.equal(Cave.__test.caveTitle('mushroom_cave', 'animal_den'), 'Mushroom Cave — Animal Den', 'label names both layers');
assert.equal(Cave.__test.caveTitle('ore_mine', 'none'), 'Ore-rich Cave', 'uninhabited caves are named by contents only');

const mineMap = decorate(profile('map_i_test_mine', 'ore_mine'));
assert.equal(mineMap.denMotherKind, null, 'cave without an animal den strips Den-Mother');
assert.equal(mineMap.nestCol, null, 'cave without an animal den strips nest');
assert(mineMap.oreRocks.length >= 7, 'ore-rich cave reuses oreRock mechanic at rich density');

const catMap = decorate(profile('map_i_test_catacomb', 'catacomb'));
assert(catMap.caveProps.filter(item => item.key === 'ruinSanctumCoffin').length >= 3, 'catacomb places authored coffin props');
assert(!catMap.furniture.some(item => /^ruin/.test(item.itemKey)), 'authored ruin pieces stay out of FURNITURE_DEFS-keyed mapData.furniture');
assert(catMap.caveBodies.length >= 8, "catacomb has a whole lot of Mao'ao skeleton bodies lying around");
assert(!catMap.caveGhoulSpawns, 'ghouls are deep-mine morlocks, not catacomb guardians');
assert.equal(catMap.creatureSpawns.length, 0, 'cave without an animal den keeps no den creature spawns');

const denCatMap = decorate(profile('map_i_test_den_catacomb', 'catacomb', 'animal_den'));
assert.equal(denCatMap.denMotherKind, 'gar-wolf-den-mother', 'animal-den inhabitant keeps the Den-Mother');
assert.equal(denCatMap.nestCol, 4, 'animal-den inhabitant keeps the nest');
const nestFloor = new Set(denCatMap.floor.map(tile=>tile.join(','))); // Full three-tile berth must become actual walkable geometry.
for (let row=denCatMap.nestRow-3; row<=denCatMap.nestRow+4; row++) for(let col=denCatMap.nestCol-3; col<=denCatMap.nestCol+4; col++) {
  assert(nestFloor.has(`${col},${row}`),'nest has a complete 8x8 room');
  assert(!(denCatMap.colliders||[]).some(tile=>tile[0]===col&&tile[1]===row),'nest berth has no old wall colliders');
}
assert(denCatMap.caveProps.some(item => item.key === 'ruinSanctumCoffin'), 'contents coexist with an animal den');
assert(denCatMap.caveBodies.length > 0, 'bodies coexist with inhabitants when space allows');

const cacheMap = decorate(profile('map_i_test_cache', 'trapped_cache', 'bandit_hideout'));
assert(cacheMap.caveProps.some(item => item.key === 'ruinDungeonChestT2'), 'cache places the authored dungeon chest');
assert(cacheMap.caveCache && cacheMap.caveTraps.length >= 1, 'cache has functional runtime plan plus at least one trap');
const wall = cacheMap.caveSitePlan.separatorRock;
assert(wall && wall.cells.length === cacheMap.oreRocks.filter(rock => rock.caveSeparator).length, 'hidden cache is sealed behind a wall of mineable ore rocks');
assert(wall.cells.some(cell => cell.layer === 5), 'sealed chamber uses five successive mineable strata');
assert(cacheMap.oreRocks.filter(rock=>rock.caveSeparator).every(rock=>Number.isInteger(rock.caveSeparatorLayer)), 'each wall rock records its layer for diagnostics');
assert(cacheMap.caveShattercasks.some(charge=>charge.guaranteed), 'every mineable cave separator guarantees an entrance-side Shattercask');
const plan = Cave.__test.plansByMapId.get('map_i_test_cache');
assert(plan.separator.farKeys.includes(`${cacheMap.caveCache.col},${cacheMap.caveCache.row}`), 'cache sits behind the wall');
assert(cacheMap.caveShattercasks.filter(charge=>charge.guaranteed).every(charge =>
  plan.separator.nearKeys.includes(charge.col+','+charge.row)
  && !wall.cells.some(cell=>cell.col===charge.col&&cell.row===charge.row)
), 'guaranteed charge stays on the accessible side and never inside the wall');
assert(cacheMap.caveBanditSpawns.length >= 2 && cacheMap.caveBanditSpawns.every(s => plan.separator.nearKeys.includes(`${s.col},${s.row}`)), 'bandit inhabitants stay on the entrance side of the wall');

const mushroomMap = decorate(profile('map_i_test_mushroom', 'mushroom_cave'));
assert(mushroomMap.caveMushrooms.length >= 6 && mushroomMap.caveMushrooms.every(m => m.reagentKey === 'duskcapMushroom'), 'mushroom cave grows Duskcap Mushroom clusters');

const ruinMap = decorate(profile('map_i_test_ruin', 'ruin_entrance'));
assert(ruinMap.caveProps.some(item => item.key === 'ruinEntranceDoor'), 'ruin cave places the authored ruin entrance door');
const ruinSeed = ruinMap.caveRuinEntrance?.seed;
assert(Number.isInteger(ruinSeed) && ruinSeed > 0 && ruinSeed === ruinSeed >>> 0, 'ruin threshold seed is a uint32 (DevRandomRuin coerces with Number(seed)>>>0)');
assert.equal(ruinSeed, Cave.decorateCavernMapData('map_i_test_ruin', baseMap('map_i_test_ruin')).caveRuinEntrance.seed, 'ruin seed is deterministic');

// Crowded caves must respect clearance even when that means fewer decorations.
function assertSpaced(map) {
  const features = [...map.oreRocks, ...(map.caveProps || []).filter(prop => !prop.embedded), ...(map.caveBodies || []), ...(map.caveMushrooms || []), ...(map.caveBanditSpawns || []), ...(map.caveTraps || [])]; // All feature centres used to check cross-layer spacing.
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    if (features[i].caveSeparator && features[j].caveSeparator) continue; // Five mineable wall strata deliberately touch each other.
    assert(Math.hypot(features[i].col - features[j].col, features[i].row - features[j].row) >= 1.4, `${map.id}: ${JSON.stringify(features[i])} too close to ${JSON.stringify(features[j])}`);
  }
}
for (const contents of CONTENTS) for (const inhabitant of INHABITANTS) {
  const map = decorate(profile(`spacing_${contents}_${inhabitant}`, contents, inhabitant)); // Small two-room fixture exercises crowded placement.
  assertSpaced(map);
  if (inhabitant === 'animal_den') {
    for (const feature of [...(map.caveProps || []), ...(map.caveBodies || []), ...(map.caveMushrooms || []), ...map.oreRocks]) {
      for (let dc = 0; dc < 2; dc++) for (let dr = 0; dr < 2; dr++) assert(Math.hypot(feature.col - map.nestCol - dc, feature.row - map.nestRow - dr) >= 1.4, 'full nest footprint stays clear');
    }
  }
}
for (const inhabitant of INHABITANTS) {
  const map = decorate(profile(`ruin_clearance_${inhabitant}`, 'ruin_entrance', inhabitant)); // Verify opposite-end rules and oriented doorway geometry.
  const ruin = map.caveRuinEntrance;
  assert(ruin, 'two-room cave has room for a ruin entrance');
  assert.equal(map.wallHeightScale, 2.5, 'actual ruin entrances request substantially taller walls');
  const tunnel = map.caveProps.find(prop => prop.key === 'ruinEntranceTunnel'); // Rear extension belongs to the doorway assembly, not a separate floor feature.
  assert(tunnel?.embedded && tunnel.scaleZ === 1.5);
  assert.equal(ruin.tunnelTiles.length, 18, 'rear tunnel reserves six three-wide rows of solid rock');
  assert.equal(ruin.clearanceTiles.length, 42, 'door has a seven-wide clearing with five rows of approach');
  const floor = new Set(map.floor.map(([c, r]) => `${c},${r}`)); // Floor membership validates the authored door footprint.
  for (const tile of ruin.tunnelTiles) assert(!floor.has(`${tile.col},${tile.row}`), 'rear tunnel embeds in rock and never crosses another passage');
  for (const tile of ruin.clearanceTiles) {
    assert(floor.has(`${tile.col},${tile.row}`), 'door and approach fit completely on cave floor');
    for (const feature of [...map.oreRocks, ...(map.caveBanditSpawns || [])]) assert(Math.hypot(tile.col - feature.col, tile.row - feature.row) >= 1.4, 'approach has no rocks or bandits');
  }
  if (inhabitant === 'animal_den') assert(Math.hypot(ruin.col - map.nestCol - 0.5, ruin.row - map.nestRow - 0.5) >= 6, 'ruin is opposite the nest');
  if (inhabitant === 'bandit_hideout') {
    assert(map.caveBanditSpawns.length >= 2, 'hideout survives on the opposite end');
    for (const bandit of map.caveBanditSpawns) assert(Math.hypot(bandit.col - ruin.col, bandit.row - ruin.row) >= 5, 'bandits stay away from ruin');
  }
}

// Names are stable per incarnation, and resetting a slot discards all old content state.
const nameProfile=profile('map_i_name_test','trapped_cache'); // Seeded name fixture used independently of loot/inhabitants.
assert.equal(Cave.__test.generatedCaveName(nameProfile),Cave.__test.generatedCaveName(nameProfile));
assert.match(Cave.__test.generatedCaveName(nameProfile),/ Cave$/);
assert.equal(Cave.mapLabelFor('unentered'),'Unexplored cave');
Cave.__test.runtimeStateBySignature.set(nameProfile.signature,{discovered:true,cacheOpened:true,triggeredTraps:['trap'],lootedBodies:['body']});
Cave.__test.sitesByMapId.set(nameProfile.mapId,nameProfile);
Cave.__test.plansByMapId.set(nameProfile.mapId,{profile:nameProfile});
Cave.__test.banditPopulatedMaps.add(nameProfile.mapId);
Cave.resetCave(nameProfile.mapId);
assert(!Cave.__test.runtimeStateBySignature.has(nameProfile.signature),'discovery/loot/traps are removed');
assert(!Cave.__test.plansByMapId.has(nameProfile.mapId),'old placements are discarded');
assert(!Cave.__test.banditPopulatedMaps.has(nameProfile.mapId),'replacement bandits can populate again');

// Assignment-time hooks must capture dependencies before synchronous game initialization.
let seenDenCount = -1;
let seenCaveAnchors = -1;
const zoneLayouts = new Map([['map_test_wilds', { dens: workspace.animalDens, transitions: workspace.animalDens.map(den => ({ targetMapId: den.caveSite.mapId, label: 'A dark burrow' })) }]]);
context.WildlifeSpawn = {
  denCavernMapId(zoneId, denId) { return `map_i_den_${zoneId}_${denId}`; },
  init(deps) { this.deps = deps; },
  updateHostileSpawning() { seenDenCount = this.deps.zoneLayouts.get('map_test_wilds').dens.length; seenCaveAnchors = this.deps.zoneLayouts.get('map_test_wilds').caveAnchors?.length; },
  onZoneEntered() {},
  denNestCensus() { return { denCount: 999, nestTreesAlive: 0 }; },
};
context.CavernGenerator = { expandCavernMapData, synthesizeCavernMapData(id) { return baseMap(id); } };
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
assert.equal(seenCaveAnchors, workspace.animalDens.length, 'wildlife tick still sees every cave footprint (caveAnchors) for den relocation');
assert.equal(zoneLayouts.get('map_test_wilds').caveAnchors, undefined, 'caveAnchors only exists during the filtered tick');
context.WildlifeSpawn.onZoneEntered('map_test_wilds');
assert(zoneLayouts.get('map_test_wilds').transitions.every(transition => transition.label === 'Unexplored cave'), 'exterior transition label no longer advertises a den/burrow');
const census = context.WildlifeSpawn.denNestCensus('map_test_wilds');
assert.equal(census.caveCount, workspace.animalDens.length, 'wildlife diagnostics expose generic cave total');
assert.equal(census.denCount, expectedAnimalDens, 'wildlife diagnostics retain true animal-den count');

// Cave Duskcaps now use ordinary aimed getButtons/onAction picking, never proximity harvest.
{
  const granted = []; // Captures the isolated legacy loot adapter when no game-owned lightweight grant is injected.
  let xp = 0; // Counts Foraging XP earned only by a successful explicit pick.
  context.DevSpawner.init({ grantLoot(gained) { granted.push(gained); return Object.keys(gained); } });
  const cluster = mushroomMap.caveMushrooms[0]; // Stable authored cave tile used to check aimed interaction and regrowth.
  Object.assign(deps, { getCurrentArea: () => 'map_i_test_mushroom', calendar: { day: 10 }, awardForagingXp: () => { xp++; }, bonusYieldChance: () => 0, showToast() {} });
  deps.player.x = (cluster.col + 0.5) * deps.TILE; deps.player.y = (cluster.row + 0.5) * deps.TILE;
  Cave.updateCurrentCaveRuntime(1);
  assert.equal(granted.length, 0, 'walking across a mushroom never picks it automatically');
  const mushroom = Cave.objectAt('map_i_test_mushroom', cluster.col, cluster.row); // Aimed cave world object used by the same action path as wild reagents.
  assert.equal(mushroom?.getButtons()?.[0]?.action, 'obj_pick_cave_mushroom', 'aiming at a cluster offers the explicit pick action');
  assert.equal(Cave.objectAt('map_test_wilds', cluster.col, cluster.row), null, 'another area cannot target a cave cluster');
  assert.equal(mushroom.onAction('wrong_action').ok, false, 'a wrong action cannot harvest a cave cluster');
  const picked = mushroom.onAction('obj_pick_cave_mushroom'); // Result controls the generic game obj_* save dispatcher.
  assert.equal(picked.ok, true, 'manual pick succeeds');
  assert.equal(picked.deferMemberSave, true, 'pickup defers generic synchronous world save');
  assert.deepEqual(granted, [{ duskcapMushroom: 1 }], 'manual pick grants one Duskcap using the existing loot fallback');
  assert.equal(xp, 1, 'manual pick awards Foraging XP');
  assert.equal(mushroom.onAction('obj_pick_cave_mushroom').ok, false, 'the stale button cannot harvest the same cluster twice');
  assert.equal(Cave.objectAt('map_i_test_mushroom', cluster.col, cluster.row), null, 'picked clusters no longer show their action prompt');
  Cave.updateCurrentCaveRuntime(1);
  assert.equal(granted.length, 1, 'the proximity tick cannot re-pick a harvested cluster');
  deps.calendar.day = 13;
  Cave.updateCurrentCaveRuntime(1);
  const regrown = Cave.objectAt('map_i_test_mushroom', cluster.col, cluster.row); // Restores the usual three-day cave mushroom cycle.
  assert(regrown, 'mushroom can be aimed at again after its three-day regrowth window');
  assert.equal(regrown.onAction('obj_pick_cave_mushroom').ok, true, 'regrown mushroom can be picked again manually');
  assert.equal(granted.length, 2, 'regrowth still grants a second harvest only after another action');
  deps.getCurrentArea = () => 'map_test_wilds';
}

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

console.log(`PASS cave-site-system: ${workspace.animalDens.length} anchors -> ${expectedAnimalDens} animal den cave(s); contents x inhabitant layers; cache wall ${wall.cells.length} rock(s)`);

// Cavern ore rocks with a real ore look drop that ore (tile.oreKey, the Town
// Mine path); stone-look rocks stay stone-only. No iron/crystal looks remain.
{
  const oreSource = fs.readFileSync(path.join(root, 'docs/js/cavern-ore-rocks.js'), 'utf8');
  class Obj { constructor() { this.position = { set() {} }; this.children = []; } add(c) { this.children.push(c); } }
  const oreCtx = { THREE: { Mesh: Obj, Group: Obj, MeshStandardMaterial: class {} }, TerrainGeometry: { buildRockTileGeo: () => ({ stoneGeo: {} }) }, OreRockTextures: { materialFor: (_three, key) => ({ key, userData: { sharedOreRockMaterial: true } }) } };
  oreCtx.window = oreCtx;
  vm.createContext(oreCtx);
  vm.runInContext(oreSource, oreCtx, { filename: 'cavern-ore-rocks.js' });
  const ORE_DEFS = { copper: {}, tinCopper: {}, mushistonite: {}, tin: {}, arsenic: {}, lead: {}, silver: {}, gold: {} };
  oreCtx.CavernOreRocks.init({ TileType: { ROCK: 'rock' }, markOutline() {}, zoneMineableRockMeshes: new Map(), oreDefs: ORE_DEFS });
  const grid = [[{}, {}]];
  oreCtx.CavernOreRocks.build('map_i_den_test', { oreRocks: [{ col: 0, row: 0, oreKind: 'copper' }, { col: 1, row: 0, oreKind: 'stone' }] }, new Obj(), grid);
  assert.equal(grid[0][0].oreKey, 'copper', 'copper-look cavern rock drops copper ore');
  assert.equal(oreCtx.CavernOreRocks.CAVERN_ORE_TINTS.tin, 0x513c32, 'Cassiterite cave texture uses Tin Ore color rather than smithed metal');
  assert.equal(grid[0][1].oreKey, null, 'stone-look cavern rock drops stone only');
  for (const kind of Object.keys(oreCtx.CavernOreRocks.CAVERN_ORE_TINTS)) assert(kind === 'stone' || ORE_DEFS[kind], `cavern tint ${kind} is a real ore`);
  const newGrid = [[{}, {}, {}]];
  oreCtx.CavernOreRocks.build('map_i_new_ores', { oreRocks: [{ col: 0, row: 0, oreKind: 'tinCopper' }, { col: 1, row: 0, oreKind: 'mushistonite' }, { col: 2, row: 0, oreKind: 'tin' }] }, new Obj(), newGrid);
  assert.deepEqual(newGrid[0].map(cell => cell.oreKey), ['tinCopper', 'mushistonite', 'tin'], 'Wild-cave rocks preserve all three new ore identities and drops');
  const mineKinds = new Set();
  for (let i = 0; i < 40; i++) {
    for (const rock of decorate(profile(`map_i_test_ores_${i}`, 'ore_mine')).oreRocks) mineKinds.add(rock.oreKind);
  }
  for (const kind of mineKinds) assert(kind === 'stone' || ORE_DEFS[kind], `ore-mine rock kind ${kind} is stone or a real ore`);
  console.log(`PASS cavern-ore-rocks: real ore drops; mine kinds ${[...mineKinds].sort().join(', ')}`);
}

// Catacomb bodies: laid out as settled corpses with a short loot hold; a
// restless one gets up a few seconds after the player first comes near.
(async () => {
  const corpseObjects = new Set();
  const despawned = [];
  let made = 0;
  context.MinionCombat = {
    async makeEntity(opts) {
      made++;
      return { id: `skel_${made}`, x: opts.x, y: opts.y, state: opts.extra?.state, health: 10, rosterRecord: { name: opts.name, equippedCosmetics: ['rugged_poncho'] }, speciesId: opts.speciesId, def: { lootPool: opts.defOverride?.lootPool }, ...opts.extra };
    },
  };
  context.CreatureDeath = { settleAsCorpse(entity) { entity.state = 'corpse'; entity.health = 0; corpseObjects.add(entity); return true; } };
  context.DevSpawner.init({ grantLoot() { return []; }, corpseObjects, despawnCreature(entity) { despawned.push(entity); } });
  const hostiles = new Set();
  Object.assign(deps, { getCurrentArea: () => 'map_i_test_catacomb', hostileObjects: hostiles, showToast() {} });
  const bodiesPlan = Cave.__test.plansByMapId.get('map_i_test_catacomb').bodies;
  Cave.updateCurrentCaveRuntime(1);
  await Cave.__test.bodySpawnPromises.get('map_i_test_catacomb');
  const records = Cave.__test.bodiesByMapId.get('map_i_test_catacomb');
  assert.equal(records.length, bodiesPlan.length, 'every planned body is laid out');
  assert(records.every(r => r.entity.state === 'corpse' && corpseObjects.has(r.entity)), 'bodies are settled, lootable corpses');
  assert(records.every(r => r.entity.speciesId === 'mao-ao-skeleton' && r.entity.lootHoldSeconds === 2 && r.entity.keepCorpseAfterLoot), "Mao'ao skeleton bodies need a 2s hold and stay where they lie once searched");
  assert(records.every(r => r.entity.def.lootPool === 'caveSkeletonBody'), 'bodies roll the grave-goods loot pool');
  assert.equal(hostiles.size, 0, 'bodies are not live enemies until one rises');

  // Search one body: the looted state is persisted by id.
  records[0].entity.corpseLooted = true;
  Cave.updateCurrentCaveRuntime(1);
  assert(Cave.debugSnapshot().currentState.lootedBodies.includes(records[0].body.id), 'searched bodies are remembered');

  // Make one body restless and walk up to it.
  for (const r of records) { r.riser = false; r.armedAt = null; } // An earlier update may already have armed a randomly chosen riser; start its timer fresh.
  const riser = records[1];
  riser.riser = true;
  deps.player.x = (riser.body.col + 0.5) * deps.TILE; deps.player.y = (riser.body.row + 0.5) * deps.TILE;
  Cave.updateCurrentCaveRuntime(1);
  assert(riser.armedAt != null && riser.delay >= 3 && riser.delay <= 12, 'walking close arms a 3-12s delay');
  const oldCorpse = riser.entity;
  Cave.updateCurrentCaveRuntime(riser.delay - 0.5);
  assert(!riser.risen && !riser.rising, 'nothing happens before the delay runs out');
  Cave.updateCurrentCaveRuntime(1);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert(riser.risen, 'the restless body rises after its delay');
  assert(hostiles.has(riser.entity) && riser.entity.state === 'chase', 'it comes up fighting');
  assert(!corpseObjects.has(oldCorpse) && despawned.includes(oldCorpse), 'the corpse is replaced where it lay');
  assert.deepEqual(riser.entity.rosterRecord.equippedCosmetics, ['rugged_poncho'], 'an unsearched body rises in its own rags');
  console.log(`PASS cave catacomb bodies: ${records.length} bodies, riser up after ${riser.delay.toFixed(1)}s`);
})().catch(error => { console.error(error); process.exitCode = 1; });


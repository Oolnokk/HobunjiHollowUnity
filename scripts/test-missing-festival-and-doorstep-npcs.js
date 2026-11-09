#!/usr/bin/env node
'use strict';

// Regressions for NPCs missing from festivals and pending farmhouse trust visits.
// Run: node scripts/test-missing-festival-and-doorstep-npcs.js
const assert = require('node:assert/strict'); // Reports behavioral and authored-data regressions.
const fs = require('node:fs'); // Reads the actual shipping scripts rather than a copied simulator.
const path = require('node:path'); // Resolves script paths independent of the working directory.
const root = path.resolve(__dirname, '..'); // Repository root used by the shared file reader.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Reads exact production code.

function object3D(name) {
  const node = { // Supplies the small Object3D interface used by actual doorstep cloning.
    name, isObject3D: true, userData: {}, children: [],
    position: {x: 0, y: 0, z: 0, set(x, y, z) {this.x = x; this.y = y; this.z = z;}},
    rotation: {x: 0, y: 0, z: 0, set(x, y, z) {this.x = x; this.y = y; this.z = z;}},
    add(child) {child.parent = node; node.children.push(child);},
    remove(child) {const index = node.children.indexOf(child); if (index >= 0) node.children.splice(index, 1);},
    clone() {return object3D(this.name);},
  };
  return node;
}

async function testDoorstepRecovery() {
  const source = read('docs/js/doorstep-visits.js'); // Executes the same shipping visitor registration, polling and spawn logic.
  const walkers = []; // Simulates Pahu missing from the live scheduled NPC collection.
  const world = {area: 'farm'}; // Controls the farmhouse transition and the recovery callback's area check.
  const scene = object3D('farmScene'); // Hosts the recovered visitor clone.
  let finishRecovery = null; // Resolves the simulated avatar build when its real source has been added.
  let recoveryCount = 0; // Ensures one farmhouse exit requests one recovery.
  const win = {
    location: {pathname: '/index.html'}, setInterval() {return 0;}, __farmLog() {},
    HousePieces: {debugPieceFeatures() {return [{id: 'house', features: [
      {id: 'door', type: 'entrance', side: 'south', doorTile: '27,6', approachTile: '27,7'},
    ]}];}},
    NpcPathfinding: {isNpcTileWalkable: () => true},
    NpcScheduling: {init() {}}, BanditCombat: {init() {}},
    DialogueContent: {init() {}, beginNpcConversation() {}, advanceNpcDialogue() {}},
  };
  const document = {addEventListener() {}, dispatchEvent() {}, getElementById() {return null;}}; // Browser integration stub.
  new Function('window', 'document', 'performance', 'setTimeout', 'CustomEvent', source)(
    win, document, {now: () => 10000}, () => {}, class CustomEvent {}
  );
  win.NpcScheduling.init({npcWalkers: walkers, getCurrentArea: () => world.area});
  win.BanditCombat.init({
    getActiveScene: () => scene, getCurrentArea: () => world.area,
    getActiveGrid: () => null, getPlayerFaceTarget: () => ({x: 27.5, z: 7.5}),
  });
  win.DialogueContent.init({
    getPlayerData: () => ({appearance: {gender: 'male'}}),
    fishingTimeOfDay: () => 'day', closeNpcDialogue() {},
  });
  win.DoorstepVisits.init({
    getPlayerTile: () => ({c: 27.5, r: 7.5}),
    ensureNpcWalker(npcId) {
      assert.equal(npcId, 'pahu', 'only the requested Pahu source is rebuilt');
      recoveryCount++;
      return new Promise(resolve => {finishRecovery = resolve;});
    },
  });
  win.DoorstepVisits.registerProvider({
    id: 'trust', next: () => ({key: 'pahu_grapple', npcId: 'pahu', tree: {
      entryNode: 'hello', nodes: [{id: 'hello', type: 'text', text: 'Ahoy!', next: null}],
    }}),
  });

  win.DoorstepVisits.onAreaTransition('interior', 'farm');
  assert.equal(win.DoorstepVisits.activeVisitKey(), null, 'a visit cannot clone an absent source');
  assert.equal(recoveryCount, 1, 'an absent source requests one real-avatar recovery');
  assert.match(win.DoorstepVisits.debugSnapshot().lastSpawnAttempt.reason, /recovery requested/);

  const sourceRoot = object3D('pahu'); // Authored avatar root becomes available when the NPC build finishes.
  const avatarGroup = object3D('avatar'); // Cloned visitor's portrait references its own child hierarchy.
  sourceRoot.add(avatarGroup);
  walkers.push({rec: {id: 'pahu', dialogueTrees: []}, root: sourceRoot, avatarGroup, area: 'map_i_inn'});
  finishRecovery(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(win.DoorstepVisits.activeVisitKey(), 'pahu_grapple', 'recovering Pahu retriggers the pending farmhouse visit');
  assert.equal(walkers.filter(walker => walker._doorstepVisitor).length, 1, 'recovery creates one visitor clone, not two');
  assert.equal(win.DoorstepVisits.sourceWalker('pahu').root, sourceRoot, 'original scheduled actor remains authoritative');
}

async function testGameAvatarRecovery() {
  const game = read('docs/game.js'); // Production entrypoint holds the asynchronous NPC avatar construction owner.
  const start = game.indexOf('      async function ensureScheduledNpcWalker(npcId)');
  const end = game.indexOf('\n      // NPC scheduling (resolveNpcScheduleTarget', start);
  assert(start >= 0 && end > start, 'game exports a single recovery function before scheduler startup');
  const helper = game.slice(start, end); // Evaluates the real helper in isolation without WebGL initialization.
  const walkers = []; // Receives recovered world NPC actors.
  const records = new Map([['pahu', {id: 'pahu'}], ['leaf', {id: 'leaf'}], ['missing', {id: 'missing'}]]);
  const inFlight = new Map(); // Proves simultaneous recovery calls share the same pending build.
  const cooldowns = new Map(); // Holds retry cooldowns for unresolved targets.
  const diagnostics = new Map(); // Confirms recovery stages remain available to the mobile companion.
  const visitorPending = new Set(); // Mirrors the existing recurring-visitor duplication guard.
  let builds = 0; // Counts avatar builds to detect duplicates.
  const build = async rec => {builds++; await Promise.resolve(); return {rec, root: object3D(rec.id)};};
  const target = rec => rec.id === 'missing' ? null : {area: 'map_i_inn', c: 2, r: 3};
  const recovery = new Function(
    'npcWalkers', 'scheduledNpcRecords', 'npcSpawnPromises', 'npcRecoveryRetryAfter',
    'npcSpawnDiagnostics', 'visitorSpawnPending', 'resolveNpcScheduleTarget',
    'makeNpcWalker', 'window', 'performance', helper + '\nreturn ensureScheduledNpcWalker;'
  )(
    walkers, records, inFlight, cooldowns, diagnostics, visitorPending, target, build,
    {NpcScheduling: {hasPresenceSchedule: () => false}, __farmLog() {}},
    {now: () => 100}
  );

  assert.deepEqual(await Promise.all([recovery('pahu'), recovery('pahu'), recovery('pahu')]), [true, true, true]);
  assert.equal(builds, 1, 'three requests construct one Pahu');
  assert.equal(walkers.length, 1, 'only one Pahu enters the live walker collection');
  assert.equal(await recovery('missing'), false, 'no fabricated spawn without a valid schedule target');
  assert.equal(await recovery('missing'), false, 'cooldown preserves unresolved stations without building');
  assert.equal(builds, 1);
  assert.equal(await recovery('leaf'), true, 'Leaf can be independently recovered');
  assert.equal(walkers.length, 2);
  assert.equal(diagnostics.get('leaf').stage, 'Walker recovered for event');
}

async function testFestivalRecovery() {
  const festivalSource = read('docs/js/festival-system.js'); // Actual festival recovery helper and home classification.
  const start = festivalSource.indexOf('  function recoverMissingFestivalGuests(now)');
  const end = festivalSource.indexOf('\n  function update() {', start);
  assert(start >= 0 && end > start, 'festival recovery remains integrated in the low-frequency update');
  assert.match(festivalSource, /'little_swamp_house'/, 'the authored household is part of the festival resident list');
  const residents = [ // Exercises two absent townsfolk, one trader, one contextual departure and one present smith.
    {id: 'pahu'}, {id: 'leaf'}, {id: 'jubmir', visitorPresence: {visits: []}},
    {id: 'father_hunundi_hodu'}, {id: 'kzubug'},
  ];
  const existing = [{rec: {id: 'kzubug'}}]; // Already-created walkers never rebuild.
  const requested = []; // Records festival recovery requests.
  const deps = {
    ensureNpcWalker: async id => {requested.push(id); return true;},
    getWalkers: () => existing,
    isFestivalSuspended: () => false,
  };
  const contextAbsent = new Set(['father_hunundi_hodu']); // Models Hunundi's genuine absence on one festival and normal attendance on another.
  const scheduling = {
    getVisitorPresence: rec => contextAbsent.has(rec.id) ? {active: false} : null,
  };
  const recover = new Function(
    'deps', 'residents', 'festivalHours', 'window', 'Promise',
    'let lastMissingGuestCheckAt = -Infinity;\n' + festivalSource.slice(start, end) +
    '\nreturn recoverMissingFestivalGuests;'
  )(deps, () => residents, () => true, {NpcScheduling: scheduling, __farmLog() {}}, Promise);
  recover(4000);
  await Promise.resolve();
  assert.deepEqual(requested, ['pahu', 'leaf'], 'only absent resident actors are recovered');
  recover(6000);
  await Promise.resolve();
  assert.equal(requested.length, 2, 'recovery does not rebuild on every festival tick');
  recover(7500);
  await Promise.resolve();
  assert.equal(requested.length, 4, 'another check is allowed after the throttle interval');
  contextAbsent.delete('father_hunundi_hodu'); // An authored presence provider exists but its absence no longer applies.
  recover(11000);
  await Promise.resolve();
  assert.deepEqual(requested.slice(4), ['pahu', 'leaf', 'father_hunundi_hodu'], 'inactive presence rules must not hide a genuine resident forever');
}

function testWildernessHomeRoutes() {
  const game = read('docs/game.js'); // Extracts the actual area transition owner in the live game.
  const code = read('docs/js/npc-pathfinding.js'); // Runs the production graph search, not a duplicate BFS.
  const start = game.indexOf('      function npcTransitionPool(area) {');
  const end = game.indexOf('\n      }\n', start) + '\n      }'.length;
  assert(start >= 0 && end > start, 'the game exposes live wilderness transitions to NPC pathfinding');
  const interiors = new Map([ // Two connected rooms and a town inn reproduce Leaf and Pahu's actual home-to-inn graph.
    ['map_i_swamp_house_leaf', {transitions: [{target: 'building', targetMapId: 'map_i_swamp_house', col: 9, row: 5, targetCol: 8, targetRow: 4}], cols: 20, rows: 20}],
    ['map_i_swamp_house', {transitions: [{target: 'exit_building', col: 9, row: 8}, {target: 'building', targetMapId: 'map_i_swamp_house_leaf', col: 7, row: 4, targetCol: 9, targetRow: 7}], cols: 20, rows: 20}],
    ['map_i_inn', {transitions: [{target: 'exit_building', col: 2, row: 9}], cols: 20, rows: 20}],
  ]);
  const zones = new Map([ // Mirrors the Eastern Mire's preserved Little Swamp House door and town gate.
    ['map_eastern_mire', {transitions: [{target: 'building', targetMapId: 'map_i_swamp_house', col: 34, row: 29}], toTownExit: {col: 1, row: 20}}],
  ]);
  const zoneDefs = {map_eastern_mire: {entryCol: 1, entryRow: 20, exitCol: 1, exitRow: 20, townReturnCol: 58, townReturnRow: 25}};
  const town = [{target: 'building', targetMapId: 'map_i_inn', col: 30, row: 21}, {target: 'zone', targetMapId: 'map_eastern_mire', col: 59, row: 25}];
  const isBuilding = area => area.startsWith('map_i_');
  const preserved = {map_eastern_mire: [{id: 'sp_emi_swamp', col: 34, row: 29, targetMapId: 'map_i_swamp_house'}]}; // Source-of-truth fixed door before generation finishes.
  const poolFactory = new Function(
    '_isBuildingArea', '_buildingScenes', 'worldTownTransitions', '_isZoneArea',
    '_zoneLayouts', 'EXTERIOR_ZONES', 'worldTransitions', 'TOTHAL_PRESERVED_TRANSITIONS',
    game.slice(start, end) + '\nreturn npcTransitionPool;'
  );
  const pool = poolFactory(isBuilding, interiors, town, area => area === 'map_eastern_mire', zones, zoneDefs, [], preserved);
  const coldPool = poolFactory(isBuilding, interiors, town, area => area === 'map_eastern_mire', new Map(), zoneDefs, [], preserved); // Pre-Tothal scene has no live grid.
  assert.equal(coldPool('map_eastern_mire')[0].targetMapId, 'map_i_swamp_house', 'pre-shift known house entrance remains discoverable');
  assert.equal(coldPool('map_eastern_mire').some(t => t.target === 'town'), false, 'NPCs cannot cross unfinished wilderness terrain');
  const win = {}; // Actual pathfinding namespace registered by its production module.
  new Function('window', code)(win);
  win.NpcPathfinding.init({
    npcTransitionPool: pool, buildingScenes: interiors, loadBuildingScene() {},
    isBuildingArea: isBuilding, buildingSpawnFromExit: () => ({col: 5, row: 5}),
    npcExteriorAreas: () => ['town', 'farm', 'map_eastern_mire'],
    npcZoneEntryPoint: area => zoneDefs[area] ? {c: zoneDefs[area].entryCol, r: zoneDefs[area].entryRow} : null,
  });
  const homeExit = win.NpcPathfinding.areaLinksFrom('map_i_swamp_house'); // Home must exit into its own Mire door, not town at (0,0).
  assert.equal(homeExit.find(link => link.toArea === 'map_eastern_mire')?.spawn.c, 34);
  assert.equal(homeExit.find(link => link.toArea === 'map_eastern_mire')?.spawn.r, 29);
  assert.equal(win.NpcPathfinding.findNpcAreaLink('map_i_swamp_house_leaf', 'map_i_inn')?.toArea, 'map_i_swamp_house');
  assert.equal(win.NpcPathfinding.findNpcAreaLink('town', 'map_i_swamp_house_leaf')?.toArea, 'map_eastern_mire');
}

function testUnloadedWildernessTravel() {
  const game = read('docs/game.js'); // Uses the exact walker update branch that handles missing offscreen zone grids.
  const start = game.indexOf('              if (_isZoneArea(this.area) && !npcGridForArea(this.area)) {');
  const end = game.indexOf('              if (!this._exitSpot) {', start);
  assert(start >= 0 && end > start, 'unloaded zone transfers are handled before ordinary tile pathfinding');
  const code = game.slice(start, end); // Evaluates the production branch using a minimal real walker interface.
  const advance = new Function(
    'targetArea', '_isZoneArea', 'npcGridForArea', 'findNpcAreaLink', 'target',
    code + '\nreturn false;'
  );
  const hops = []; // Captures offscreen walker transfers.
  const walker = {
    area: 'map_eastern_mire', _exitSpot: {c: 1, r: 20}, _entrySpot: {c: 58, r: 25}, _exitToArea: 'town',
    transferToArea(area, spawn) {hops.push({area, spawn}); this.area = area;},
  };
  const zone = area => area === 'map_eastern_mire';
  const nextHop = () => ({toArea: 'town', spawn: {c: 58, r: 25}});
  advance.call(walker, 'map_i_inn', zone, () => null, nextHop, {area: 'map_i_inn', c: 3, r: 11});
  assert.deepEqual(hops, [{area: 'town', spawn: {c: 58, r: 25}}], 'an unloaded Mire scene advances its NPC toward the town gate');
  assert.equal(walker._exitSpot, null, 'old local paths are discarded after the virtual offscreen hop');
  walker.area = 'map_eastern_mire';
  advance.call(walker, 'map_i_inn', zone, () => [[{type: 'grass'}]], nextHop, {area: 'map_i_inn', c: 3, r: 11});
  assert.equal(hops.length, 1, 'loaded wilderness keeps normal physical walking rather than using a virtual hop');
}

function testDoorstepProxiesExcludedFromFestivalRoster() {
  const game = read('docs/game.js'); // Extracts the festival NPC roster source owned by game initialization.
  const line = game.split('\n').find(value => value.includes('getNpcs: () => [...new Map('));
  assert(line, 'festival NPC registration reads the authoritative scheduled roster');
  const expression = line.slice(line.indexOf('getNpcs:') + 'getNpcs:'.length).split(', // Festival')[0]; // Retains the shipped arrow expression.
  const getNpcs = new Function('scheduledNpcRecords', 'npcWalkers', 'return (' + expression + ');')(
    new Map([['pahu', {id: 'pahu', homeId: 'little_swamp_house'}]]),
    [{rec: {id: 'doorstep_visit:pahu', homeId: 'little_swamp_house'}, _doorstepVisitor: true}],
  );
  assert.deepEqual(getNpcs().map(rec => rec.id), ['pahu'], 'temporary visit clones are not separate festival guests');
}

function testAuthoredHomeAndTrust() {
  const records = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json')).npcs; // Actual authored household/agenda records.
  const home = JSON.parse(read('docs/config/maps/map_i_swamp_house_leaf.json')); // Actual shared bedroom used at night.
  for (const id of ['pahu', 'leaf']) {
    const rec = records.find(entry => entry.id === id);
    assert(rec, id + ' must have a real authored NPC record');
    assert.equal(rec.homeId, 'little_swamp_house');
    assert.equal(rec.scheduleHooks.defaultMapId, 'map_i_swamp_house_leaf');
    assert(rec.agenda.some(beat => beat.destinationArea === 'map_i_inn'), id + ' should visit the inn by day');
    assert(rec.agenda.some(beat => beat.destinationArea === home.id), id + ' should return to the shared bedroom');
  }
  for (const id of ['station_swamp_pahu_bed', 'station_swamp_leaf_bed']) {
    assert(home.npcStations.some(station => station.id === id), id + ' must exist in the physical room');
  }
  const configWindow = {}; // Executes the shipped data-only trust provider without browser boot.
  new Function('window', read('docs/config/weapon-trust-visits.js'))(configWindow);
  const config = configWindow.WEAPON_TRUST_VISIT_CONFIG;
  const gift = config.gifts.find(entry => entry.npcId === 'pahu');
  assert(gift && gift.id === 'pahu_grapple_flail', 'Pahu retains his authored Grapple-Flail gift');
  assert.equal(config.relationship.requiredHearts, 5, 'Pahu trust visit remains gated at five hearts');
}

(async function run() {
  testAuthoredHomeAndTrust();
  testWildernessHomeRoutes();
  testUnloadedWildernessTravel();
  testDoorstepProxiesExcludedFromFestivalRoster();
  await testGameAvatarRecovery();
  await testFestivalRecovery();
  await testDoorstepRecovery();
  console.log('Event NPC recovery: household, trust gate, wilderness house routes, unloaded-scene travel, unique festival residents, concurrent avatar builds and doorstep retry passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});

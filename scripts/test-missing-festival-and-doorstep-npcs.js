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
  const scheduling = {
    hasPresenceSchedule: rec => !!rec.visitorPresence || rec.id === 'father_hunundi_hodu',
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
  await testGameAvatarRecovery();
  await testFestivalRecovery();
  await testDoorstepRecovery();
  console.log('Event NPC recovery: household, trust gate, missing festival guests, concurrent avatar builds and doorstep retry passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});

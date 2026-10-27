'use strict';
const assert = require('node:assert/strict'); // Validates the shipping maps and runtime provider.
const fs = require('node:fs'); // Loads canonical repository fixtures.
const vm = require('node:vm'); // Runs story state without starting WebGL.
const readMap = id => JSON.parse(fs.readFileSync(`docs/config/maps/${id}.json`, 'utf8')); // Shared map loader for round-trip checks.
const hall = readMap('map_i_inn_F2'); // Expanded six-door hall.
const roomDoors = hall.exits.filter(exit => exit.targetMap !== 'map_i_inn'); // Excludes the downstairs transition.
const index = JSON.parse(fs.readFileSync('docs/config/maps/index.json', 'utf8')); // Ensures new rooms are reachable through the shipping map loader.
assert.equal(roomDoors.length, 6);
assert.equal(roomDoors.filter(exit => exit.tiles[0][1] < 8).length, 3);
assert.equal(roomDoors.filter(exit => exit.tiles[0][1] > 8).length, 3);
const onFloor = (map, c, r) => map.floor.some(tile => tile[0] === c && tile[1] === r); // Checks spawn and exit coordinates.
const reachable = (map, start) => {
  const seen = new Set([start.join(',')]); // Tracks the connected walkable component.
  const queue = [start]; // Breadth-first traversal follows cardinal floor adjacency.
  for (const [c, r] of queue) {
    for (const tile of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
      if (!seen.has(tile.join(',')) && onFloor(map, ...tile)) { seen.add(tile.join(',')); queue.push(tile); }
    }
  }
  return seen;
};
const hallReachable = reachable(hall, [3, 8]); // Starts at the ground-floor stairs' actual destination.
for (const door of hall.exits) {
  const destination = readMap(door.targetMap); // Loads the real target of every upstairs exit.
  for (const [c,r] of door.tiles) {
    // The exit's authored coordinate may be a floorless wall marker; its one
    // inward neighbor must still connect to the hall's main walkable area.
    const inward = { north:[0,-1],south:[0,1],east:[1,0],west:[-1,0] }[door.direction];
    const approach = inward && [c+inward[0],r+inward[1]];
    assert(hallReachable.has(`${c},${r}`) || (approach && hallReachable.has(approach.join(','))),`${door.id} is connected to stairs`);
  }
  assert(onFloor(destination, door.spawnCol, door.spawnRow), `${door.id} lands on floor`);
  assert(!destination.exits.some(exit => exit.tiles.some(([c, r]) => c === door.spawnCol && r === door.spawnRow)), 'arrival avoids immediate exit retrigger');
  if (door.targetMap === 'map_i_inn') continue;
  assert(index.maps.some(entry => entry.id === destination.id));
  assert(destination.furniture.some(item => item.itemKey === 'basicBedFurniture'));
  const back = destination.exits[0]; // Every guest room returns to the hall next to its own door.
  assert.equal(back.targetMap, hall.id);
  assert(onFloor(hall, back.spawnCol, back.spawnRow));
  assert.equal(back.spawnCol, door.tiles[0][0]);
}
const db = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8')); // Canonical NPC schedule and actor fixture.
for (const id of ['jubmir', 'hreesh']) {
  const npc = db.npcs.find(record => record.id === id); // Authored NPC with both legacy and agenda schedule formats.
  const room = readMap(`map_i_inn_F2_${id}`); // Named room retains its wardrobe ownership and bed station.
  const sleep = npc.agenda.find(entry => entry.activity === 'sleep'); // Active scheduler's nighttime destination.
  assert.equal(sleep.destinationArea, room.id);
  assert(room.npcStations.some(station => station.id === sleep.destinationStationId));
  assert(npc.scheduleHooks.rules.some(rule => rule.mapId === room.id && rule.stationId === sleep.destinationStationId));
  assert(room.furniture.some(item => item.npcWardrobeFor === id));
}

const source = fs.readFileSync('docs/js/opening-story-cutscene.js', 'utf8'); // Executes the module owning farm-tour timestamps and follow-up visits.
const profile = { characterId: 'farmer', worldId: 'world', isWorldOwner: true }; // Owner story state.
const storage = new Map(); // Persists between VM reloads to test interruption/reload behavior.
let hour = 10; // Absolute world hour advances across a day boundary below.
let panel; // Captures the visible companion panel registered by the shipping story module.
let storyTarget; // Captures the scheduling override used by recurring visitor arrivals.
let provider; // Captures the actual registered DoorstepVisits provider.
let playback = 'complete'; // Controls the shared runner's final-line/skip/failure outcomes.
let lastScene; // Records the live scene passed to the runner.
let dismissed = 0; // Confirms invitation alone never dismisses the story visitor.
const context = {
  window: {
    __hobunjiPlayerProfile: profile, __hobunjiGameStarted: true,
    DevCompanion: { registerStateProvider() {}, registerPanel: value => { panel = value; } },
    CalendarSystem: { isInitialized: () => true, previewAfterHours: () => ({ day: Math.floor(hour / 24) + 1, time01: hour % 24 }), getHour: value => value },
    NpcScheduling: { registerTargetOverride: (id, callback) => { storyTarget = callback; }, resolveNpcStationTarget: () => null },
    DoorstepVisits: { registerProvider: value => { provider = value; }, markDone() {}, dismissVisit() { dismissed++; } },
    LocalDBOverrides: { loadDatabase: async () => db },
    AuthoredCutsceneRuntime: { farmTourPoints: () => ({ entry: {}, porch: {}, guide: {}, playerPorch: {} }), run: async (scene, options) => {
      lastScene = scene;
      if (playback === 'error') throw new Error('fixture setup failure');
      if (playback === 'complete') options.onDialogueContinue(scene.stages.find(stage => stage.id === (scene.mapId === 'farm' ? 'farm_tour_final' : 'fey_final')));
    } },
  },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
  document: { addEventListener() {} }, performance: { now: () => 0 }, console,
}; // Minimal injected runtime still runs shipping eligibility, timestamps, scene graph and async completion.
vm.runInNewContext(source, context);
let api = context.window.OpeningStoryCutscene; // Rebound after reload to verify persisted behavior.
storage.set(api.stateKey(profile), 'complete');

(async () => {
  assert.equal(panel.title, 'Opening Story / Doorstep Visits');
  assert.equal(panel.when(), true);
  assert.match(panel.render().summary, /farm tour is not marked complete/);
  const beforeRender = storage.size; // Rendering must never initialize the legacy migration timer.
  panel.render();
  assert.equal(storage.size, beforeRender);
  assert.equal(provider.next(), null, 'visit cannot precede farm tour');
  assert(await api.onFarmEntered(profile));
  assert.equal(storage.get(api.tourKey(profile) + ':completed-hours'), '10');
  assert.match(panel.render().summary, /12-hour delay/);
  hour = 21.99;
  assert.equal(provider.next(), null, 'not eligible before twelve hours');
  vm.runInNewContext(source, context);
  api = context.window.OpeningStoryCutscene;
  const visitor = { id: 'jubmir', visitorPresence: { entrance: { mapId: 'map_hobunji_town', c: 30, r: 48 } } }; // Absent trader fixture.
  assert.equal(storyTarget(visitor, { hasExistingWalker: false }), null);
  hour = 22;
  assert.equal(storyTarget(visitor, { hasExistingWalker: false }).visitorArrival, true);
  assert.equal(storyTarget(visitor, { hasExistingWalker: true }).visitorArrival, false);
  assert.equal(storyTarget({ id: 'hreesh' }, { hasExistingWalker: false }), null);
  assert.equal(provider.next().npcId, 'jubmir', 'eligible exactly twelve hours after completion, including reload');
  context.window.DoorstepVisits.debugSnapshot = () => ({ schedulingReady: false, providers: ['jubmir_great_fey'], currentArea: 'farm' });
  context.window.DoorstepVisits.sourceWalker = () => null;
  context.window.DoorstepVisits.exitDoorCandidates = () => [];
  assert.match(panel.render().summary, /NPC scheduling connection/);
  assert.equal(panel.render().rows.find(row => row[0] === 'Doorstep NPC scheduling connected')[1], 'No');
  context.window.DoorstepVisits.debugSnapshot = () => ({ schedulingReady: true, providers: ['jubmir_great_fey'], currentArea: 'farm', lastSpawnAttempt: { key: 'jubmir_great_fey', reason: 'Source NPC is unavailable.' } });
  assert.match(panel.render().summary, /source NPC is unavailable/);
  assert.match(panel.render().rows.find(row => row[0] === 'Last spawn attempt')[1], /Source NPC is unavailable/);
  context.window.DoorstepVisits.sourceWalker = () => ({});
  assert.match(panel.render().summary, /Ready/);
  profile.isWorldOwner = false;
  assert.match(panel.render().summary, /world owner/);
  assert.equal(provider.next(), null, 'joining characters do not repeat owner story');
  profile.isWorldOwner = true;
  playback = 'interrupted';
  assert.equal(await api.playJubmirFeyVisit(), false);
  assert(provider.next(), 'unfinished scene remains retryable');
  playback = 'error';
  assert.equal(await api.playJubmirFeyVisit(), false);
  assert(provider.next(), 'setup failure remains retryable');
  assert.equal(dismissed, 0);
  assert(api.debugSnapshot().lastError.includes('fixture'));
  hour = 30;
  assert.equal(api.debugSnapshot().jubmirFey.hoursUntilVisit, 0, 'eligibility survives day rollover');
  playback = 'complete';
  assert(await api.playJubmirFeyVisit());
  assert.equal(lastScene.mapId, 'map_i_inn_F2_jubmir');
  assert(lastScene.actors.find(actor => actor.npcId === 'jubmir').npcRecord.id === 'jubmir');
  const playerSpot = lastScene.actors.find(actor => actor.isPlayer); // Confirms the cinematic does not begin beyond ordinary dialogue range.
  const jubmirSpot = lastScene.actors.find(actor => actor.npcId === 'jubmir'); // Partner stands on the adjacent walkable tile.
  assert.equal(Math.hypot(playerSpot.worldC - jubmirSpot.worldC, playerSpot.worldR - jubmirSpot.worldR), 1);
  const roomFloor = readMap('map_i_inn_F2_jubmir'); // Room geometry and furniture are the shipping authoring source.
  for (const actor of [playerSpot, jubmirSpot]) {
    assert(onFloor(roomFloor, actor.worldC, actor.worldR), 'dialogue actor stands on room floor');
    assert(!roomFloor.furniture.some(item => item.col === actor.worldC && item.row === actor.worldR), 'dialogue actor starts clear of furniture');
  }
  const orbitParagraphs = lastScene.stages.filter(stage => stage.cameraMode === 'orbit'); // Both opening and guidance paragraphs receive independent orbit resets.
  assert(orbitParagraphs.length > 30);
  assert(orbitParagraphs.every(stage => stage.orbitActorIds.join(',') === 'player,jubmir'
    && stage.orbitAlternateFocus === true && stage.orbitZoomStepPercent === 5
    && stage.orbitInitialZoomPercent === 131.25 && stage.orbitHeightMode === 'oppositeFaceArc' && stage.orbitDistanceTiles === 1.85
    && stage.orbitInstantCut === true && stage.orbitBlendSeconds === 1
    && stage.horizontalCameraCollision === true
    && stage.orbitDirection === 'clockwise' && stage.orbitDirectionSwitchEvery === 2
    && stage.orbitDirectionalStartOffsetDeg === 30),
    'all Jubmir paragraphs use instant cuts, CW/CW/CCW/CCW with matching 30 degree lead-ins, and preserve the optional smooth blend');
  assert(orbitParagraphs.some(stage => stage.id === 'fey_why'), 'optional answer also follows the orbit progression');
  assert(orbitParagraphs.some(stage => stage.id === 'fey_final'), 'final spoken paragraph keeps the orbit');
  assert.equal(provider.next(), null, 'completed scene never queues another visit');
  assert.equal(dismissed, 1);
  assert.equal(storyTarget(visitor, { hasExistingWalker: true }), null, 'completion restores trading schedule');
  assert.match(panel.render().summary, /conversation is complete/);
  const byId = new Map(lastScene.stages.map(stage => [stage.id, stage])); // Walks both actual choice branches through the final dialogue.
  for (const option of byId.get('fey_question').options) {
    let id = option.next; // Current branch stage.
    let reachedFinal = false; // Guards against a branch that silently skips the final lead.
    const visited = new Set(); // Detects accidental graph loops.
    while (id !== '__end__') {
      assert(!visited.has(id)); visited.add(id);
      const stage = byId.get(id); // Resolves explicit and sequential stage transitions.
      assert(stage, `missing stage ${id}`);
      if (id === 'fey_final') reachedFinal = true;
      id = stage.next === '__next__' ? lastScene.stages[lastScene.stages.indexOf(stage) + 1]?.id : stage.next;
    }
    assert(reachedFinal, 'both answers retain all guidance and Hunundi lead');
  }
  profile.worldId = 'legacy';
  storage.set(api.tourKey(profile), 'complete');
  assert.equal(provider.next(), null, 'legacy tour with missing timestamp gets a fresh delay');
  hour += 12;
  assert(provider.next(), 'legacy migration timer eventually queues the visit');
  console.log('Inn six-room connectivity, schedules, farm-tour timing, reload, owner scope, scene retries and dialogue branches passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

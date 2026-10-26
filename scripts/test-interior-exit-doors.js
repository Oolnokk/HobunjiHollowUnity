'use strict';
// Execute shared exit-door placement, arrival directions, and collision behavior.
const assert = require('node:assert/strict'); // Used by the behavior checks below.
const fs = require('node:fs'); // Loads shipped code and map data.
const vm = require('node:vm'); // Runs browser modules without the game renderer.
const context = { window: {}, console }; // Browser surface shared by the two runtime authorities.
for (const file of ['interior-door-tiles', 'building-entry-spawn']) vm.runInNewContext(fs.readFileSync(`docs/js/${file}.js`, 'utf8'), context);
const Doors = context.window.InteriorDoorTiles; // Runtime placement and door-state API under test.
const Spawn = context.window.BuildingEntrySpawn; // Runtime spawn and facing API under test.
const vectors = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }; // Authored inward directions checked against game angle convention.
for (const [direction, [dc, dr]] of Object.entries(vectors)) {
  const transition = { col: 5, row: 5, direction, target: 'exit_building' }; // Exterior entry on each possible wall.
  const building = { transitions: [transition] }; // Minimal loaded building scene.
  const spawn = Spawn.fromExit(building, 20, 20); // Expected to step into the building from this door.
  assert.equal(spawn.col, 5 + dc);
  assert.equal(spawn.row, 5 + dr);
  assert.equal(Spawn.arrivalAngle(building, spawn.col, spawn.row, 'town'), Math.atan2(dr, dc));
}
assert.equal(Spawn.arrivalAngle({ transitions: [
  { col: 4, row: 4, direction: 'north', targetMapId: 'other' },
  { col: 5, row: 4, direction: 'west', targetMapId: 'hall' },
] }, 4, 4, 'hall'), Math.PI, 'reciprocal exit wins over an unrelated closer door');
assert.equal(Spawn.arrivalAngle({}, 0, 0, 'hall'), null, 'old/generated maps retain their fallback facing');
assert.equal(Spawn.arrivalAngle({ transitions: [{ direction: 'invalid' }] }, 0, 0, 'hall'), null);

(async () => {
  const groups = []; // Authored group doubles expose mechanism state to collision checks.
  const interactables = []; // Must receive public-space doors but never replace exit travel actions.
  const mechanisms = new Map(); // Mirrors the puzzle runtime's open/closed movement flag.
  context.window.AuthoredFurniture = { peek: () => ({}), buildGroup: () => {
    const group = { position: { set() {} }, rotation: {}, userData: { blocksMovement: true } }; // Fresh mesh metadata per door.
    groups.push(group); return group;
  } };
  context.window.FurniturePuzzleRuntime = {
    registerMap: (id, records, objects) => { for (const [key, object] of objects) mechanisms.set(key, object); },
    setMechanism: (id, key, open) => { mechanisms.get(key).userData.blocksMovement = !open; },
  };
  const data = { doorTiles: [[1, 1], [3, 1]], exits: [{ id: 'toHall', tiles: [[1, 1]], generateDoor: true, direction: 'east' }] }; // An overlapping painted door must produce only one exit door.
  const records = Doors.doorRecordsOf(data); // Same records feed editor previews and scene construction.
  assert.equal(records.length, 2);
  assert.equal(Doors.recordOrientation(new Set(), records[0]).rotationDeg, 270);
  await Doors.build({ scene: { add() {} }, mapId: 'room', mapData: data, floorSet: new Set(['1,1', '2,1', '3,1']), registerInteractable: (c, r, obj) => interactables.push(obj) });
  assert.equal(groups.length, 2);
  assert.equal(interactables.length, 1, 'exit keeps Enter/Leave instead of Open Door');
  assert.equal(Doors.blocksBox('room', 1.5, 1.5, .2), false, 'closed map-switch door remains reachable');
  assert.equal(Doors.blocksBox('room', 3.5, 1.5, .2), true, 'ordinary door still blocks when closed');
  Doors.tick('room', .1, [], [1.5, 1.5]);
  assert.equal(Doors.debug()[0].doors[0].open, true, 'exit door opens as the player approaches');
  Doors.tick('room', 1, [], [8, 8]);
  assert.equal(Doors.debug()[0].doors[0].open, false, 'exit door closes after departure');
  for (const file of fs.readdirSync('docs/config/maps').filter(f => /^map_i_.*\.json$/.test(f))) {
    const map = JSON.parse(fs.readFileSync(`docs/config/maps/${file}`, 'utf8')); // Validate authored door metadata and destination tiles across buildings.
    const floor = new Set((map.floor || []).map(t => t.join(','))); // Door meshes need a painted floor tile.
    for (const exit of map.exits || []) {
      if (!floor.size) continue;
      assert.ok(vectors[exit.direction], `${file}: ${exit.id} has an inward direction`);
      if (exit.generateDoor) for (const tile of exit.tiles) assert.ok(floor.has(tile.join(',')), `${file}: door is on floor`);
      const targetPath = `docs/config/maps/${exit.targetMap}.json`; // Procedural mine destinations do not have a static file.
      if (!exit.targetMap || !fs.existsSync(targetPath)) continue;
      const target = JSON.parse(fs.readFileSync(targetPath, 'utf8')); // Destination layout validates the authored spawn coordinates.
      if (target.floor?.length) assert.ok(target.floor.some(([c, r]) => c === exit.spawnCol && r === exit.spawnRow), `${file}: arrival is on destination floor`);
    }
  }
  console.log('Exit doors, inward facing, preview orientation, travel action preservation, and building arrivals passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Execute the actual enterBuilding function against cached and loading scenes.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Extract only the owning function, avoiding renderer initialization.
const entrySource = game.slice(game.indexOf('      function enterBuilding('), game.indexOf('\n      // Resolves once _buildingScenes', game.indexOf('      function enterBuilding('))); // Production code exercised below.
for (const cached of [true, false]) {
  const calls = []; // Captures instant-facing and loading calls in this arrival.
  const bi = { cols: 20, rows: 20, transitions: [{ col: 5, row: 4, direction: 'east', target: 'building', targetMapId: 'map_i_hall' }] }; // Destination's door points east into its room.
  const runtime = { // Minimal game dependencies needed by enterBuilding.
    window: { BuildingEntrySpawn: Spawn, MapLayoutSystem: { resolveActiveLayout: () => null, currentSnapshot: () => ({}) }, LoadingScreenRuntime: { show() {} } },
    _buildingScenes: new Map(cached ? [['map_i_room', bi]] : []),
    _rawMapDataByMapId: new Map(), _activeLayoutByMap: new Map([['map_i_room', 'default']]),
    _isBuildingArea: area => area.startsWith('map_i_'), _isCavernBuildingArea: () => false,
    currentArea: 'map_i_hall', _currentBuildingMapId: '', _pendingEntrySpotId: '', _pendingEntrySpawnFromExit: false, _pendingArrivalFromArea: null,
    loadBuildingScene: id => calls.push(['load', id]),
    player: {}, TILE: 1, farmPlayerSave: null,
    buildingSpawnFromExit: Spawn.fromExit,
    setPlayerFacingInstant: (angle, options) => calls.push(['face', angle, options]),
    _snapCameraTarget() {}, refreshActionBar() {}, logMapSwap() {},
  };
  vm.createContext(runtime);
  vm.runInContext(entrySource + "\nenterBuilding('map_i_room', 6, 4);", runtime);
  if (cached) {
    assert.equal(calls.find(call => call[0] === 'face')[1], 0, 'cached room faces east, away from its west door');
    assert.equal(calls.find(call => call[0] === 'face')[2].clearLook, true, 'old mouse/controller look cannot turn arrivals back');
  } else {
    assert.equal(runtime._pendingArrivalFromArea, 'map_i_hall', 'fresh load retains the source area');
    runtime.info = bi; runtime.mapId = 'map_i_room';
    const start = game.indexOf('            if (_pendingArrivalFromArea !== null) {'); // Run the actual async completion block after scene metadata arrives.
    const end = game.indexOf('            window.LoadingScreenRuntime?.hide();', start); // The owning loader invokes this after resolving the real spawn.
    vm.runInContext(game.slice(start, end), runtime);
    assert.equal(calls.at(-1)[1], 0, 'fresh room also faces east after loading');
    assert.equal(runtime._pendingArrivalFromArea, null, 'completion consumes the pending source');
  }
}

// Old workspaces retain new authored door settings, while explicit editor overrides win.
const metadata = { floor: [[2, 2], [3, 2]], exits: [{ id: 'roomExit', tiles: [[2, 2]], direction: 'east', generateDoor: true }] }; // Inward corridor extends east from this exit.
assert.equal(Doors.exitSettings(metadata, { exitId: 'roomExit', col: 2, row: 2 }).direction, 'east');
assert.equal(Doors.exitSettings(metadata, { col: 2, row: 2 }).generateDoor, true, 'legacy transitions without an exitId match by coordinates');
assert.equal(Doors.exitSettings(metadata, { exitId: 'roomExit', col: 2, row: 2, generateDoor: false }).generateDoor, false);
assert.equal(Doors.exitSettings(metadata, { exitId: 'roomExit', col: 2, row: 2, direction: 'west' }).direction, 'west');
assert.equal(Doors.exitSettings(metadata, { exitId: 'roomExit', col: 2, row: 2, direction: '' }).direction, 'east', 'Automatic faces the painted room instead of a fixed south fallback');
assert.equal(Doors.recordOrientation(new Set(), { col: 2, row: 2, direction: 'toString' }).facing, 'north', 'invalid inherited property is not a direction');
assert.equal(Spawn.arrivalAngle({ transitions: [{ direction: 'toString' }] }, 0, 0, 'hall'), null);
const overrideRuntime = { // Execute the actual workspace merge, including wall-opening membership.
  window: { InteriorDoorTiles: Doors }, mapData: metadata, mapId: 'map_i_room',
  floorSet: new Set(['2,2', '3,2']), transitions: [], exitTileSet: new Set(),
  _wsOverride: { transitions: [{ exitId: 'roomExit', col: 2, row: 2, targetMapId: 'map_i_hall', spawnCol: 4, spawnRow: 4 }] },
};
const overrideStart = game.indexOf('          if (_wsOverride) {', game.indexOf('const _wsOverride =')); // Source is the same override path used when loading real workspace-backed rooms.
const overrideEnd = game.indexOf('          const entranceLightTileSet', overrideStart); // Stop before scene rendering begins.
vm.runInNewContext(game.slice(overrideStart, overrideEnd), overrideRuntime);
assert.equal(overrideRuntime.transitions[0].direction, 'east');
assert.equal(overrideRuntime.transitions[0].generateDoor, true);
assert.equal(overrideRuntime.exitTileSet.has('2,2'), true, 'interior map-switch exits punch wall openings too');

const vertical = Spawn.fromExit({ transitions: [3, 4, 5].map(row => ({ exitId: 'westDoor', col: 2, row, target: 'exit_building', direction: 'east' })) }, 20, 20); // Vertical clusters should choose their middle tile, rather than the first row.
assert.equal(vertical.col, 3);
assert.equal(vertical.row, 4);

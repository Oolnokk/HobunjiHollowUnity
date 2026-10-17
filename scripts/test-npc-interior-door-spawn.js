'use strict';
// NPCs walking between interior maps (inn hallway <-> its rooms) must arrive on
// the door's authored spawn tile, like the player, not on the town-door
// heuristic's fallback tile, which lies outside a room that has no town door.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'docs/js/npc-pathfinding.js'), 'utf8');
const entrySpawnSource = fs.readFileSync(path.join(repo, 'docs/js/building-entry-spawn.js'), 'utf8');
const loadMap = id => JSON.parse(fs.readFileSync(path.join(repo, 'docs/config/maps', `${id}.json`), 'utf8'));

// Same transition shape game.js's loadBuildingScene builds from an interior map's exits.
function transitionsFor(mapId) {
  const out = [];
  for (const exit of loadMap(mapId).exits || []) {
    for (const [col, row] of exit.tiles || []) {
      const t = { col, row, area: mapId, target: exit.targetMap ? 'building' : 'exit_building', exitId: exit.id };
      if (exit.targetMap) { t.targetMapId = exit.targetMap; t.targetCol = exit.spawnCol || 0; t.targetRow = exit.spawnRow || 0; }
      out.push(t);
    }
  }
  return out;
}

const floorSet = mapId => new Set(loadMap(mapId).floor.map(([c, r]) => `${c},${r}`));
const scenes = new Map();
for (const id of ['map_i_inn_F2', 'map_i_inn_F2_hreesh', 'map_i_inn_F2_jubmir']) {
  const map = loadMap(id);
  scenes.set(id, { cols: map.cols, rows: map.rows, transitions: transitionsFor(id) });
}

const window = { __farmLog() {} };
const context = vm.createContext({ window, console, Math, Number, Object, Array, Map, Set, WeakMap, WeakSet, Promise });
vm.runInContext(entrySpawnSource, context, { filename: 'building-entry-spawn.js' });
vm.runInContext(source, context, { filename: 'npc-pathfinding.js' });
window.NpcPathfinding.init({
  isBuildingArea: area => String(area).startsWith('map_i_'),
  isZoneArea: () => false,
  npcTransitionPool: area => scenes.get(area)?.transitions || [],
  buildingScenes: scenes,
  loadBuildingScene() {},
  buildingSpawnFromExit: window.BuildingEntrySpawn.fromExit, // The real game.js dep.
});

// Room maps have no town door, so the heuristic alone lands off the room floor.
const roomFallback = window.BuildingEntrySpawn.fromExit(scenes.get('map_i_inn_F2_jubmir'), 20, 20);
assert.ok(!floorSet('map_i_inn_F2_jubmir').has(`${roomFallback.col},${roomFallback.row}`), 'heuristic fallback is off the room floor');

for (const room of ['map_i_inn_F2_hreesh', 'map_i_inn_F2_jubmir']) {
  const toRoom = window.NpcPathfinding.findNpcAreaLink('map_i_inn_F2', room, { warmBuildings: false });
  assert.ok(toRoom, `hallway links to ${room}`);
  assert.ok(floorSet(room).has(`${toRoom.spawn.c},${toRoom.spawn.r}`), `${room} arrival (${toRoom.spawn.c},${toRoom.spawn.r}) is on the room floor`);
  const toHall = window.NpcPathfinding.findNpcAreaLink(room, 'map_i_inn_F2', { warmBuildings: false });
  assert.ok(floorSet('map_i_inn_F2').has(`${toHall.spawn.c},${toHall.spawn.r}`), `hallway arrival from ${room} is on the hallway floor`);
}
console.log('NPC interior door spawns land on authored walkable tiles: ok');

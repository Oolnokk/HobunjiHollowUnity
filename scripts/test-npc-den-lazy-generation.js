'use strict';
// Regression: NPC route searches must not generate every wildlife den in an unloaded wilderness zone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/npc-pathfinding.js'), 'utf8'); // Executes production area-graph routing rather than duplicating its conditions.
const win = {};
vm.runInNewContext(source, { window: win, console, Math, Number, Object, Array, Map, Set, WeakMap, WeakSet, Promise }, { filename: 'npc-pathfinding.js' });

const denA = 'map_i_den_map_highlands_wolf_1'; // Emulates WildlifeSpawn.denCavernMapId's real ID pattern.
const denB = 'map_i_den_map_highlands_bird_2'; // A second unloaded den reveals accidental eager traversal of every cave.
const loads = []; // Records all scene-generation requests made during NPC routing.
const scenes = new Map(); // Empty on startup: no animal-den or building interiors have been built yet.
const transitions = new Map([
  ['town', [{ target: 'zone', targetMapId: 'map_highlands', col: 4, row: 3 }]],
  ['map_highlands', [
    { target: 'building', targetMapId: denA, col: 15, row: 16 },
    { target: 'building', targetMapId: denB, col: 25, row: 26 },
    { target: 'building', targetMapId: 'map_i_researchers_tent', col: 8, row: 9 },
    { target: 'zone', targetMapId: 'map_eastern_mire', col: 40, row: 3 },
  ]],
  [denA, [{ target: 'exit_building', col: 1, row: 2 }]],
  ['map_i_researchers_tent', [{ target: 'exit_building', col: 2, row: 3 }]],
]);
win.NpcPathfinding.init({
  npcTransitionPool: area => transitions.get(area) || [],
  npcZoneEntryPoint: area => area === 'map_highlands' ? { c: 2, r: 5 } : { c: 7, r: 8 },
  npcExteriorAreas: () => ['town', 'map_highlands'],
  isBuildingArea: area => String(area).startsWith('map_i_'),
  buildingScenes: scenes,
  loadBuildingScene: area => loads.push(area),
  buildingSpawnFromExit: () => ({ col: 3, row: 4 }),
});

const edges = win.NpcPathfinding.areaLinksFrom('map_highlands'); // An NPC inspecting wilderness transitions must not touch any den.
assert.deepEqual(edges.map(edge => edge.toArea), ['map_i_researchers_tent', 'map_eastern_mire']);
assert.deepEqual(loads, ['map_i_researchers_tent'], 'ordinary NPC-reachable interiors still warm on demand');
const route = win.NpcPathfinding.findNpcAreaLink('town', 'map_eastern_mire'); // BFS crosses the wilderness but must never carve its dens.
assert.ok(route && route.toArea === 'map_highlands', 'normal NPC travel between wilderness areas still works');
assert.ok(!loads.some(area => area.startsWith('map_i_den_')), 'route discovery must not generate distant den caverns');
assert.deepEqual(win.NpcPathfinding.areaLinksFrom(denA, { warmBuildings: false })
  .map(edge => edge.toArea), ['map_highlands'], 'an NPC already inside a den can still find its exterior exit');
assert.match(win.NpcPathfinding.debugSnapshot().latestChange, /den/i, 'mobile debug diagnostics identify the disabled den prewarm');
console.log('NPC area graph skips unloaded animal dens without breaking ordinary building or wilderness routes: ok');

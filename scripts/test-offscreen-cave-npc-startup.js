'use strict';
// Cold-session regression: Banubu must have a sleeping NPC walker without creating his SDF cave until player entry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Reuses shipped scheduler, activity and game files rather than approximating their logic.
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8'); // Loads production sources and authored cave fixtures from this repository.
const replacement = JSON.parse(read('docs/config/npcs/schedule-overrides.json')).scheduleReplacements.find(entry => entry.npcId === 'banubu'); // Uses Banubu's actual runtime-composed sleeping schedule.
const locale = JSON.parse(read('docs/config/locales/locale_banubu_cave_interior.json')); // Source of truth for his sleeping anchor.
const sleepingStation = locale.npcAnchors.find(anchor => anchor.id === 'station_banubu_cave_sleep'); // Its tile and pose must agree with the deferred fallback.
assert.ok(replacement?.scheduleHooks && sleepingStation, 'the authored sleeping cave must exist');
const caveId = replacement.scheduleHooks.defaultMapId; // Identifies the interior that remains cold while the player is elsewhere.
let currentArea = 'farm'; // Simulates ordinary farm startup and later cave entry.
const scenes = new Map(); // Models the real _buildingScenes map (including null while an interior is loading).
const loads = []; // Records only attempted scene builds; a remote den appearing here is a regression.
const logs = []; // Mobile-facing schedule messages should describe the deferral, not claim the cave was warmed.
const win = {
  CalendarSystem: { getHour: () => 12, currentWeekdayName: () => 'Anan' },
  __farmLog: message => logs.push(message),
};
const context = vm.createContext({ window: win, console, Math, Number, Date, Map, Set, WeakMap, WeakSet, Promise });
vm.runInContext(read('docs/js/npc-scheduling.js'), context, { filename: 'npc-scheduling.js' });
vm.runInContext(read('docs/js/npc-activities.js'), context, { filename: 'npc-activities.js' });
const loadBuildingScene = area => { loads.push(area); scenes.set(area, null); }; // Mirrors loadBuildingScene's initial null sentinel.
win.NpcScheduling.init({
  npcWalkers: [],
  getCurrentArea: () => currentArea,
  isBuildingArea: area => String(area).startsWith('map_i_'),
  normalizeNpcArea: area => area,
  buildingScenes: scenes,
  loadBuildingScene,
  getSharedSchedules: () => [],
  getWorldNpcPaths: () => [],
});
win.NpcActivities.init({
  normalizeNpcArea: area => area,
  isBuildingArea: area => String(area).startsWith('map_i_'),
  buildingScenes: scenes,
  loadBuildingScene,
  resolveNpcStationTarget: win.NpcScheduling.resolveNpcStationTarget,
  findStationsByRole: win.NpcScheduling.findStationsByRole,
});
const banubu = { id: 'banubu', scheduleHooks: replacement.scheduleHooks }; // Real schedule replacement is what LocalDBOverrides composes at startup.
const coldTarget = win.NpcScheduling.resolveLegacyNpcScheduleTarget(banubu);
assert.equal(coldTarget.area, caveId, 'Banubu stays assigned to his cave even before the geometry exists');
assert.equal(coldTarget.c, sleepingStation.col);
assert.equal(coldTarget.r, sleepingStation.row);
assert.equal(coldTarget.pose, 'lie', 'deferred Banubu still has a sleeping pose');
assert.equal(coldTarget.rotY, 270, 'cold sleeping orientation matches the authored west-facing station');
assert.match(coldTarget.activity, /sleeping/i, 'the named-animal sleep state remains active');
assert.equal(loads.length, 0, 'resolving a remote cave station must never generate the cave');
assert(logs.some(log => /cave scene deferred until player entry/.test(log)), 'mobile debug log explains the deferred station');

const missingAgenda = win.NpcActivities.resolveDestination({
  activity: 'goToStation', destinationArea: caveId, destinationStationId: sleepingStation.id,
}, { npcId: 'banubu', rec: banubu });
assert.equal(missingAgenda.status, 'WAITING_FOR_WORLD', 'agenda callers still wait for the exact station');
assert.equal(loads.length, 0, 'agenda lookups must also avoid generating offscreen caverns');

const game = read('docs/game.js'); // Validates and executes the real, production NPC scene-loading guards.
const initialGuard = game.split('\n').find(line => line.includes('shouldDeferCavernLoad?.(spawnArea)') && line.includes('loadBuildingScene(spawnArea)'));
const transferGuard = game.split('\n').find(line => line.includes('shouldDeferCavernLoad?.(area)') && line.includes('loadBuildingScene(area)'));
assert.ok(initialGuard && transferGuard, 'both NPC spawn and transfer must defer offscreen caverns');
const executeGuard = (line, param, area) => {
  const body = line.split('//')[0].trim(); // Stops at the production line's explanatory comment.
  const fn = new Function(param, '_buildingScenes', 'window', 'loadBuildingScene', body);
  fn(area, scenes, win, loadBuildingScene);
};
executeGuard(initialGuard, 'spawnArea', caveId);
executeGuard(transferGuard, 'area', caveId);
assert.equal(loads.length, 0, 'offscreen walker creation/transfers leave the cave scene unbuilt');
assert.match(game, /root\._pendingBuildingAdd = spawnArea/, 'an unloaded cave resident remains queued for later scene attachment');
assert.match(game, /w\.root\._pendingBuildingAdd === mapId/, 'the finished cave attaches its waiting residents');
assert.match(game, /if \(!_buildingScenes\.has\(mapId\)\) loadBuildingScene\(mapId\);/, 'explicit player entry still loads its destination cave');

executeGuard(initialGuard, 'spawnArea', 'map_i_researchers_tent');
assert.deepEqual(loads, ['map_i_researchers_tent'], 'ordinary NPC homes still load on ambient startup');
const ordinaryAgenda = win.NpcActivities.resolveDestination({
  activity: 'goToStation', destinationArea: 'map_i_ordinary_room', destinationStationId: 'ordinary_station',
}, { npcId: 'test', rec: { id: 'test' } });
assert.equal(ordinaryAgenda.status, 'WAITING_FOR_WORLD');
assert.deepEqual(loads, ['map_i_researchers_tent', 'map_i_ordinary_room'], 'ordinary missing agenda stations still warm their rooms');

currentArea = caveId; // The player has now entered; normal scene loading is legitimate.
assert.equal(win.NpcScheduling.shouldDeferCavernLoad(caveId), false);
win.NpcScheduling.resolveLegacyNpcScheduleTarget(banubu);
assert.deepEqual(loads.slice(-1), [caveId], 'once the player enters, Banubu station lookup may initialize the cave');
assert.match(read('docs/js/cavern-generator.js'), /rotY: facingRotation\(anchor\.facing\)/, 'the cave generator converts authored west-facing anchors into real station rotations');
win.NpcScheduling.registerNpcStations([{ ...sleepingStation, area: caveId, c: sleepingStation.col, r: sleepingStation.row, rotY: 270 }], caveId);
const loadedTarget = win.NpcScheduling.resolveLegacyNpcScheduleTarget(banubu);
assert.equal(loadedTarget.stationId, sleepingStation.id, 'the real authored sleeping station takes over after scene entry');
assert.equal(loadedTarget.pose, 'lie');
assert.equal(loadedTarget.rotY, coldTarget.rotY, 'entering the cave preserves Banubu\'s sleeping facing direction');
assert.equal(loadedTarget.c, coldTarget.c);
assert.equal(loadedTarget.r, coldTarget.r);
assert.equal(loads.filter(area => area === caveId).length, 1, 'loading the sleeping station must not restart the cave generation');
console.log('Offscreen cave NPCs: no startup carve, Banubu keeps sleeping, on-entry station handoff and ordinary room loading passed.');

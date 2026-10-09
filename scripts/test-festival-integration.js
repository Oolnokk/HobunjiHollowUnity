#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Production seams, rather than duplicated festival rules.
const fs = require('node:fs'); // Shipped sources and authored map.
const vm = require('node:vm'); // Isolated map/editor lifecycle.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Extract closure-owned helpers without starting WebGL/network.
const editor = fs.readFileSync('docs/tools/map-editor/index.html', 'utf8');
const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json', 'utf8'));
const source = name => fs.readFileSync(`docs/js/${name}.js`, 'utf8');
const defsStart = game.indexOf('const DECORATIVE_FURNITURE_DEFS =');
const defsEnd = game.indexOf('\n      };', defsStart) + '\n      };'.length;
const defs = vm.runInNewContext(`${game.slice(defsStart, defsEnd)}; DECORATIVE_FURNITURE_DEFS;`); // Real furniture footprints; changing a model definition updates this check.
function rectangle(prop) {
  const def = defs[prop.key]; // The same unrotated center and post-scale as TownZoneBuildings.
  assert(def, `unknown furniture ${prop.key}`);
  const c = prop.col + def.fw / 2 + (prop.postX || 0), r = prop.row + def.fd / 2 + (prop.postZ || 0);
  const w = def.fw * (prop.postSX ?? prop.postScale ?? 1), d = def.fd * (prop.postSZ ?? prop.postScale ?? 1);
  const yaw = (prop.rotY || 0) * Math.PI / 180;
  const halfW = (Math.abs(Math.cos(yaw)) * w + Math.abs(Math.sin(yaw)) * d) / 2;
  const halfD = (Math.abs(Math.sin(yaw)) * w + Math.abs(Math.cos(yaw)) * d) / 2;
  return [c - halfW, r - halfD, c + halfW, r + halfD];
}
const overlaps = (a, b) => a[0] < b[2] - .001 && a[2] > b[0] + .001 && a[1] < b[3] - .001 && a[3] > b[1] + .001;
const buildings = town.buildings.map(b => { const rotated = (b.rotationDeg || b.rotation || 0) % 180 !== 0; return [b.gridX, b.gridZ, b.gridX + (rotated ? b.footprintD : b.footprintW), b.gridZ + (rotated ? b.footprintW : b.footprintD)]; });
for (const layout of town.layouts) {
  const props = layout.decor.filter(prop => !town.decor.some(base => base.id === prop.id)); // Only the new dressing; no re-authoring existing terrain.
  for (let index = 0; index < props.length; index++) {
    const prop = props[index], rect = rectangle(prop);
    assert(rect[0] >= 0 && rect[1] >= 0 && rect[2] <= town.cols && rect[3] <= town.rows, prop.id);
    assert(!buildings.some(building => overlaps(rect, building)), `${prop.id} inside a building`);
    assert(!props.slice(0, index).some(other => overlaps(rect, rectangle(other))), `${prop.id} overlaps another prop`);
    for (let row = Math.floor(rect[1]); row < Math.ceil(rect[3]); row++) for (let col = Math.floor(rect[0]); col < Math.ceil(rect[2]); col++) {
      const tile = town.tiles[`${col},${row}`];
      assert(!['path', 'stream', 'river', 'trench', 'tilled'].includes(tile?.type), `${prop.id} obstructs ${tile?.type} at ${col},${row}`);
    }
    for (const exit of town.transitions) {
      const dx = Math.max(rect[0] - exit.col - .5, 0, exit.col + .5 - rect[2]);
      const dz = Math.max(rect[1] - exit.row - .5, 0, exit.row + .5 - rect[3]);
      assert(Math.hypot(dx, dz) >= 2, `${prop.id} crowds ${exit.label}`);
    }
  }
  const occupied = new Set(); // Guests and hosts have separate standing spaces beside their activities.
  for (const station of layout.npcStations.filter(st => st.festivalRole || st.festivalNpcId)) {
    const rect = [station.col + .2, station.row + .2, station.col + .8, station.row + .8];
    assert(!props.some(prop => !defs[prop.key].walkable && overlaps(rect, rectangle(prop))), `${station.id} stands inside furniture`);
    assert(!buildings.some(b => overlaps(rect, b)), `${station.id} stands inside a building`);
    const key = `${station.col},${station.row}`;
    assert(!occupied.has(key), `${station.id} shares another guest's spot`); occupied.add(key);
  }
}
// Editor copy-on-write, JSON export, and switching back to the untouched base.
const editorContext = vm.createContext({});
const start = editor.indexOf('let editingLayoutId =');
const end = editor.indexOf('// Every decor array', start);
vm.runInContext(editor.slice(start, end), editorContext);
editorContext.map = structuredClone(town);
vm.runInContext(`editingLayoutId = map.layouts[0].id; activeDecor(map)[2].col = 31; activeStations(map)[0].col = 29;`, editorContext);
assert.equal(editorContext.map.layouts[0].decor[2].col, 31);
assert.deepEqual(editorContext.map.npcStations, town.npcStations);
assert.deepEqual(editorContext.map.decor, town.decor);
editorContext.exported = JSON.parse(JSON.stringify(editorContext.map));
assert.equal(editorContext.exported.layouts[0].decor[2].activity.type, 'welcome');
vm.runInContext(`editingLayoutId = null; setActiveStations(map, [{ id: 'newBase', col: 1, row: 1 }]);`, editorContext);
assert.equal(editorContext.map.layouts[0].npcStations[0].col, 29);
// Map-owned station replacement removes expired festival roles, preserving stations owned by other areas/tools.
const scheduleContext = vm.createContext({ window: {}, console });
vm.runInContext(source('npc-scheduling'), scheduleContext);
const scheduling = scheduleContext.window.NpcScheduling;
scheduling.init({ normalizeNpcArea: area => area, getDecorativeFurnitureKeyByItemKey: () => '', decorativeFurnitureDefs: defs, npcWalkers: [] });
scheduling.registerNpcStations([{ id: 'other', c: 1, r: 1, roles: ['music-performance'] }], 'farm');
scheduling.replaceMapNpcStations(town.layouts[1].npcStations, 'town');
assert(scheduling.findStationsByRole('music-performance', { area: 'town' }).length > 0);
scheduling.replaceMapNpcStations(town.npcStations, 'town');
assert.equal(scheduling.resolveNpcStationTarget('festival_gorkunash_foroji_funji'), null);
assert(scheduling.resolveNpcStationTarget('other'));
// Execute the real game.js transition helper with the real layout resolver.
(async () => {
  const actors = [{ id: 'player' }, { id: 'resident' }]; // Identities must survive both start and end rebuilds.
  let civilDay = 120, transitions = 0, builds = 0, failNext = false; // Highheat 8 starts Gorkunash.
  const window = { CalendarSystem: { runScreenTransition: async callback => { transitions++; await callback(); } }, __farmLog() {} };
  const context = vm.createContext({ window, console, _rawExteriorMaps: new Map([[town.id, town]]), _townZone: { activeLayoutId: 'default' }, _workspaceDefinition: { maps: [town] }, _layoutSwapInProgress: false, dialogueOpen: false, menuOpen: false, sceneTransDir: 0, currentArea: 'town', townScene: { actors }, isPlayerInCombat: () => false, refreshActionBar() {}, _snapCameraTarget() {} });
  vm.runInContext(source('festival-calendar'), context);
  // MapLayoutSystem's midnight bridge is independent of this test's injected civil snapshot.
  const calendarStub = window.CalendarSystem; delete window.CalendarSystem;
  vm.runInContext(source('map-layout-system'), context); window.CalendarSystem = calendarStub;
  const resolve = window.MapLayoutSystem.resolveActiveLayout;
  window.MapLayoutSystem.resolveActiveLayout = raw => resolve(raw, { dateOrdinal: civilDay });
  context._loadTownFromWorkspace = async () => { if (failNext) { failNext = false; throw new Error('test load failure'); } context._townZone = window.MapLayoutSystem.getEffectiveMapData(town, { dateOrdinal: civilDay }); };
  context._disposeTownSceneForLivePreview = () => { const retained = context.townScene.actors; context.townScene = null; return retained; };
  context.buildTownScene = () => { builds++; context.townScene = { actors: [] }; };
  context._reattachLivePreviewResidents = (scene, residents) => { scene.actors = residents; };
  const helperStart = game.indexOf('async function refreshTownCalendarLayout()');
  const helperEnd = game.indexOf('\n      function checkMapLayoutChanges()', helperStart);
  vm.runInContext(game.slice(helperStart, helperEnd), context);
  await context.refreshTownCalendarLayout();
  assert.equal(context._townZone.activeLayoutId, 'festival_gorkunash'); assert.strictEqual(context.townScene.actors, actors);
  await context.refreshTownCalendarLayout(); assert.equal(builds, 1, 'stable dates do not rebuild');
  civilDay += 7; context.dialogueOpen = true;
  await context.refreshTownCalendarLayout(); assert.equal(builds, 1, 'dialogue defers layout change');
  context.dialogueOpen = false; failNext = true;
  await context.refreshTownCalendarLayout(); assert.equal(context._layoutSwapInProgress, false, 'failure releases swap lock');
  await context.refreshTownCalendarLayout();
  assert.equal(context._townZone.activeLayoutId, 'default'); assert.strictEqual(context.townScene.actors, actors);
  assert.equal(builds, 2); assert.equal(transitions, 3); assert.equal(context._workspaceDefinition.maps[0].decor.length, 2);
  console.log('Festival spacing, open exits, editor round-trip, station cleanup, and live layout lifecycle passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

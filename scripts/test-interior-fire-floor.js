'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const json = p => JSON.parse(read(p));

const core = read('docs/js/interior-fire-floor-runtime.js');
const integration = read('docs/js/interior-fire-floor-integration.js');
const vessel = read('docs/js/furniture-vessel-runtime.js');
const mapLayoutSystem = read('docs/js/map-layout-system.js');
const temple = json('docs/config/maps/map_i_temple.json');
const hunundiRoom = json('docs/config/maps/map_i_temple_basement_hunundi.json');

assert.doesNotThrow(() => new vm.Script(core, { filename: 'interior-fire-floor-runtime.js' }));
assert.doesNotThrow(() => new vm.Script(integration, { filename: 'interior-fire-floor-integration.js' }));
assert.doesNotThrow(() => new vm.Script(vessel, { filename: 'furniture-vessel-runtime.js' }));
assert.doesNotThrow(() => new vm.Script(mapLayoutSystem, { filename: 'map-layout-system.js' }));

assert(core.includes("campfireFurniture"), 'core runtime must register a real campfire furniture item');
assert(core.includes("bonfireFurniture"), 'core runtime must register a real bonfire furniture item');
assert(core.includes("name: 'Bonfire', icon: '🔥', fw: 2, fd: 2, procKey: 'bonfire'"),
  'bonfire runtime definition must have a real 2x2 footprint');
assert(core.includes('data.footprint = { w: 2, d: 2 }'),
  'derived authored bonfire data must retain the same 2x2 footprint');
assert(core.includes('const scale = 2'), 'bonfire must derive from the campfire at exactly double visual scale');
assert(core.includes("id: 'candle_table_fire'"), 'candle tables must receive the small authored fire emitter');
assert(core.includes('floorStyle'), 'runtime must support per-map floorStyle data');
assert(core.includes('tilesPerTile'), 'floor style must expose texture density in textures per tile');
assert(core.includes('applyFloorStyleToScene'), 'loaded building scenes must receive authored floor style');

assert(integration.includes("bonfireFurniture: Object.freeze({ key: 'bonfireFurniture', label: 'Bonfire', fw: 2, fd: 2"),
  'Interior Editor catalog compatibility entry must use the real 2x2 bonfire footprint');
assert(integration.includes("detail: '2x2 · centered on middle vertex'"),
  'Interior Editor must describe the bonfire as a centered 2x2 footprint');
assert(integration.includes("centerOffset: { x: 1, z: 1 }, anchor: 'center-vertex'"),
  'debug metadata must state the normal 2x2 center-vertex offset');
assert(!integration.includes('forceBonfireOneTile'), 'integration must never collapse the bonfire back to one tile');
assert(!integration.includes('defs[BONFIRE_ITEM_KEY].fw = 1'), 'gameplay footprint must not be overridden to one tile');
assert(integration.includes("campfireFurniture"), 'Interior Editor catalog must expose Campfire');
assert(integration.includes("bonfireFurniture"), 'Interior Editor catalog must expose Bonfire');
assert(integration.includes("biaFloorTexture"), 'Interior Editor must expose the PNG floor texture field');
assert(integration.includes("biaFloorTint"), 'Interior Editor must expose the floor tint field');
assert(integration.includes("biaFloorRepeat"), 'Interior Editor must expose textures-per-tile');
assert(integration.includes('function installEditorFloorMeshBridge()'),
  'Interior Editor must patch newly rebuilt floor meshes instead of trusting the wall-style-only material cache');
assert(integration.includes("geometry?.type === 'BoxGeometry'"),
  'floor preview bridge must narrowly identify the editor floor-tile geometry');
assert(integration.includes("Math.abs((p?.height ?? 0) - 0.08)"),
  'floor preview bridge must match the editor floor slab thickness');
assert(integration.includes("applyFloorStyleToMaterial?.(mat, style, '../../assets/')"),
  'floor preview bridge must apply the selected floorStyle to the cached shared floor material');
assert(integration.includes('THREE.Mesh = InteriorFloorAwareMesh'),
  'floor preview bridge must intercept later rebuilds even though the editor renderer already exists');

assert(vessel.includes('loadInteriorFireFloorCompanions'), 'normal furniture bootstrap must install fire/floor companions');
assert(vessel.includes('interior-fire-floor-runtime.js'), 'normal game/editor bootstrap must load the shared core runtime');
assert(vessel.includes('interior-fire-floor-integration.js'), 'normal game/editor bootstrap must load the integration layer');

assert(mapLayoutSystem.includes('function resolveFurnitureBoundStations(mapData)'),
  'layout resolver must support NPC stations bound to furniture ids');
assert(mapLayoutSystem.includes('piece.col + (Number(piece.postX) || 0)'),
  'furniture-bound stations must follow visual X post-transform offsets');
assert(mapLayoutSystem.includes('piece.row + (Number(piece.postZ) || 0)'),
  'furniture-bound stations must follow visual Z post-transform offsets');
assert(mapLayoutSystem.includes('function installCivilMidnightCalendarBridge()'),
  'layout/calendar bridge must correct the civil date at midnight');
assert(mapLayoutSystem.includes('RAW_DAY_ROLLOVER_HOUR = 6'),
  'raw simulation day may remain morning-to-morning while civil dates roll independently');

// Behavioral regression for the exact bug that made midnight-authored layouts
// one named weekday late. The raw simulation day remains Uung until 06:00,
// but civil Anan begins at 00:00 and must already be visible to schedules.
const weekdayNames = ['Anan', 'Hronu', 'Kruru', 'Muunu', 'Naru', 'Tothu', 'Uung'];
const rawCalendar = { day: 7, time01: 0 };
let representedHour = 23;
const calendarStub = {
  init() {},
  getHour() { return representedHour; },
  dayOfYear(day = rawCalendar.day) { return day; },
  yearNumber() { return 1; },
  aotYearNumber() { return 1154; },
  weekOfYear(day = rawCalendar.day) { return Math.floor((day - 1) / 7) + 1; },
  monthIndex() { return 0; },
  monthNumber() { return 1; },
  monthName() { return 'Firstrise'; },
  dayOfMonth(day = rawCalendar.day) { return day; },
  weekOfSeason() { return 1; },
  weekdayIndexForCalendarDay(day) { return ((day - 1) % 7 + 7) % 7; },
  weekdayNameForDay(day = rawCalendar.day) { return weekdayNames[((day - 1) % 7 + 7) % 7]; },
  currentWeekdayIndex() { return ((rawCalendar.day - 1) % 7 + 7) % 7; },
  currentWeekdayName() { return weekdayNames[((rawCalendar.day - 1) % 7 + 7) % 7]; },
  formatCalendarDate(day = rawCalendar.day) { return `${this.weekdayNameForDay(day)} day ${day}`; },
  formatCalendarDateFull(day = rawCalendar.day) { return `${this.weekdayNameForDay(day)} day ${day}`; },
  formatCalendarDateTimeFull(day = rawCalendar.day) { return `${this.weekdayNameForDay(day)} day ${day}`; },
  isCivilYearStart() { return false; },
  renderCalendarPanel() {},
  timeDebugSnapshot() { return { rawDay: rawCalendar.day }; },
};
const civilContext = { window: { CalendarSystem: calendarStub } };
vm.createContext(civilContext);
vm.runInContext(mapLayoutSystem, civilContext, { filename: 'map-layout-system-midnight.js' });
civilContext.window.CalendarSystem.init({ calendar: rawCalendar });
assert.strictEqual(civilContext.window.CalendarSystem.currentWeekdayName(), 'Uung',
  'before midnight the civil weekday must match the raw simulation day');
representedHour = 1;
assert.strictEqual(civilContext.window.CalendarSystem.currentWeekdayName(), 'Anan',
  'at 01:00 the civil weekday must already be the next named day');
assert.strictEqual(civilContext.window.CalendarSystem.formatCalendarDate(), 'Anan day 8',
  'HUD date formatting must advance at midnight instead of waiting for 06:00');
const midnightSnapshot = civilContext.window.MapLayoutSystem.currentSnapshot();
assert.strictEqual(midnightSnapshot.weekday, 'Anan',
  'layout conditions must see the civil weekday after midnight');
assert.strictEqual(midnightSnapshot.minutes, 60,
  'layout conditions must preserve the represented 01:00 clock time');
const midnightLayoutMap = {
  layouts: [{ id: 'midnight_event', priority: 1, conditions: [{ from: '00:00', to: '03:00', days: ['Anan'] }] }],
};
assert.strictEqual(civilContext.window.MapLayoutSystem.resolveActiveLayout(midnightLayoutMap)?.id, 'midnight_event',
  'Anan 00:00-03:00 must activate during the first three hours of displayed Anan');
rawCalendar.day = 8;
representedHour = 6;
assert.strictEqual(civilContext.window.CalendarSystem.currentWeekdayName(), 'Anan',
  '06:00 raw-day maintenance must not advance the civil weekday a second time');

assert.deepStrictEqual(temple.floorStyle, {
  texture: 'carved_smooth.png',
  tint: '#8c8c8c',
  tilesPerTile: 0.75,
}, 'latest uploaded church floor style must be preserved');

const communion = (temple.layouts || []).find(layout => layout.id === 'spirit_communion');
assert(communion, 'updated church must retain the Spirit Communion layout');
const bonfire = communion.furniture.find(piece => piece.id === 'sc_bonfire');
assert(bonfire, 'Spirit Communion must use the real bonfire');
assert.strictEqual(bonfire.itemKey, 'bonfireFurniture');
assert(!communion.furniture.some(piece => piece.itemKey === 'campfireKitFurniture'),
  'updated church must not retain the Campfire Kit placeholder');
assert(communion.furniture.filter(piece => piece.itemKey === 'candleTableFurniture').length === 2,
  'uploaded church candle tables must remain present for the candle flame VFX');

const stool = communion.furniture.find(piece => piece.id === 'fmtsv6eoligq5');
assert(stool, 'latest Spirit Communion layout must retain the Eldress stool');
assert.strictEqual(stool.itemKey, 'stoolFurniture');
const eldressStation = (temple.npcStations || []).find(station => station.id === 'station_temple_counsel_teacup');
assert(eldressStation, 'Eldress Spirit Communion station must still exist for schedule compatibility');
assert.strictEqual(eldressStation.sourceFurnitureId, stool.id,
  'Eldress station must bind to the actual Spirit Communion stool id');
assert.strictEqual(eldressStation.sourceFurnitureKey, 'stoolFurniture');
assert.strictEqual(eldressStation.seatIndex, 0);
assert(!Object.prototype.hasOwnProperty.call(eldressStation, 'col'),
  'Eldress station must not author a fixed column anymore');
assert(!Object.prototype.hasOwnProperty.call(eldressStation, 'row'),
  'Eldress station must not author a fixed row anymore');

const layoutContext = { window: {} };
vm.createContext(layoutContext);
vm.runInContext(mapLayoutSystem, layoutContext, { filename: 'map-layout-system.js' });
const effectiveCommunion = layoutContext.window.MapLayoutSystem.getEffectiveMapData(temple, {
  minutes: 60,
  weekday: 'Anan',
  dateOrdinal: 1,
});
assert.strictEqual(effectiveCommunion.activeLayoutId, 'spirit_communion');
const resolvedEldressStation = effectiveCommunion.npcStations.find(station => station.id === eldressStation.id);
assert(resolvedEldressStation, 'active Spirit Communion must resolve the stool-bound Eldress station');
assert.strictEqual(resolvedEldressStation.col, stool.col + stool.postX,
  'Eldress destination X must be derived from the current stool placement');
assert.strictEqual(resolvedEldressStation.row, stool.row + stool.postZ,
  'Eldress destination Z must be derived from the current stool placement');
assert.strictEqual(resolvedEldressStation.rotY, stool.rotY,
  'Eldress seated facing must follow the stool rotation');
assert.strictEqual(resolvedEldressStation.furnitureKey, 'stoolFurniture',
  'resolved station must use the stool seat anchor rather than floor sitting');

const movedTemple = JSON.parse(JSON.stringify(temple));
const movedCommunion = movedTemple.layouts.find(layout => layout.id === 'spirit_communion');
const movedStool = movedCommunion.furniture.find(piece => piece.id === stool.id);
movedStool.col = 4;
movedStool.row = 12;
movedStool.postX = 0.25;
movedStool.postZ = -0.4;
movedStool.rotY = 135;
const movedEffective = layoutContext.window.MapLayoutSystem.getEffectiveMapData(movedTemple, {
  minutes: 60,
  weekday: 'Anan',
  dateOrdinal: 1,
});
const movedStation = movedEffective.npcStations.find(station => station.id === eldressStation.id);
assert.deepStrictEqual([movedStation.col, movedStation.row, movedStation.rotY], [4.25, 11.6, 135],
  'moving the stool must automatically move/turn the Eldress destination without editing npcStations');

assert.strictEqual(hunundiRoom.id, 'map_i_temple_basement_hunundi',
  'uploaded Father Hunundi room must replace the existing repo map under its canonical id');
assert.strictEqual(hunundiRoom.furniture.length, 7,
  'updated Father Hunundi room must retain all seven uploaded furniture records');
assert(hunundiRoom.furniture.some(piece => piece.id === 'fmtst9ykgmqf0' && piece.itemKey === 'chairSimpleFurniture' && piece.col === 9 && piece.row === 9 && piece.rotY === 180),
  'updated Father Hunundi room must retain the uploaded first added chair');
assert(hunundiRoom.furniture.some(piece => piece.id === 'fmtsteb7xjq80' && piece.itemKey === 'chairSimpleFurniture' && piece.col === 8 && piece.row === 9 && piece.rotY === 180),
  'updated Father Hunundi room must retain the uploaded second added chair');
assert.deepStrictEqual(hunundiRoom.entryPoints, [], 'uploaded Father Hunundi room entryPoints must be preserved');
assert.deepStrictEqual(hunundiRoom.layouts, [], 'uploaded Father Hunundi room layouts must be preserved');

console.log('interior fire/floor + midnight civil rollover + furniture-bound Eldress stool + Hunundi room regression checks: PASS');

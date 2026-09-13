const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/porakaneki-map-markers.js', 'utf8'); // Executes the real runtime adapter against a browser-shaped map/camp stub.
const houseLoader = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // Guards parser-time loading and cache-busted path.

let campSnapshot = {
  zones: {
    map_northern_cliffs: {
      camps: [
        { id: 'porakaneki_small_map_northern_cliffs_0', kind: 'small', center: { col: 12.5, row: 18.5 } },
        { id: 'porakaneki_small_map_northern_cliffs_1', kind: 'small', center: { col: 42.5, row: 31.5 } },
      ],
    },
    map_southern_cloud_forest: {
      camps: [
        { id: 'porakaneki_small_map_southern_cloud_forest_0', kind: 'small', center: { col: 14.5, row: 21.5 } },
        { id: 'porakaneki_small_map_southern_cloud_forest_1', kind: 'small', center: { col: 38.5, row: 44.5 } },
        { id: 'porakaneki_chief_reservation_map_southern_cloud_forest', kind: 'chief', center: { col: 28.5, row: 26.5 } },
      ],
    },
    map_western_slope: {
      camps: [
        { id: 'porakaneki_small_map_western_slope_0', kind: 'small', center: { col: 16.5, row: 39.5 } },
        { id: 'porakaneki_small_map_western_slope_1', kind: 'small', center: { col: 49.5, row: 17.5 } },
      ],
    },
    map_eastern_mire: {
      camps: [
        { id: 'porakaneki_small_map_eastern_mire_0', kind: 'small', center: { col: 23.5, row: 13.5 } },
        { id: 'porakaneki_small_map_eastern_mire_1', kind: 'small', center: { col: 47.5, row: 46.5 } },
      ],
    },
  },
}; // Stormtide: chief camp is in Southern Cloud Forest.

const zoneLayouts = new Map(Object.keys(campSnapshot.zones).map(zoneId => [zoneId, {
  localeInstances: [{ localeId: `existing_${zoneId}`, name: 'Existing Landmark', x: 1, y: 1 }],
}])); // Existing generator-authored locales must remain untouched by marker syncs.

let mapInitDeps = null;
let mapRenderCount = 0;
let fogUpdateCount = 0;
let banditTickCount = 0;
const wildernessMap = {
  init(deps) { mapInitDeps = deps; return 'map-init'; },
  renderMapPanel() { mapRenderCount++; return 'rendered'; },
  updateFogAroundPlayer() { fogUpdateCount++; return 'fogged'; },
};
const banditCamps = {
  updateCampBanners() { banditTickCount++; return 'bandit-tick'; },
};

const contextWindow = {
  PorakanekiCamps: { debugSnapshot: () => campSnapshot },
  WildernessMap: wildernessMap,
  BanditCamps: banditCamps,
};
contextWindow.window = contextWindow;
const context = vm.createContext({ window: contextWindow, console, Map, Object, Number, String });
vm.runInContext(source, context, { filename: 'porakaneki-map-markers.js' });

assert.equal(contextWindow.PorakanekiMapMarkers.version, 1);
assert(houseLoader.includes("['PorakanekiMapMarkers', 'porakaneki-map-markers.js?v=20260912a']"));
assert.equal(contextWindow.WildernessMap.init({ _zoneLayouts: zoneLayouts }), 'map-init');
assert(mapInitDeps?._zoneLayouts === zoneLayouts);

function porakanekiMarkers(zoneId) {
  return zoneLayouts.get(zoneId).localeInstances.filter(instance => instance.__porakanekiCampMapMarker);
}
function chiefMarkers() {
  return [...zoneLayouts].flatMap(([zoneId, layout]) => layout.localeInstances
    .filter(instance => instance.__porakanekiCampMapMarker && instance.localeId === 'locale_porakaneki_camp_chief')
    .map(instance => ({ zoneId, ...instance })));
}

for (const [zoneId, layout] of zoneLayouts) {
  assert(layout.localeInstances.some(instance => instance.localeId === `existing_${zoneId}`), 'existing locale instances are retained');
  const small = porakanekiMarkers(zoneId).filter(instance => instance.templateLocaleId === 'locale_porakaneki_camp_small');
  assert.equal(small.length, 2, `${zoneId} receives its two runtime small-camp map proxies`);
  assert(small.every(instance => instance.alwaysVisible === false), 'small camp markers begin hidden and therefore use ordinary locale discovery');
  assert.equal(new Set(small.map(instance => instance.localeId)).size, small.length, 'each little camp has its own discovery identity');
}

let chief = chiefMarkers();
assert.equal(chief.length, 1, 'exactly one chief camp marker exists worldwide');
assert.equal(chief[0].zoneId, 'map_southern_cloud_forest');
assert.equal(chief[0].alwaysVisible, true, 'chief camp bypasses discovery and is marked automatically');
assert.equal(chief[0].x + 0.5, 28.5, 'map proxy compensates for WildernessMap locale-center offset');
assert.equal(chief[0].y + 0.5, 26.5);

const westernSmallBefore = porakanekiMarkers('map_western_slope')
  .filter(instance => instance.templateLocaleId === 'locale_porakaneki_camp_small')
  .map(instance => [instance.localeId, instance.x, instance.y]);

// Deadgrass migration: the chief marker moves to Western Slope, while all
// little-camp identities/positions stay exactly the same.
campSnapshot = JSON.parse(JSON.stringify(campSnapshot));
campSnapshot.zones.map_southern_cloud_forest.camps = campSnapshot.zones.map_southern_cloud_forest.camps.filter(camp => camp.kind !== 'chief');
campSnapshot.zones.map_western_slope.camps.push({
  id: 'porakaneki_chief_reservation_map_western_slope', kind: 'chief', center: { col: 33.5, row: 24.5 },
});
assert.equal(contextWindow.BanditCamps.updateCampBanners(0.2), 'bandit-tick');
assert.equal(banditTickCount, 1);

chief = chiefMarkers();
assert.equal(chief.length, 1, 'migration never duplicates the chief marker');
assert.equal(chief[0].zoneId, 'map_western_slope');
assert.equal(chief[0].alwaysVisible, true);
const westernSmallAfter = porakanekiMarkers('map_western_slope')
  .filter(instance => instance.templateLocaleId === 'locale_porakaneki_camp_small')
  .map(instance => [instance.localeId, instance.x, instance.y]);
assert.deepEqual(westernSmallAfter, westernSmallBefore, 'seasonal chief migration does not move/re-key little camps');

// Both public map entry points force a sync before the generic WildernessMap
// code reads localeInstances, so discovery/rendering cannot race camp startup.
assert.equal(contextWindow.WildernessMap.updateFogAroundPlayer(), 'fogged');
assert.equal(fogUpdateCount, 1);
assert.equal(contextWindow.WildernessMap.renderMapPanel(), 'rendered');
assert.equal(mapRenderCount, 1);

console.log('Porakaneki wilderness-map marker regression passed.');

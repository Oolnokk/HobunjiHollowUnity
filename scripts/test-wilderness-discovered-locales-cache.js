'use strict';

// A compass waypoint may be resolved every few frames, but changing worlds or
// restoring another save must still make its discoveries visible immediately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let savedMeta = JSON.stringify({ worlds: [
  { id: 'world-a' },
  { id: 'world-b', discoveredLocales: { locale_b: { name: 'Camp B', category: 'story_poi' } } },
] }); // Simulates the canonical save blob, including writes from other modules.
let currentWorld = 'world-a'; // Mutated to verify the cache never leaks discoveries across worlds.
let currentYear = 7; // Advanced in place to check same-tile fog updates after Tothal Shifts.
let metaReads = 0; // Counts reads that cross the storage boundary.
let parseCalls = 0; // Counts full metadata parses in the running map module.
let failMetaWrites = false; // Forces a failed persistence attempt to test copy-on-write behavior.
const player = { x: 0, y: 0 }; // Moved into discovery range of the two test landmarks.
const zoneId = 'zone'; // Shared test layout while the active world changes.
const extraStorage = new Map(); // Persists the unrelated fog keys without polluting save-meta assertions.
class Storage {
  getItem(key) {
    if (key !== 'hobunjiSaveMeta') return extraStorage.get(key) || null;
    metaReads++;
    return savedMeta;
  }
  setItem(key, value) {
    if (key === 'hobunjiSaveMeta') {
      if (failMetaWrites) throw Error('simulated storage failure');
      savedMeta = value;
    } else extraStorage.set(key, value);
  }
  removeItem(key) {
    if (key === 'hobunjiSaveMeta') savedMeta = null;
    else extraStorage.delete(key);
  }
}
let onStorage; // Captures the browser's cross-tab change listener from the storage guard.
const context = {
  console, Map, Set, Math, Number, Object, Array, Uint8Array,
  JSON: {
    parse(value) { parseCalls++; return JSON.parse(value); },
    stringify: JSON.stringify,
  },
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  atob: value => Buffer.from(value, 'base64').toString('binary'),
  Storage,
  localStorage: new Storage(),
  addEventListener(type, callback) { if (type === 'storage') onStorage = callback; },
  document: { getElementById: () => null },
  WildernessMapGenerator: { zoneMapIds: () => [zoneId] },
};
context.window = context;
context.BanditCamps = { perceivedThreats: new Map() };
context.BountyBoard = { markers: new Map() };

vm.createContext(context);
const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'wilderness-map.js');
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
const layout = { cols: 50, rows: 50, tiles: [], localeInstances: [
  { localeId: 'locale_a', name: 'Secret A', category: 'great_fey_shrine',
    x: 3, y: 3, shiftGeneratedSecret: true, alwaysVisible: false },
  { localeId: 'locale_b', name: 'Camp B', category: 'story_poi',
    x: 20, y: 20, shiftGeneratedSecret: false, alwaysVisible: false },
] }; // Realistic generated-layout records used by _allLocaleInstances().
context.WildernessMap.init({
  _zoneLayouts: new Map([[zoneId, layout]]),
  tothalWorldId: () => currentWorld,
  currentTothalYear: () => currentYear,
  _isZoneArea: area => area === zoneId,
  getCurrentArea: () => zoneId,
  showToast: () => {},
  player, TILE: 1, npcWalkers: [], WMAP_ZONE_LABELS: {},
});
const visibleIds = () => context.WildernessMap._test.visibleLandmarks(zoneId).map(record => record.localeId); // Fast read path exercised by map and waypoint UI.

assert.equal(visibleIds().length, 0, 'new world must start with no discoveries');
const firstParseCount = parseCalls; // Warm-cache baseline; includes the separate threat-marker loader.
for (let i = 0; i < 60; i++) visibleIds();
assert.equal(parseCalls, firstParseCount, 'unchanged metadata must not be reparsed on repeat reads');

// The map discovers a secret and seeds the same cache that compass reads use.
player.x = 3; player.y = 3;
context.WildernessMap.updateFogAroundPlayer();
assert(visibleIds().includes('locale_a'), 'successful discovery must appear immediately');
assert(JSON.parse(savedMeta).worlds[0].discoveredLocales['locale_a:tothal:7'],
  'discovery must still persist under the correct Tothal year');
context.WildernessMap.setWaypoint({ id: 'locale:locale_a', source: 'locale',
  localeId: 'locale_a', zoneId, col: 3.5, row: 3.5, label: 'Secret A', category: 'great_fey_shrine' });
assert.equal(context.WildernessMap.getCompassWaypoint()?.localeId, 'locale_a');
const guardPath = path.join(__dirname, '..', 'docs', 'js', 'storage-quota-guard.js'); // Run the actual storage guard so test mutations use the production invalidation path.
vm.runInContext(fs.readFileSync(guardPath, 'utf8'), context, { filename: guardPath });
assert.equal(context.WildernessMap.getCompassWaypoint()?.localeId, 'locale_a');
const compassReadCount = metaReads; // Polling an unchanged secret should not cross the storage boundary.
const compassParseCount = parseCalls; // Every compass poll resolves the secret's discovery status.
for (let i = 0; i < 60; i++) context.WildernessMap.getCompassWaypoint();
assert.equal(parseCalls, compassParseCount, 'repeated secret-waypoint polls must reuse the parsed discoveries');
assert.equal(metaReads, compassReadCount, '60 unchanged secret-waypoint polls must perform zero save metadata reads');
context.localStorage.setItem('unrelated', 'changed');
assert.equal(context.WildernessMap.getCompassWaypoint()?.localeId, 'locale_a');
assert.equal(metaReads, compassReadCount, 'unrelated storage writes do not invalidate locale discoveries');

// Another module can replace the full metadata string without going through
// WildernessMap, including a folder restore in this same browser tab.
const externalMeta = JSON.parse(savedMeta); // Used to simulate a complete metadata replacement.
delete externalMeta.worlds[0].discoveredLocales;
const discoveredMeta = savedMeta; // Restored by a simulated cross-tab update below.
context.localStorage.setItem('hobunjiSaveMeta', JSON.stringify(externalMeta));
assert.equal(context.WildernessMap.getCompassWaypoint(), null,
  'external save replacement must immediately conceal an undiscovered secret');
assert(!visibleIds().includes('locale_a'), 'a stale cached discovery must not remain visible');
savedMeta = discoveredMeta;
onStorage({ key: 'hobunjiSaveMeta', storageArea: context.localStorage });
assert.equal(context.WildernessMap.getCompassWaypoint()?.localeId, 'locale_a', 'a cross-tab change refreshes discoveries');
currentYear = 8;
assert.equal(context.WildernessMap.getCompassWaypoint(), null, 'a year change hides a previous cycle’s cached secret');
currentYear = 7;
assert.equal(context.WildernessMap.getCompassWaypoint()?.localeId, 'locale_a');
context.localStorage.removeItem('hobunjiSaveMeta');
assert.equal(context.WildernessMap.getCompassWaypoint(), null, 'deleting metadata immediately hides the secret');
context.localStorage.setItem('hobunjiSaveMeta', JSON.stringify(externalMeta));

// Identical raw metadata is valid for different active worlds: the cache must
// also key by world id rather than returning world A's parsed discoveries.
currentWorld = 'world-b';
assert(visibleIds().includes('locale_b'), 'switching worlds must reveal the second world’s own discoveries');
assert(!visibleIds().includes('locale_a'), 'switching worlds must not leak secrets from the first world');
const worldBParseCount = parseCalls; // Read cache should stabilize again after the world change.
for (let i = 0; i < 60; i++) visibleIds();
assert.equal(parseCalls, worldBParseCount, 'second world should also use the read cache');

// World A already revealed this same tile. World B must not reuse that fog
// memory or the same-tile early return, and must write its own fog record.
context.WildernessMap.updateFogAroundPlayer();
assert(JSON.parse(savedMeta).worlds[1].discoveredLocales['locale_a:tothal:7'],
  'world B must discover a secret at a tile already visited in world A');
const worldBFogKey = 'hobunji_zone_fog_v1_world-b_zone'; // Distinct persistent fog key proving no cross-world cache reuse.
assert(extraStorage.has(worldBFogKey), 'world B must persist its own initially hidden fog tiles');
assert.equal(JSON.parse(extraStorage.get(worldBFogKey)).year, 7,
  'world B must persist fog using its own active Tothal year');

currentYear = 8;
context.WildernessMap.updateFogAroundPlayer();
assert(JSON.parse(savedMeta).worlds[1].discoveredLocales['locale_a:tothal:8'],
  'a new Tothal year at the same coordinates must discover regenerated secrets');
assert.equal(JSON.parse(extraStorage.get(worldBFogKey)).year, 8,
  'new-year fog must replace previous-year fog even without player movement');
currentYear = 7;

// A failed write must not alter the cached read-only object; discovery writers
// now copy it before they make tentative changes to persistence.
currentWorld = 'world-a';
player.x = 20; player.y = 20;
failMetaWrites = true;
context.WildernessMap.updateFogAroundPlayer();
assert(!visibleIds().includes('locale_b'), 'failed save must not leak a tentative discovery into the cache');
assert.equal(JSON.parse(savedMeta).worlds[0].discoveredLocales, undefined,
  'a failed discovery write must not change persisted metadata');

console.log('wilderness locale discovery cache tests passed');

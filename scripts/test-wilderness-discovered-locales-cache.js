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
let parseCalls = 0; // Counts full metadata parses in the running map module.
let failMetaWrites = false; // Forces a failed persistence attempt to test copy-on-write behavior.
const player = { x: 0, y: 0 }; // Moved into discovery range of the two test landmarks.
const zoneId = 'zone'; // Shared test layout while the active world changes.
const extraStorage = new Map(); // Persists the unrelated fog keys without polluting save-meta assertions.
const context = {
  console, Map, Set, Math, Number, Object, Array, Uint8Array,
  JSON: {
    parse(value) { parseCalls++; return JSON.parse(value); },
    stringify: JSON.stringify,
  },
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  atob: value => Buffer.from(value, 'base64').toString('binary'),
  localStorage: {
    getItem(key) { return key === 'hobunjiSaveMeta' ? savedMeta : extraStorage.get(key) || null; },
    setItem(key, value) {
      if (key === 'hobunjiSaveMeta') {
        if (failMetaWrites) throw Error('simulated storage failure');
        savedMeta = value;
      } else extraStorage.set(key, value);
    },
  },
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
  currentTothalYear: () => 7,
  _isZoneArea: area => area === zoneId,
  getCurrentArea: () => zoneId,
  showToast: () => {},
  player, TILE: 1, npcWalkers: [], WMAP_ZONE_LABELS: {},
});
const visibleIds = () => context.WildernessMap._test.visibleLandmarks(zoneId).map(record => record.localeId); // Fast read path exercised by map and waypoint UI.

assert.deepEqual(visibleIds(), [], 'new world must start with no discoveries');
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
const compassParseCount = parseCalls; // Every compass poll resolves the secret's discovery status.
for (let i = 0; i < 60; i++) context.WildernessMap.getCompassWaypoint();
assert.equal(parseCalls, compassParseCount, 'repeated secret-waypoint polls must reuse the parsed discoveries');

// Another module can replace the full metadata string without going through
// WildernessMap, including a folder restore in this same browser tab.
const externalMeta = JSON.parse(savedMeta); // Used to simulate a complete metadata replacement.
delete externalMeta.worlds[0].discoveredLocales;
savedMeta = JSON.stringify(externalMeta);
assert.equal(context.WildernessMap.getCompassWaypoint(), null,
  'external save replacement must immediately conceal an undiscovered secret');
assert(!visibleIds().includes('locale_a'), 'a stale cached discovery must not remain visible');

// Identical raw metadata is valid for different active worlds: the cache must
// also key by world id rather than returning world A's parsed discoveries.
currentWorld = 'world-b';
assert(visibleIds().includes('locale_b'), 'switching worlds must reveal the second world’s own discoveries');
assert(!visibleIds().includes('locale_a'), 'switching worlds must not leak secrets from the first world');
const worldBParseCount = parseCalls; // Read cache should stabilize again after the world change.
for (let i = 0; i < 60; i++) visibleIds();
assert.equal(parseCalls, worldBParseCount, 'second world should also use the read cache');

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

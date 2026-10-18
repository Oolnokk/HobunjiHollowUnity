'use strict';

// Camp reinforcements: replacements are bounded by the camp's reserve even while the
// (async) avatar build is in flight, flasker counts follow one per four regular bandits,
// and refills keep the staged mix.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let nextId = 1;
let builds = 0;
const hostileObjects = new Set();
const window = {
  BanditCombat: {
    makeEntity: async (cfg, rank, tier, x, y, options) => { builds++; await new Promise(resolve => setTimeout(resolve, 20)); return { id: 'b' + nextId++, rank, health: 10, name: rank, ...(options?.extra || {}) }; }, // Real entities carry banditCampInstanceId from options.extra.
  },
  __farmLog() {},
};
const context = vm.createContext({ window, document: { getElementById: () => null }, fetch: () => new Promise(() => {}), performance, console, Math, Number, Object, Array, Map, Set, Promise, setTimeout, String, JSON });
vm.runInContext(fs.readFileSync('docs/js/bandit-camps.js', 'utf8'), context, { filename: 'bandit-camps.js' });
const hydra = window.BanditCamps._simpleHydra;

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
window.BanditCamps.init({ rnd, TILE: 64, getCurrentArea: () => 'zone_a', isZoneArea: () => true, hostileObjects, debugLog() {} });

// Composition: one Flasker per four grunts.
for (const [grunts, flaskers] of [[3, 0], [4, 1], [6, 1], [8, 2], [12, 3]]) {
  assert.equal(hydra.flaskerCountForGrunts({ regularBanditsPerFlasker: 4 }, grunts), flaskers, `${grunts} grunts -> ${flaskers} flasker(s)`);
}

function makeRec(reserve) {
  return {
    zoneId: 'zone_a', instance: { id: 'camp1' }, cfg: {}, gangIds: new Set(), props: [], homeX: 0, homeY: 0,
    reserveByRank: { grunt: 0, flasker: 0, lieutenant: 0, captain: 0, ...reserve },
    activeRanksById: new Map(), reinforcementPending: false, reinforcementSpawnInFlight: false, reinforcementTimer: 0,
    captainSpawned: false, captainSpawnInFlight: false, beastmastersSpawned: 0,
  };
}

(async () => {
  // Weighted refill follows the reserve mix and never offers an empty rank.
  const counts = { grunt: 0, flasker: 0, lieutenant: 0 };
  for (let i = 0; i < 4000; i++) counts[hydra.rankFor(makeRec({ grunt: 6, flasker: 1, lieutenant: 1 }))]++;
  assert.ok(counts.grunt > counts.flasker * 3, `grunts dominate refills (${JSON.stringify(counts)})`);
  assert.equal(hydra.rankFor(makeRec({})), null);

  // One death queues one replacement; update() is called every frame while the build is awaited.
  const rec = makeRec({ grunt: 5, flasker: 1 });
  const dead = { id: 'dead1', health: 0 };
  rec.activeRanksById.set(dead.id, 'grunt');
  hydra.campInstances.set('zone_a', [rec]);
  const frames = [];
  for (let i = 0; i < 400; i++) { frames.push(hydra.update(0.1)); await new Promise(resolve => setTimeout(resolve, 1)); }
  await Promise.all(frames);
  assert.equal(builds, 1, `a single death produced one replacement, not ${builds}`);
  assert.equal(rec.reserveByRank.grunt + rec.reserveByRank.flasker, 5, 'exactly one reserve slot was spent');
  assert.equal(rec.reinforcementSpawnInFlight, false);

  // Reserve can never be overspent by direct concurrent spawns either.
  const small = makeRec({ lieutenant: 2 });
  const results = await Promise.all(Array.from({ length: 6 }, () => hydra.spawnBandit(small, 'lieutenant')));
  assert.equal(results.filter(Boolean).length, 2, 'only the two reserved lieutenants spawn');
  assert.equal(small.reserveByRank.lieutenant, 0);
  console.log('bandit camp reinforcements ok');
})().catch(error => { console.error(error); process.exit(1); });

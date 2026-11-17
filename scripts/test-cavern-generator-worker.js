#!/usr/bin/env node
'use strict';

// Den Worker must use the exact main-thread seed sequence, preserve map
// entrance geometry and share a single in-flight carve for the same map.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const generatorSource = fs.readFileSync('docs/js/cavern-generator.js', 'utf8');
const workerSource = fs.readFileSync('docs/js/cavern-generator-worker.js', 'utf8');
const wildernessSource = fs.readFileSync('docs/js/wilderness-map-generator.js', 'utf8');
const rngStart = wildernessSource.indexOf('  function hashSeed(text)');
const rngEnd = wildernessSource.indexOf('  function randFloat(', rngStart);
assert(rngStart >= 0 && rngEnd > rngStart, 'the production canonical RNG is available');
const makeRng = new Function(wildernessSource.slice(rngStart, rngEnd) + '\nreturn makeRng;')();

function sculptFixture(sequences) {
  return {
    carveMazeCavern(opts, rng) {
      sequences.push([rng(), rng(), rng()]);
      return {
        claimed: new Set(['0,0', '1,0', '0,1', '1,1']),
        solidRim: new Set(['-1,0']),
        entranceTiles: [[0, 0]],
        nestTile: [0, 0],
        mesh: { positions: [], indices: [] },
        vaultCeiling: null,
      };
    },
  };
}

const mainSequences = []; // Captures the actual seeded input consumed by the sculptor.
const shape = { fullHeightScale: 2.5, minHeightFraction: 0.6, tallRadiusTiles: [6, 16] };
const mainWindow = { CavernSculptor: sculptFixture(mainSequences), HobunjiCaveShapeConfig: shape };
const mainGlobals = vm.createContext({ window: mainWindow, WildernessMapGenerator: { makeRng } });
vm.runInContext(generatorSource, mainGlobals, { filename: 'cavern-generator.js' });
const seed = 'map_i_den_worker_fixture';
const synchronous = mainWindow.CavernGenerator.generateCavernFloor(seed, { fast: true, cache: false });

const workerSequences = []; // Must match the source generator's use of WildernessMapGenerator.makeRng.
let posted = null;
const workerGlobals = { postMessage(data) { posted = data; }, console };
workerGlobals.self = workerGlobals;
const workerContext = vm.createContext(workerGlobals);
workerGlobals.importScripts = (...urls) => {
  for (const url of urls) {
    if (url.startsWith('cavern-sculptor.js')) workerGlobals.CavernSculptor = sculptFixture(workerSequences);
    else if (url.startsWith('cavern-generator.js')) vm.runInContext(generatorSource, workerContext);
    else throw new Error('Unexpected worker import ' + url);
  }
};
vm.runInContext(workerSource, workerContext, { filename: 'cavern-generator-worker.js' });
workerGlobals.onmessage({
  data: { id: 7, seedText: seed, generationOptions: { fast: true, cache: false }, caveShape: shape },
});
assert(posted && !posted.error, 'the worker completes a deterministic carve without DOM/Three.js');
assert.equal(posted.id, 7);
assert.deepEqual(workerSequences, mainSequences, 'worker RNG is bit-for-bit equivalent to canonical wilderness RNG');
assert.equal(JSON.stringify(posted.floorData), JSON.stringify(synchronous), 'worker returns the same entrance, floor, and mesh data');

let requests = 0; // Counts expensive jobs, not Promise consumers.
class FakeWorker {
  constructor() { this.onmessage = null; }
  postMessage(data) {
    requests++;
    assert.equal(data.seedText, seed);
    assert.equal(data.generationOptions.fast, true);
    assert.equal(data.generationOptions.cache, false);
    queueMicrotask(() => this.onmessage({ data: { id: data.id, floorData: synchronous } }));
  }
  terminate() {}
}

const asyncWindow = { HobunjiCaveShapeConfig: shape, CavernSculptor: sculptFixture([]) };
vm.runInNewContext(generatorSource, {
  window: asyncWindow, Worker: FakeWorker, performance: { now: () => 20 },
  WildernessMapGenerator: { makeRng },
});
async function verifyAsyncBridge() {
  const a = asyncWindow.CavernGenerator.generateCavernFloorAsync(seed, { fast: true });
  const b = asyncWindow.CavernGenerator.generateCavernFloorAsync(seed, { fast: true });
  assert.equal(a, b, 'concurrent requests for the same den reuse one promise');
  assert.equal(requests, 1, 'only one worker carve is queued');
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(synchronous));
  const cached = await asyncWindow.CavernGenerator.generateCavernFloorAsync(seed, { fast: true });
  assert.equal(cached, first, 'future visits use the cached floor');
  assert.equal(requests, 1, 'cached den does not incur another worker carve');
  assert.equal(asyncWindow.CavernGenerator.workerDebug().completed, 1);
}
async function verifyFailureFallback() {
  let requests = 0; // A worker-level error must not strand the scene in its loading state.
  const warnings = []; // Captures the in-game mobile warning without requiring a console.
  class FailingWorker {
    constructor() { this.onmessage = null; }
    postMessage(data) {
      requests++;
      queueMicrotask(() => this.onmessage({ data: { id: data.id, error: 'forced den worker failure' } }));
    }
    terminate() {}
  }
  const fallbackWindow = {
    HobunjiCaveShapeConfig: shape,
    CavernSculptor: sculptFixture([]),
    __farmLog: (...args) => warnings.push(args),
  };
  vm.runInNewContext(generatorSource, {
    window: fallbackWindow,
    Worker: FailingWorker,
    performance: { now: () => 20 },
    WildernessMapGenerator: { makeRng },
  });
  const floor = await fallbackWindow.CavernGenerator.generateCavernFloorAsync(seed, { fast: true });
  assert.equal(JSON.stringify(floor), JSON.stringify(synchronous), 'worker failure falls back to identical synchronous floor data');
  assert.equal(requests, 1, 'failed worker request was actually attempted');
  assert.equal(fallbackWindow.CavernGenerator.workerDebug().failures, 1, 'worker failure is available in mobile diagnostics');
  assert(warnings.some(entry => String(entry[0]).includes('forced den worker failure')), 'worker failure is recorded in the in-game log');
}

verifyAsyncBridge().then(verifyFailureFallback).then(
  () => console.log('cavern worker parity, failure fallback, deduplication and cache lifecycle passed'),
  error => { console.error(error); process.exitCode = 1; }
);

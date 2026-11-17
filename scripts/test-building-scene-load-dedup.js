#!/usr/bin/env node
'use strict';

// Regression: a null in-progress scene must never spawn duplicate async builders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const game = fs.readFileSync('docs/game.js', 'utf8'); // Executes the shipped scene-load coordinator, not a fixture rewrite.
const begin = game.indexOf('      const _buildingSceneInFlight = new Map();');
const finish = game.indexOf('      async function buildBuildingScene(mapId) {', begin);
assert(begin >= 0 && finish > begin, 'production scene loader coordinator extraction points exist');

const scenes = new Map(); // Mirrors the game's cached interior scene map.
const starts = []; // Tracks actual builder work, distinct from concurrent consumers.
const completions = new Map(); // Externally completes or rejects individual in-flight builds.
const messages = []; // Mobile-visible error reporting, no console required.
let overlayHides = 0; // Makes failure recovery of the loading overlay observable.
const coordinator = new Function('bridge', `
  const _buildingScenes = bridge.scenes;
  let _currentBuildingMapId = 'map_i_den_test';
  let currentArea = 'map_i_den_test';
  const window = bridge.window;
  const buildBuildingScene = mapId => {
    bridge.starts.push(mapId);
    _buildingScenes.set(mapId, null);
    return new Promise((resolve, reject) => bridge.completions.set(mapId, { resolve, reject }));
  };
  ${game.slice(begin, finish)}
  return { loadBuildingScene, inFlight: () => _buildingSceneInFlight.size };
`)({
  scenes, starts, completions,
  window: {
    __farmLog: (...args) => messages.push(args),
    LoadingScreenRuntime: { hide: () => overlayHides++ },
  },
});

async function main() {
  const first = coordinator.loadBuildingScene('map_i_den_test');
  const second = coordinator.loadBuildingScene('map_i_den_test');
  assert.strictEqual(first, second, 'concurrent scene callers share the same promise');
  assert.deepEqual(starts, ['map_i_den_test'], 'only one builder starts for a pending map');
  assert.equal(coordinator.inFlight(), 1);
  const independent = coordinator.loadBuildingScene('map_i_den_other');
  assert.deepEqual(starts, ['map_i_den_test', 'map_i_den_other'], 'different maps may still load concurrently');
  scenes.set('map_i_den_test', { scene: {} });
  completions.get('map_i_den_test').resolve();
  await Promise.all([first, second]);
  assert.equal(coordinator.inFlight(), 1, 'completed map is removed from the in-flight map');
  await coordinator.loadBuildingScene('map_i_den_test');
  assert.deepEqual(starts, ['map_i_den_test', 'map_i_den_other'], 'completed cached scene does not rebuild');

  completions.get('map_i_den_other').reject(new Error('simulated decode failure'));
  await assert.rejects(independent, /simulated decode failure/, 'real callers receive failures');
  assert.equal(coordinator.inFlight(), 0, 'failed scene releases its in-flight promise');
  assert.equal(scenes.has('map_i_den_other'), false, 'failed scene releases the null sentinel so retries work');
  assert(messages.some(m => String(m[0]).includes('simulated decode failure')), 'failure is captured in the in-game debug log');

  const failedActive = coordinator.loadBuildingScene('map_i_den_test_failed');
  // The currentArea isn't this failed map, so its overlay must not be hidden.
  completions.get('map_i_den_test_failed').reject(new Error('active-map check'));
  await assert.rejects(failedActive, /active-map check/);
  assert.equal(overlayHides, 0);
  coordinator.loadBuildingScene('map_i_den_other');
  assert.equal(starts.filter(m => m === 'map_i_den_other').length, 2, 'a previously failed map can retry');
  completions.get('map_i_den_other').resolve();
  await Promise.resolve();
  console.log('building scene load coalescing, cache, error cleanup and retry passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

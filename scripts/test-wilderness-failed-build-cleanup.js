'use strict';
const assert = require('node:assert/strict'); // Validates failed partial builds release registry and GPU ownership.
const fs = require('node:fs'); // Loads runtime and existing lightweight Three.js fixture.
const vm = require('node:vm'); // Reuses the established chunk test's scene objects.
const fixture = fs.readFileSync('scripts/test-wilderness-chunks.js', 'utf8').split("let currentArea = 'map_northern_cliffs';")[0]; // Only bootstrap, no legacy test assertions.
const run = fixture + `
let detached = 0; // Counts partial registry cleanup.
let disposed = 0; // Counts the configured GPU cleanup callback.
let attempts = 0; // Detects retry storms after a failed build.
const failedScene = new Group(); // Owns temporary chunk groups.
const oldConsoleError = console.error; // Expected failures should not flood test output.
console.error = () => {};
try {
  const failed = context.WildernessChunks.createZone({
    mapId: 'failed', scene: failedScene, cols: 16, rows: 16,
    buildChunk(ctx) { attempts++; ctx.payload = { partial: true }; throw new Error('allocation failed'); },
    onChunkUnloaded(record) { assert.equal(record.payload.partial, true); detached++; },
    disposeChunk() { disposed++; },
  });
  failed.prime(1, 1);
  assert.equal(detached, 1);
  assert.equal(disposed, 1);
  assert.equal(failedScene.children.length, 0);
  for (let i = 0; i < 60; i++) failed.updateActive(1, 1, 0.2);
  assert.equal(attempts, 1, 'failed chunk must not rebuild every frame');
  now += 6000;
  failed.updateActive(1, 1, 0.2);
  assert.equal(attempts, 2, 'retry becomes possible after cooldown');

  const staged = context.WildernessChunks.createZone({
    mapId: 'staged', scene: new Group(), cols: 16, rows: 16,
    buildChunk() {},
    buildChunkStages: function* (ctx) { ctx.payload = { partial: true }; yield; throw new Error('stage failed'); },
    onChunkUnloaded(record) { assert.equal(record.payload.partial, true); detached++; },
    disposeChunk() { disposed++; },
  });
  staged.beginStaged(0, 0);
  staged.stepStaged(0);
  staged.stepStaged(Infinity);
  assert.equal(staged.scene.children.length, 0);
  assert.equal(staged.staged, null);
  assert.equal(disposed, 3);
  staged.beginStaged(0, 0);
  staged.stepStaged(0);
  staged.updateInactive(5);
  assert.equal(staged.staged, null, 'inactive zone cancels a partial build even with zero completed chunks');
  assert.equal(disposed, 4);
} finally { console.error = oldConsoleError; }
`;
vm.runInNewContext(run, { require, console }, { filename: 'chunk-cleanup-fixture.js' });
console.log('Failed and inactive partial chunk cleanup passed.');

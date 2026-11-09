#!/usr/bin/env node
'use strict';
// A ruin with no glyph circuits (the Hachutu temple, or any ruin with Projectile glyph targets off) must not pay
// for an occupancy snapshot every rendered frame: getSnapshot() sorts every floor cell, and frame() retries
// build() on every render until circuits exist. Runs the real module against stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/dev-random-ruin-glyph-circuits.js'), 'utf8');
let snapshotReads = 0;
let circuits = [];
let frame = null;
const root = { parent: {} };
const sandbox = {
  console,
  setTimeout: () => 0,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {} },
  document: { readyState: 'complete', getElementById: () => null },
  THREE: { Box3: class {}, Color: class {}, Vector3: class {} },
};
sandbox.window = sandbox;
Object.assign(sandbox, {
  DynamicSurfaces: { addBeforeRenderClient: fn => { frame = fn; } },
  GridTileAccessors: { getCurrentArea: () => 'map_i_dev_random_ruin' },
  DevRandomRuinHitPuzzles: { getRoot: () => root, getGlyphCircuits: () => circuits },
  DevRandomRuinTileOccupancy: { getSnapshot: () => { snapshotReads++; return null; } },
});
vm.runInNewContext(source, sandbox);
assert.equal(typeof frame, 'function', 'glyph circuits must register a before-render client');

for (let i = 0; i < 30; i++) frame();
assert.equal(snapshotReads, 0, 'a ruin without glyph circuits must never request the occupancy snapshot');

// Once circuits exist the snapshot is requested again (build proceeds past the cheap guards).
circuits = [{ targets: [] }];
frame();
assert.ok(snapshotReads >= 1, 'circuits present: build must read the occupancy snapshot');
console.log('PASS glyph circuits idle without occupancy snapshot reads');

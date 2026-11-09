#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercises game.js's real walker loop with a reproducible NPC exception.
const fs = require('node:fs'); // Reads the integration owner instead of a second implementation.
const vm = require('node:vm'); // Supplies deterministic gameplay dependencies.
const source = fs.readFileSync('docs/game.js', 'utf8'); // Extracts the actual simulation function that formerly aborted before world rendering.
const start = source.indexOf('      function updateNpcWalkers(dt) {'); // Integration boundary retained by the existing game owner.
const end = source.indexOf('      // ── Town zone', start); // End of the standalone walker pass.
let now = 0, brokenCalls = 0, healthyCalls = 0, visualCalls = 0, doorCalls = 0, logs = 0; // Independent clocks/counters prove cooldown, progress and log throttling.
let fail = true; // Recovery must resume ordinary updates without reconstructing the walker.
function walker(id, update) { return { rec: { id }, area: 'town', root: { position: { x: 20, z: 20 } }, update }; }
const broken = walker('broken', () => { brokenCalls++; if (fail) throw new Error('festival chair failure'); }); // A deterministic failure stands in for a broken authored NPC/asset update.
const healthy = walker('healthy', () => { healthyCalls++; }); // Runs after the failing walker in the real backwards loop.
const context = {
  window: { __farmLog: () => { logs++; }, InteriorDoorTiles: { update: () => { doorCalls++; } } },
  performance: { now: () => now },
  npcWalkers: [healthy, broken], nearbyNpcWalker: null,
  npcMovementHeadLookOptions: {}, cutscenePreviewActive: false, npcDialogueStaging: null, _dialogueWalker: null,
  player: { x: 0, y: 0 }, TILE: 1,
  currentArea: 'town', npcMovementConfig: () => ({}),
  isPlayerInCombat: () => false, // The real NPC-update frame consults combat before exposing aimed social interactions.
  updateNpcVisitorArrivals() {}, _logGarankiDiagnostic() {},
  _tickNpcPortraitLife: () => { visualCalls++; },
  getHeldGiftItem() {}, refreshActionBar() {},
}; // Only external systems are stubbed; error handling, retry and iteration run unchanged.
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.tick = updateNpcWalkers;', context);
context.tick(0.016);
assert.equal(healthyCalls, 1, 'one bad NPC must not abort later NPC updates');
assert.equal(visualCalls, 1, 'healthy portraits keep updating');
assert.equal(doorCalls, 1, 'world work after NPC updates still executes');
assert.match(broken._npcUpdateError.stack, /festival chair failure/);
assert.equal(logs, 1);
now = 500;
context.tick(0.016);
assert.equal(brokenCalls, 1, 'broken NPC is not retried every frame');
assert.equal(healthyCalls, 2);
now = 1000;
context.tick(0.016);
assert.equal(brokenCalls, 2, 'transient failures retry after one second');
assert.equal(logs, 1, 'repeated errors do not flood the mobile log');
now = 5000;
context.tick(0.016);
assert.equal(logs, 2, 'persistent error is periodically visible');
fail = false; now = 6000;
context.tick(0.016);
assert.equal(broken._npcUpdateError, null, 'a recovered NPC returns to ordinary simulation');
assert.equal(visualCalls, 6, 'recovered NPC also resumes its portrait updates');
now = 6001; context.tick(0.016);
assert.equal(brokenCalls, 5, 'recovered NPC has no remaining retry throttle');
console.log('NPC update errors cannot abort the world frame; cooldown, diagnostics and recovery passed.');

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies the live portrait-life owner, including asynchronous crowd contention.
const fs = require('node:fs'); // Loads production code rather than duplicating its distance policy.
const vm = require('node:vm'); // Supplies lightweight browser dependencies without WebGL.
const renders = []; // Records exactly which NPC/player composites were requested.
const uploads = []; // Records completed texture uploads.
let finishNpc = null; // Delays one NPC composite to simulate expensive art during a crowded festival.
let rejectNpc = null; // Simulates an asset failure so the shared render slot must recover.
let area = 'town'; // Exercises the existing current-area gate.
const playerTile = { x: 10, y: 20 }; // Distances are measured in world tiles rather than pixels or rounded grid cells.
const avatar = { group: { userData: { frontTexture: {} } }, frontCanvas: {}, profile: {}, generation: 1 }; // Independent player path must continue while the NPC slot is busy.
const window = {
  portraitBreathingComposer: { setDefaultExpression() {} },
  NpcAvatarPreview: { renderProfileToCanvas(canvas, profile, options) {
    renders.push(options.seatId);
    if (options.seatId.startsWith('npc')) return new Promise((resolve, reject) => { finishNpc = resolve; rejectNpc = reject; });
    return Promise.resolve();
  } },
  PNGPlaneAvatar: { refreshSinglePlaneAvatarModel(group) { uploads.push(group); } },
}; // Only rendering itself is stubbed; scheduling and radius checks are production code.
vm.runInNewContext(fs.readFileSync('docs/js/world-portrait-life.js', 'utf8'), { window, document: { createElement: () => ({}) } });
const life = window.WorldPortraitLife; // Public API also used by gameLoop.
life.init({ getCurrentArea: () => area, getPlayerTile: () => playerTile, getPlayerAvatar: () => avatar, rnd: () => 0.5 });
function walker(id, dx, dz = 0) {
  return { rec: { id }, area: 'town', root: { position: { x: playerTile.x + dx, z: playerTile.y + dz } }, avatarGroup: { userData: { frontTexture: {} } }, avatarFrontCanvas: {}, profile: {} };
}
async function flush() { await new Promise(resolve => setImmediate(resolve)); }
(async () => {
  const boundary = walker('npc-boundary', 1); // Inclusive one-tile boundary.
  const outside = walker('npc-outside', 1.001); // Just outside must never be recomposited.
  const diagonal = walker('npc-diagonal', 0.8, 0.8); // Radial distance excludes diagonal points outside the circle.
  life.tickNpc(outside, 1);
  life.tickNpc(diagonal, 1);
  assert.equal(renders.length, 0);
  life.tickNpc(boundary, 1);
  assert.deepEqual(renders, ['npc-boundary']);
  const neighbors = Array.from({ length: 30 }, (_, i) => walker(`npc-crowd-${i}`, 0)); // All 30 share a station, reproducing worst-case festival density.
  for (const npc of neighbors) life.tickNpc(npc, 1);
  assert.equal(renders.length, 1, 'only one NPC composite can be in flight');
  assert.equal(life.snapshot().npcBudgetSkips, 30);
  life.tickPlayer(1);
  assert(renders.includes('player'), 'player keeps breathing while NPC rendering is busy');
  finishNpc(); await flush();
  assert(uploads.includes(boundary.avatarGroup));
  assert.equal(life.snapshot().npcLifePending, false);
  life.tickNpc(neighbors[0], 0);
  assert.equal(renders.at(-1), 'npc-crowd-0', 'deferred NPC keeps its elapsed interval');
  rejectNpc(new Error('missing portrait')); await flush();
  assert.equal(life.snapshot().npcLifePending, false, 'failed render releases the crowd slot');
  life.tickNpc(neighbors[1], 0);
  finishNpc(); await flush();
  area = 'farm';
  life.tickNpc(boundary, 1);
  assert.equal(renders.at(-1), 'npc-crowd-1', 'off-area NPCs never composite');
  area = 'town';
  window.SCRATCHBONES_CONFIG = { game: { portrait: { worldLife: { nearTiles: 12, farTiles: 24 } } } };
  life.tickNpc(outside, 1);
  assert.equal(renders.at(-1), 'npc-crowd-1', 'old overrides cannot restore distant breathing');
  assert.equal(life.config().farTiles, 1);
  const missingPosition = walker('npc-invalid', 0); // Invalid transforms cannot bypass the distance gate.
  missingPosition.root.position.x = NaN;
  life.tickNpc(missingPosition, 1);
  assert.equal(renders.at(-1), 'npc-crowd-1');
  console.log('One-tile NPC breathing, crowd serialization, and independent player updates passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies the live portrait-life owner, including asynchronous crowd contention.
const fs = require('node:fs'); // Loads production code rather than duplicating its distance policy.
const vm = require('node:vm'); // Supplies lightweight browser dependencies without WebGL.
const renders = []; // Records exactly which NPC/player composites were requested.
const uploads = []; // Records completed texture uploads.
const defaults = new Map(); // Per-NPC resting expression is shared by the actual world portrait and dialogue.
const overrides = new Map(); // Simulates an authored temporary expression changing during an async render.
function makeCanvas() {
  const canvas = { width: 48, height: 48, expression: 'neutral' }; // Detached renderer source and live texture target share the same dimensions.
  canvas.getContext = () => ({
    clearRect() {},
    drawImage(source) { canvas.expression = source.expression; },
  });
  return canvas;
}
let finishNpc = null; // Delays one NPC composite to simulate expensive art during a crowded festival.
let rejectNpc = null; // Simulates an asset failure so the shared render slot must recover.
let area = 'town'; // Exercises the existing current-area gate.
const playerTile = { x: 10, y: 20 }; // Distances are measured in world tiles rather than pixels or rounded grid cells.
const avatar = { group: { userData: { frontTexture: {} } }, frontCanvas: makeCanvas(), profile: {}, generation: 1 }; // Independent player path must continue while the NPC slot is busy.
const window = {
  portraitBreathingComposer: {
    setDefaultExpression(seatId, face) { defaults.set(seatId, face || 'neutral'); },
    getExpression(seatId) { return overrides.get(seatId) || defaults.get(seatId) || 'neutral'; },
  },
  DialogueContent: {
    dialogueSeatId: walker => walker.rec.id,
    npcRestingExpression: rec => rec.restingExpression || 'neutral',
  },
  NpcAvatarPreview: { renderProfileToCanvas(canvas, profile, options) {
    renders.push(options.seatId);
    canvas.expression = window.portraitBreathingComposer.getExpression(options.seatId); // Production composer decides the sprite baked into the world portrait.
    if (options.seatId.startsWith('npc')) return new Promise((resolve, reject) => { finishNpc = resolve; rejectNpc = reject; });
    return Promise.resolve(true);
  } },
  PNGPlaneAvatar: { refreshSinglePlaneAvatarModel(group, canvas) { group.userData.lastExpression = canvas.expression; uploads.push(group); return true; } },
}; // Only rendering itself is stubbed; scheduling and radius checks are production code.
vm.runInNewContext(fs.readFileSync('docs/js/world-portrait-life.js', 'utf8'), { window, document: { createElement: () => makeCanvas() } });
const life = window.WorldPortraitLife; // Public API also used by gameLoop.
life.init({ getCurrentArea: () => area, getPlayerTile: () => playerTile, getPlayerAvatar: () => avatar, rnd: () => 0.5 });
function walker(id, dx, dz = 0) {
  return { rec: { id }, area: 'town', root: { position: { x: playerTile.x + dx, z: playerTile.y + dz } }, avatarGroup: { userData: { frontTexture: {} } }, avatarFrontCanvas: makeCanvas(), profile: {} };
}
async function flush() { await new Promise(resolve => setImmediate(resolve)); }
(async () => {
  const boundary = walker('npc-boundary', 5); // Inclusive five-tile visible range.
  boundary.rec.restingExpression = 'smile'; // This authored expression must reach the physical live NPC face.
  const outside = walker('npc-outside', 5.001); // Outside the five-tile range never recomposes.
  const diagonal = walker('npc-diagonal', 3.7, 3.7); // Circular range excludes diagonal corners.
  life.tickNpc(outside, 1);
  life.tickNpc(diagonal, 1);
  assert.equal(renders.length, 0);
  life.tickNpc(boundary, 1);
  assert.deepEqual(renders, ['npc-boundary']);
  const neighbors = Array.from({ length: 30 }, (_, i) => walker(`npc-crowd-${i}`, 0)); // All 30 share a station, reproducing worst-case festival density.
  for (const npc of neighbors) life.tickNpc(npc, 1);
  assert.equal(renders.length, 1, 'only one NPC composite can be in flight');
  assert.equal(life.snapshot().npcBudgetSkips, 30);
  assert.equal(life.snapshot().npcQueueLength, 30, 'each crowded NPC queues only once while another portrait renders');
  life.tickPlayer(1);
  assert(renders.includes('player'), 'player keeps breathing while NPC rendering is busy');
  finishNpc(); await flush();
  assert(uploads.includes(boundary.avatarGroup));
  assert.equal(boundary.avatarGroup.userData.lastExpression, 'smile', 'nearby resting-expression sprite must upload to the NPC live world portrait');
  assert.equal(life.snapshot().npcLifePending, false);
  life.tickNpc(neighbors[0], 0);
  assert.equal(renders.at(-1), 'npc-crowd-0', 'deferred NPC keeps its elapsed interval');
  rejectNpc(new Error('missing portrait')); await flush();
  assert.equal(life.snapshot().npcLifePending, false, 'failed render releases the crowd slot');
  life.tickNpc(neighbors[1], 0);
  finishNpc(); await flush();
  for (let index = 2; index < neighbors.length; index++) {
    life.tickNpc(neighbors[index], 0);
    assert.equal(renders.at(-1), `npc-crowd-${index}`, 'FIFO advances to the next NPC instead of redrawing the first NPC');
    finishNpc(); await flush();
  }
  assert.equal(life.snapshot().npcQueueLength, 0, 'the nearby NPC crowd drains without starving later walkers');
  const peripheral = walker('npc-peripheral', 3); // Beyond two tiles, still nearby but animated more slowly.
  life.tickNpc(peripheral, 0.2);
  assert.equal(renders.at(-1), 'npc-crowd-29', 'peripheral refresh is throttled');
  life.tickNpc(peripheral, 0.6);
  assert.equal(renders.at(-1), 'npc-peripheral', 'peripheral expression updates eventually reach the same live portrait');
  finishNpc(); await flush();

  const stale = walker('npc-stale', 1); // Render completion must not replace a newer expression with the older result.
  stale.rec.restingExpression = 'smile';
  life.tickNpc(stale, 1);
  overrides.set('npc-stale', 'frown');
  const beforeStale = uploads.length;
  finishNpc(); await flush();
  assert.equal(uploads.length, beforeStale, 'in-flight older facial expression never uploads');
  life.tickNpc(stale, 1);
  finishNpc(); await flush();
  assert.equal(stale.avatarGroup.userData.lastExpression, 'frown', 'next nearby update shows the new expression sprite');

  const moved = walker('npc-moved', 1); // A walker can leave the player's proximity while its face loads.
  life.tickNpc(moved, 1);
  moved.root.position.x += 20;
  const beforeMove = uploads.length;
  finishNpc(); await flush();
  assert.equal(uploads.length, beforeMove, 'out-of-range NPC does not upload stale face art');

  const rebuilt = walker('npc-rebuilt', 1); // Re-equipping creates a new portrait profile.
  life.tickNpc(rebuilt, 1);
  rebuilt.profile = {};
  const beforeRebuild = uploads.length;
  finishNpc(); await flush();
  assert.equal(uploads.length, beforeRebuild, 'new outfit is not overwritten by an older asynchronous portrait render');

  area = 'farm';
  life.tickNpc(boundary, 1);
  assert.equal(renders.at(-1), 'npc-rebuilt', 'off-area NPCs never composite');
  area = 'town';
  window.SCRATCHBONES_CONFIG = { game: { portrait: { worldLife: { nearTiles: 12, farTiles: 24 } } } };
  life.tickNpc(outside, 1);
  assert.equal(renders.at(-1), 'npc-rebuilt', 'old overrides cannot restore distant breathing');
  assert.equal(life.config().farTiles, 5, 'legacy radius overrides are capped to nearby NPCs');
  assert.equal(life.config().nearTiles, 5, 'near radius may not exceed the hard far radius');
  const missingPosition = walker('npc-invalid', 0); // Invalid transforms cannot bypass the distance gate.
  missingPosition.root.position.x = NaN;
  life.tickNpc(missingPosition, 1);
  assert.equal(renders.at(-1), 'npc-rebuilt');
  finishNpc(); await flush();
  const render=window.NpcAvatarPreview.renderProfileToCanvas; // Force setup failure before a Promise exists.
  window.NpcAvatarPreview.renderProfileToCanvas=()=>{throw new Error('setup failed');};
  life.tickNpc(walker('npc-sync-failure',0),1);
  assert.equal(life.snapshot().npcLifePending,false,'synchronous setup failure releases the crowd slot');
  window.NpcAvatarPreview.renderProfileToCanvas=render;
  life.tickNpc(walker('npc-after-failure',0),1);
  assert.equal(renders.at(-1),'npc-after-failure');finishNpc();await flush();
  console.log('Nearby NPC runtime expression sprites, stale-portrait protection, crowd serialization, and independent player updates passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

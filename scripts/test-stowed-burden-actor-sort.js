#!/usr/bin/env node
'use strict';
// Regression: with 2+ actors nearby, every portrait sorts at PORTRAIT_SORT_ORDER (2). A back-stowed
// Burden (2.15) that was NOT ranked with its carrier compared its raw order against that 2 and drew
// AFTER the carrier's front face (2.25), so a stowed baby showed through the parent's chest.
// The carrier's Shattercasks meshes must sort inside the player's actor slot by their own order.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');
const slice = (startText, endText) => {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert(start > 0 && end > start, 'extract ' + startText.trim());
  return source.slice(start, end);
};
const code = slice('  function comparePortraitDraws(', '  function withPortraitDrawOrder(')
  + slice('  function nearbyPortraitOrder(', '  function rankedHeldOverlayOrder(')
  + '\nreturn { comparePortraitDraws, nearbyPortraitOrder };';
assert.match(source, /window\.Shattercasks\?\.carrierSortMeshes\?\.\(\)/, 'actor sort asks Shattercasks for carrier meshes');
assert.match(fs.readFileSync('docs/js/shattercasks.js', 'utf8'), /carrierSortMeshes:\(\)=>\[\.\.\.heldRenderOrders\.keys\(\)/,
  'Shattercasks exposes its held/stowed render-managed meshes');

const node = (name, z, parent = null) => ({ name, parent, visible: true, id: Math.random(),
  matrixWorld: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,z,1] }, updateWorldMatrix() {} });
const scene = { name: 'scene' };
const player = node('player_root', 5, scene);
const npc = node('npc_walker_7', 3, scene); // A second nearby actor activates actor-depth sorting.
const playerFront = { ...node('player_front', 5, player), renderOrder: 2.25 };
const npcFront = { ...node('npc_front', 3, npc), renderOrder: 2 };
const rearOverlay = { ...node('shattercask_carrier_rear_only_xray', 5, player), renderOrder: 2.05 };
const stowedBaby = { ...node('baby_carried_posed_portrait', 5, player), renderOrder: 2.15 };
const ownerOf = mesh => { for (let n = mesh; n; n = n.parent) if (n === player || n === npc) return n; return null; };
const window = {
  PlayerBodyTransformComposer: { getPlayerMesh: () => player },
  Shattercasks: { carrierSortMeshes: () => [stowedBaby, rearOverlay] },
  PantsGarmentRenderer: { liveHandles: () => [] },
};
const portraitSortPoint = { z: 0, set(x, y, z) { this.z = z; return this; }, applyMatrix4() { return this; } };
const api = new Function('window', 'portraitStencilOwner', 'xrayRule', 'PORTRAIT_SORT_DISTANCE', 'PORTRAIT_SORT_ORDER',
  'portraitSortPoint', code)(window, ownerOf, () => 'all', 2, 2, portraitSortPoint);
const camera = { projectionMatrix: {}, matrixWorldInverse: {}, updateMatrixWorld() {} };
const order = api.nearbyPortraitOrder(scene, camera, [playerFront, npcFront]);
assert(order && order.count === 2, 'two actors activate actor-depth ordering');
assert.equal(order.extras.get(stowedBaby), order.ranks.get(playerFront), 'stowed Burden shares the carrier actor rank');
assert.equal(order.extras.get(rearOverlay), order.ranks.get(playerFront), 'rear-portrait pass shares the carrier actor rank');

const item = (mesh, id) => ({ object: mesh, renderOrder: mesh.renderOrder, groupOrder: 0, z: mesh.matrixWorld.elements[14], id });
const items = [item(playerFront, 1), item(stowedBaby, 2), item(rearOverlay, 3)];
const sorted = items.slice().sort((a, b) => api.comparePortraitDraws(a, b, order.ranks, order.extras)).map(i => i.object.name);
assert.deepEqual(sorted, ['shattercask_carrier_rear_only_xray', 'baby_carried_posed_portrait', 'player_front'],
  'rear portrait -> stowed Burden -> front portrait sandwich survives actor sorting');

// Before the fix (no extras), the stowed Burden sorted after the ranked front portrait.
const unranked = items.slice().sort((a, b) => api.comparePortraitDraws(a, b, order.ranks, new Map())).map(i => i.object.name);
assert.equal(unranked.indexOf('baby_carried_posed_portrait') > unranked.indexOf('player_front'), true,
  'fixture reproduces the original chest-show-through order without carrier extras');
console.log('PASS stowed Burden keeps the rear/Burden/front sandwich when actor-depth sorting is active');

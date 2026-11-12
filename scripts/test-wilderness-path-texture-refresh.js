#!/usr/bin/env node
'use strict';

// A wildcard ground PNG arriving after zone construction must update the
// always-resident route apron as well as resident wilderness chunks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const oldMaterial = { name: 'plain-grass' }; // Initial material on the zone-wide path ground before terrain config loads.
const texturedMaterial = { name: 'wavy-surface-png' }; // Resolved grass material once the late wildcard config arrives.
const thirdMaterial = { name: 'updated-png' }; // Simulates a second material refresh without an edit.
const geometry = {}; // Must remain identical: a texture refresh should never rebuild the enormous global apron geometry.
const globalGround = {
  userData: { wildernessGlobalPathGround: true, mapEditorTerrain: { mapId: 'map_western_slope' } },
  geometry,
  material: oldMaterial,
};
const ordinaryFloor = { userData: { mapEditorTerrain: { mapId: 'map_western_slope' } }, material: oldMaterial };
const grid = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => ({ type: 'grass', elevTier: 0 }))); // Local floor data drives the flat-versus-cliff edit optimization.
const zone = { chunkController: true, grid, pathNet: { refreshTileAndSeam() { return false; } } };
const logs = [];
let chunkRebuilds = 0;
let mesaRebuilds = 0;
let syncCalls = 0;
let activeMaterial = texturedMaterial;

const window = {
  WildernessChunks: { rebuildZone() { chunkRebuilds++; return 2; } },
  ZonePlateauMesa: { rebuildZoneMesaMeshes() { mesaRebuilds++; } },
  WildTreasure: { syncZoneInteractivity() { syncCalls++; } },
};
vm.runInNewContext(fs.readFileSync('docs/js/zone-regrowth.js', 'utf8'), { window });
window.ZoneRegrowth.init({
  TileType: { GRASS: 'grass' },
  _zoneScenes: new Map([['map_western_slope', zone]]),
  _zoneFloorMeshGroups: new Map([['map_western_slope', [ordinaryFloor, globalGround]]]),
  resolveTileMat(mapId, kind) {
    assert.equal(mapId, 'map_western_slope');
    assert.equal(kind, 'grass');
    return activeMaterial;
  },
  debugLog(message) { logs.push(message); },
});

window.ZoneRegrowth.refreshZoneGroundVisuals('map_western_slope');
assert.equal(globalGround.material, texturedMaterial,
  'full refresh must also update the persistent global apron to the configured PNG material');
assert.equal(globalGround.geometry, geometry, 'global path geometry stays intact');
assert.equal(ordinaryFloor.material, oldMaterial, 'resident chunk meshes remain owned by chunk rebuilds');
assert.equal(chunkRebuilds, 1, 'streamed chunks also refresh');
assert.equal(mesaRebuilds, 1, 'mesa rebuild remains intact');
assert.equal(syncCalls, 1, 'treasure lifecycle remains intact');

activeMaterial = thirdMaterial;
window.ZoneRegrowth.refreshZoneGroundVisuals('map_western_slope', 8, 9);
assert.equal(globalGround.material, texturedMaterial,
  'an ordinary tile edit does not scan or replace the persistent path material');
assert.equal(mesaRebuilds, 1, 'flat ground edit avoids rebuilding unrelated full-zone plateau geometry');
assert.match(logs[logs.length - 1], /mesas=unchanged/, 'mobile log reports the safe flat-ground fast path');
grid[12][12].elevTier = 1; // A raised tile forces real plateau geometry ownership near the next edit.
window.ZoneRegrowth.refreshZoneGroundVisuals('map_western_slope', 13, 12);
assert.equal(mesaRebuilds, 2, 'edits within four tiles of a raised tier still rebuild the mesa');
assert.match(logs[logs.length - 1], /mesas=rebuilt/, 'mobile log reports terrain rebuild around a tier edge');
window.ZoneRegrowth.refreshZoneGroundVisuals('map_western_slope');
assert.equal(globalGround.material, thirdMaterial, 'later full material refresh can replace the old finish');
assert.equal(logs.filter(message => message.includes('updated global path substrate material')).length, 2,
  'material rebinding is logged for mobile without per-frame work');
console.log('wilderness global path texture refresh: ok');

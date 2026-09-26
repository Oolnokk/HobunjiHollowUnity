#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const WildernessMapGenerator = require('../docs/js/wilderness-map-generator.js');

const WATER_TYPES = new Set(['river', 'stream', 'waterfall']);
const SEEDS = [
  'eastern_mire_archipelago_regression_a',
  'eastern_mire_archipelago_regression_b',
];

function rootTile(workspace, col, row) {
  const root = (workspace.maps || []).find(map => map && !map.isSubmap);
  return root?.tiles?.[`${col},${row}`] || null;
}

function countTopologicalComponentsByIsland(root) {
  const visited = new Set(); // Used to prove each primary island footprint is one cardinally connected landmass rather than detached shoreline speckles.
  const counts = new Map(); // Used to count separate footprint components for each exported archipelagoIslandId.
  for (let row = 0; row < root.rows; row++) {
    for (let col = 0; col < root.cols; col++) {
      const key = `${col},${row}`;
      const tile = root.tiles?.[key];
      if (visited.has(key) || !tile?.archipelagoIslandId || tile.archipelagoSea) continue;
      const islandId = tile.archipelagoIslandId;
      counts.set(islandId, (counts.get(islandId) || 0) + 1);
      const queue = [[col, row]];
      visited.add(key);
      for (let head = 0; head < queue.length; head++) {
        const [x, y] = queue[head];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= root.cols || ny >= root.rows) continue;
          const nextKey = `${nx},${ny}`;
          const nextTile = root.tiles?.[nextKey];
          if (visited.has(nextKey) || nextTile?.archipelagoIslandId !== islandId || nextTile.archipelagoSea) continue;
          visited.add(nextKey);
          queue.push([nx, ny]);
        }
      }
    }
  }
  return counts;
}

for (const seed of SEEDS) {
  const workspace = WildernessMapGenerator.generateZoneWorkspace('map_eastern_mire', seed);
  const root = (workspace.maps || []).find(map => map && !map.isSubmap);
  assert(root, `Eastern Mire must export a root map for ${seed}`);
  assert.equal(root.cols, 200, 'Eastern Mire must retain the normal 2x exported wilderness width');
  assert.equal(root.rows, 200, 'Eastern Mire must retain the normal 2x exported wilderness height');

  const archipelago = workspace.archipelago;
  assert(archipelago?.enabled, 'Eastern Mire workspace must expose archipelago diagnostics');
  assert.equal(archipelago.intendedIslandCount, 12, 'Eastern Mire should generate twelve freely scattered primary islands');
  assert(archipelago.seaRatio > 0.74 && archipelago.seaRatio < 0.88,
    `open-water coverage should dominate the mire without starving the islands, got ${archipelago.seaRatio}`);
  assert(archipelago.boatSeparatedTiles > 0, 'some walkable land must be intentionally separated from the entry island by boat water');
  assert(archipelago.movementComponentCount >= 6,
    `the final mire should retain multiple on-foot components, got ${archipelago.movementComponentCount}`);

  const tiles = Object.values(root.tiles || {});
  const seaTiles = tiles.filter(tile => tile.archipelagoSea);
  assert(seaTiles.length > root.cols * root.rows * 0.74, 'roughly three quarters or more of the exported mire should be open inter-island water');
  assert(seaTiles.every(tile => WATER_TYPES.has(tile.type)),
    'archipelagoSea tiles must remain water in the editor/game export; reachability repair may not turn them into paths');
  assert.equal(seaTiles.filter(tile => tile.type === 'path').length, 0,
    'archipelago sea must never be converted into automatic bridge/path tiles');

  const islandIds = new Set(
    tiles
      .filter(tile => !tile.archipelagoSea && tile.archipelagoIslandId)
      .map(tile => tile.archipelagoIslandId)
  );
  const componentCounts = countTopologicalComponentsByIsland(root); // Verifies shoreline irregularity never fragments a named primary island.
  for (let index = 1; index <= 12; index++) {
    const islandId = `island_${String(index).padStart(2, '0')}`;
    assert(islandIds.has(islandId), `primary ${islandId} must survive the final export`);
    assert.equal(componentCounts.get(islandId), 1, `${islandId} must remain one contiguous island footprint`);
  }

  const sourceIslands = archipelago.sourceIslands || [];
  const xBands = new Set(sourceIslands.map(island => Math.round(island.centerX / 6))); // Coarse center bands expose accidental return to neat columns.
  const yBands = new Set(sourceIslands.map(island => Math.round(island.centerY / 6))); // Coarse center bands expose accidental return to neat rows.
  assert(xBands.size >= 7 && yBands.size >= 7,
    `island centers should be freely scattered rather than a visible grid (x bands ${xBands.size}, y bands ${yBands.size})`);
  assert(sourceIslands.every(island => island.armCount >= 2 && island.lobeCount > island.armCount),
    'every primary island should be built from a multi-lobed continent silhouette rather than one regular ellipse');

  const houseTile = rootTile(workspace, 34, 29);
  assert(houseTile, 'Leaf & Pahu fixed map coordinate must exist');
  assert(!houseTile.archipelagoSea && !WATER_TYPES.has(houseTile.type),
    'Leaf & Pahu fixed coordinate (34,29) must remain dry land across Tothal rerolls');

  const entryTile = rootTile(workspace, workspace.entry.col, workspace.entry.row);
  assert(entryTile, 'generated Eastern Mire entry tile must exist');
  assert(!entryTile.archipelagoSea && !WATER_TYPES.has(entryTile.type),
    'west entry gate must land on the entry island rather than spawning the player in open water');
}

const westernSlope = WildernessMapGenerator.generateZoneWorkspace('map_western_slope', 'archipelago_non_mire_control');
assert.equal(westernSlope.archipelago, null, 'archipelago terrain must remain opt-in and must not affect other wilderness zones');

console.log('Eastern Mire archipelago regression passed.');

'use strict';

const assert = require('node:assert/strict');

global.window = global;
require('../docs/js/cavern-sculptor.js');

function seededRng(seed) {
  let state = seed >>> 0; // Used by the deterministic low-cost cavern test below.
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const result = global.CavernSculptor.carveMazeCavern({
  branchCount: 4,
  gridN: 32,
  tileSize: 0.5,
}, seededRng(0x484f4255));

assert.ok(result.claimed.size > 0, 'the test cavern must have walkable floor');
assert.ok(
  result.walkableSculptFragmentsSmoothed > 0,
  'the fixture must exercise smooth sculpting of wall spill inside walkable tiles',
);

const positions = result.mesh.positions;
const indices = result.mesh.indices;
let retainedSmoothedWallTriangles = 0; // Proves wall geometry is preserved as a shallow boundary bevel instead of deleted.
let deeplyIntrudingTriangles = 0; // Counts wall/overhang fragments still extending materially into walkable space.
let worstWalkableWallDepth = 0; // Reported below to make smoothing regressions diagnosable without rendering the seed.
let worstWalkableWallTile = ''; // Identifies the failing tile in assertion output when a sculpt regression occurs.
const visiblyBlockingHeight = 0.25; // Allows the sculpted floor's shallow edge bevel while rejecting overhead rock.
for (let q = 0; q < indices.length; q += 3) {
  const ids = [indices[q], indices[q + 1], indices[q + 2]];
  const centerX = ids.reduce((sum, id) => sum + positions[id * 3], 0) / 3;
  const centerZ = ids.reduce((sum, id) => sum + positions[id * 3 + 2], 0) / 3;
  const tileKey = `${Math.floor(centerX)},${Math.floor(centerZ)}`;
  if (!result.claimed.has(tileKey)) continue;
  const ys = ids.map(id => positions[id * 3 + 1]);
  const yRange = Math.max(...ys) - Math.min(...ys);
  if (Math.min(...ys) <= visiblyBlockingHeight + 1e-6 && yRange <= 0.15) continue;
  retainedSmoothedWallTriangles++;
  const maxDepth = Math.max(...ids.map(id => {
    const x = positions[id * 3], z = positions[id * 3 + 2];
    return Math.min(x - Math.floor(x), Math.ceil(x) - x, z - Math.floor(z), Math.ceil(z) - z);
  }));
  if (maxDepth > worstWalkableWallDepth) { worstWalkableWallDepth = maxDepth; worstWalkableWallTile = tileKey; }
  if (maxDepth > 0.085) deeplyIntrudingTriangles++;
}

assert.ok(retainedSmoothedWallTriangles > 0, 'smooth sculpting must retain visible wall geometry at walkable boundaries');
assert.equal(deeplyIntrudingTriangles, 0, `smoothed wall geometry must stay in a shallow bevel at the walkable boundary (worst depth ${worstWalkableWallDepth.toFixed(4)} in ${worstWalkableWallTile})`);
console.log(`cavern walkability: ${result.claimed.size} tiles, ${result.walkableSculptFragmentsSmoothed} wall fragments smooth-sculpted, max wall depth ${worstWalkableWallDepth.toFixed(4)} tiles`);

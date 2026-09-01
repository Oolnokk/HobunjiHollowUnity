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
  result.walkableSpillFragmentsRemoved > 0,
  'the fixture must exercise removal of visual spill from walkable tiles',
);

const positions = result.mesh.positions;
const indices = result.mesh.indices;
let overheadTriangles = 0; // Counts visible overhang fragments still centered inside walkable tiles.
const visiblyBlockingHeight = 0.25; // Allows the sculpted floor's shallow edge bevel while rejecting overhead rock.
for (let q = 0; q < indices.length; q += 3) {
  const ids = [indices[q], indices[q + 1], indices[q + 2]];
  const centerX = ids.reduce((sum, id) => sum + positions[id * 3], 0) / 3;
  const centerZ = ids.reduce((sum, id) => sum + positions[id * 3 + 2], 0) / 3;
  const tileKey = `${Math.floor(centerX)},${Math.floor(centerZ)}`;
  if (!result.claimed.has(tileKey)) continue;
  const minY = Math.min(...ids.map(id => positions[id * 3 + 1]));
  if (minY > visiblyBlockingHeight + 1e-6) overheadTriangles++;
}

assert.equal(overheadTriangles, 0, 'walkable tiles must not render visually blocking overhang fragments');
console.log(`cavern walkability: ${result.claimed.size} tiles, ${result.walkableSpillFragmentsRemoved} spill fragments removed`);

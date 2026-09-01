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
assert.ok(result.walkableSculptVerticesMoved > 0, 'the sculpt pass must move welded wall vertices');
assert.ok(
  result.walkableSculptSharedTargets > 0,
  'the fixture must combine shared-vertex targets so adjacent wall fragments cannot split into cuts',
);

const positions = result.mesh.positions;
const indices = result.mesh.indices;
assert.ok(result.walkableSculptCutsSealed > 0, 'the fixture must exercise continuous patching of closed wall cuts');
assert.ok(
  result.walkableSculptMaxBevelDepth <= 0.085 + 1e-6,
  `moved sculpt vertices must remain in the shallow wall bevel (got ${result.walkableSculptMaxBevelDepth.toFixed(4)})`,
);

const edgeUse = new Map(); // Used to prove no high open wall edges survive inside a walkable tile.
for (let q = 0; q < indices.length; q += 3) {
  const ids = [indices[q], indices[q + 1], indices[q + 2]];
  for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
  }
}

let internalOpenWallEdges = 0; // Any nonzero result is a visible cut in the walkable-side wall surface.
for (const [key, uses] of edgeUse) {
  if (uses !== 1) continue;
  const [a, b] = key.split(',').map(Number);
  const x = (positions[a * 3] + positions[b * 3]) * 0.5;
  const y = (positions[a * 3 + 1] + positions[b * 3 + 1]) * 0.5;
  const z = (positions[a * 3 + 2] + positions[b * 3 + 2]) * 0.5;
  const tileKey = `${Math.floor(x)},${Math.floor(z)}`;
  const boundaryDepth = Math.min(x - Math.floor(x), Math.ceil(x) - x, z - Math.floor(z), Math.ceil(z) - z);
  if (result.claimed.has(tileKey) && y > 0.25 && boundaryDepth > 0.085) internalOpenWallEdges++;
}

assert.equal(internalOpenWallEdges, 0, 'walkable-side cave walls must contain no open internal cut edges');
console.log(`cavern walkability: ${result.claimed.size} tiles, ${result.walkableSculptFragmentsSmoothed} wall fragments, ${result.walkableSculptVerticesMoved} welded vertices, ${result.walkableSculptSharedTargets} shared targets, ${result.walkableSculptCutsSealed} cuts sealed, max bevel ${result.walkableSculptMaxBevelDepth.toFixed(4)} tiles`);

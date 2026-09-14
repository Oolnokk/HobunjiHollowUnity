'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');
const start = source.indexOf('function appendChunkGeometry');
const end = source.indexOf('function makeChunkMeshFromRange', start);
assert.ok(start >= 0 && end > start, 'appendChunkGeometry block must remain discoverable');
const append = source.slice(start, end);

assert.match(source, /function tileSurfaceCorners\(/, 'the authored walkable surface must be cached separately from the raised cap');
assert.match(source, /function walkableEdgeContinuous\(/, 'covered neighbors must split when their walkable edge elevations differ');
assert.match(source, /function addMicroPlateauTile\(/, 'micro plateau geometry must own its shallow inclined perimeter');
assert.match(source, /const axis = \[0, inset, 1 - inset, 1\]/, 'the incline must run inward so its base is exactly on the walkable tile edge');
assert.match(source, /baseAt\(u, v\) \+ SURFACE_DEPTH \* depthFactor\(u, v\)/, 'side height must derive only from this tile base plus shallow surface depth');
assert.match(append, /walkableEdgeContinuous\(state, col, row, side, dc, dr, baseCorners\)/, 'surface breaks must be detected from authored edge heights');
assert.doesNotMatch(source, /SURFACE_THICKNESS|addRoundedLip|oursMid|theirsMid/, 'no environment geometry may hang down toward a lower neighboring mesa');
assert.match(source, /version:\s*7/, 'surface overlay debug version must identify rooted inclines with whole-mass snow UVs');

console.log('Environment surface rooted-incline regression passed.');

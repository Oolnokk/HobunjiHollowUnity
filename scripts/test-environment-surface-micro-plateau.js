'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');

assert.match(source, /SNOW_THICKNESS = 0\.12/, 'micro-plateau snow must stay intentionally shallow');
assert.match(source, /TOP_CLEARANCE = 0\.018/, 'clean cap must clear sampled terrain peaks without becoming a tall second plateau');
assert.match(source, /return LAND_TYPES\.has\(type\) && !WATER_TYPES\.has\(type\)/, 'plateau-owned skipFloor tiles must still receive snow');
assert.doesNotMatch(source, /!tile\?\.skipFloor/, 'skipFloor must never suppress plateau/ramp snow coverage');
assert.match(source, /SCAN_BUDGET_MS = 0\.65/, 'terrain sampling must stay inside a sub-millisecond target slice');
assert.match(source, /SCAN_TRIANGLES_PER_SLICE = 480/, 'terrain sampling must retain a hard per-frame triangle cap');
assert.match(source, /CHUNK_TILES = 16/, 'snow output must be built in bounded tile chunks rather than one whole-zone mesh');
assert.match(source, /BUILD_CHUNKS_PER_FRAME = 1/, 'snow geometry creation must publish at most one chunk per frame');
assert.match(source, /scene\.updateMatrixWorld\?\.\(true\)/, 'source matrices must be updated once before snapshotting instead of once per mesh');
assert.match(source, /scene\?\.traverse\?\.\(node => \{ if \(node\?\.isMesh\) add\(node\); \}\)/, 'source discovery may traverse the scene once when the snapshot is taken');
assert.doesNotMatch(source, /setLegacyVisibility/, 'the micro renderer must never traverse the whole scene each frame to hide legacy snow');
assert.match(source, /source\.normal\.y < 0\.28/, 'steep cliff walls must not raise clean tile caps');
assert.match(source, /corners = \[top, top, top, top\]/, 'ordinary snow tiles must be perfectly flat regardless of source vertex crinkle');
assert.match(source, /rampCornerY/, 'ramps must preserve a clean authored slope instead of becoming random terrain facets');
assert.match(source, /tile-driven-shallow-plateau-v2/, 'generated root must expose the bounded replacement rendering mode');
assert.match(source, /MeshBasicMaterial/, 'micro snow must avoid an expensive whole-zone normal solve');
assert.match(source, /processedTriangles/, 'diagnostics must expose real scan progress even before any triangle is accepted');
assert.match(source, /builtChunks/, 'diagnostics must expose incremental geometry build progress');

console.log('Environment surface micro-plateau source checks passed.');

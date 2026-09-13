'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');

assert.match(source, /SNOW_THICKNESS = 0\.12/, 'micro-plateau snow must stay intentionally shallow');
assert.match(source, /TOP_CLEARANCE = 0\.018/, 'clean cap must clear the tile\'s own surface without becoming a tall second plateau');
assert.match(source, /return LAND_TYPES\.has\(type\) && !WATER_TYPES\.has\(type\)/, 'plateau-owned skipFloor tiles must still receive snow');
assert.doesNotMatch(source, /!tile\?\.skipFloor/, 'skipFloor must never suppress plateau/ramp snow coverage');
assert.doesNotMatch(source, /sourceCandidates|prepareSource|sampleTriangle|processScanSlice|SCAN_BUDGET_MS|SCAN_TRIANGLES_PER_SLICE/, 'v3 must not scan rendered terrain mesh triangles at all — height comes directly from grid data');
assert.match(source, /CHUNK_TILES = 16/, 'snow output must still be partitioned into chunk meshes for frustum culling');
assert.doesNotMatch(source, /BUILD_CHUNKS_PER_FRAME/, 'the whole zone must build in one synchronous pass, not spread across frames');
assert.match(source, /function buildZoneSnow\(/, 'must build the whole zone synchronously on entry, the same way the real plateau mesa builds without a performance problem');
assert.doesNotMatch(source, /setLegacyVisibility/, 'the micro renderer must never traverse the whole scene each frame to hide legacy snow');
assert.match(source, /corners = \[top, top, top, top\]/, 'ordinary snow tiles must be perfectly flat, derived from the tile\'s own logical height');
assert.match(source, /logicalSurfaceY\(tile\)/, 'flat tile height must come from tile.elevTier, not sampled mesh geometry');
assert.match(source, /rampCornerY/, 'ramps must preserve a clean authored slope instead of becoming random terrain facets');
assert.match(source, /tile-driven-shallow-plateau-v3/, 'generated root must expose the direct-grid-height rendering mode');
assert.match(source, /MeshBasicMaterial/, 'micro snow must avoid an expensive whole-zone normal solve');
assert.match(source, /isWildernessGrassChunkGroup|isRichFoliageBillboard/, 'grass-blade billboards under the snow cap must be hidden');
assert.match(source, /setGrassHidden\(grassHiddenScene, false\)/, 'grass visibility must be restored when leaving Western Slope');

console.log('Environment surface micro-plateau source checks passed.');

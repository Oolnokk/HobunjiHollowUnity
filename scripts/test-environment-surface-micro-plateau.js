'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');

assert.match(source, /const SURFACE_THICKNESS = /, 'surface depth must stay a single tunable constant shared by snow and slush');
assert.match(source, /const SURFACE_DEPTH = /, 'cap must sit a deliberate, tunable depth above the tile\'s own surface, not an arbitrary anti-z-fighting sliver');
assert.match(source, /return LAND_TYPES\.has\(type\) && !WATER_TYPES\.has\(type\)/, 'plateau-owned skipFloor tiles must still receive coverage');
assert.doesNotMatch(source, /!tile\?\.skipFloor/, 'skipFloor must never suppress plateau/ramp coverage');
assert.doesNotMatch(source, /sourceCandidates|prepareSource|sampleTriangle|processScanSlice|SCAN_BUDGET_MS|SCAN_TRIANGLES_PER_SLICE/, 'must not scan rendered terrain mesh triangles at all — height comes directly from grid data');
assert.match(source, /CHUNK_TILES = 16/, 'output must still be partitioned into chunk meshes for frustum culling');
assert.doesNotMatch(source, /BUILD_CHUNKS_PER_FRAME/, 'the whole zone must build in one synchronous pass, not spread across frames');
assert.match(source, /function buildZoneSurface\(/, 'must build the whole zone synchronously on entry, the same way the real plateau mesa builds without a performance problem');
assert.doesNotMatch(source, /setLegacyVisibility/, 'the micro renderer must never traverse the whole scene each frame to hide legacy snow');
assert.match(source, /corners = \[top, top, top, top\]/, 'ordinary tiles must be perfectly flat, derived from the tile\'s own logical height');
assert.match(source, /logicalSurfaceY\(tile\)/, 'flat tile height must come from tile.elevTier, not sampled mesh geometry');
assert.match(source, /rampCornerY/, 'ramps must preserve a clean authored slope instead of becoming random terrain facets');
assert.match(source, /MeshBasicMaterial/, 'surface material must avoid an expensive whole-zone normal solve');
assert.match(source, /isWildernessGrassChunkGroup|isRichFoliageBillboard/, 'grass-blade billboards under the surface cap must be hidden');
assert.match(source, /setGrassHidden\(grassHiddenScene, false\)/, 'grass visibility must be restored when leaving the surface\'s zone');
assert.match(source, /window\.HobunjiSurfaceStretchUV/, 'snow UV must stretch-map across the connected cap+lip surface like the real plateau mesa cliffs, not tile one texture square per tile');
assert.doesNotMatch(source, /uv\.push\(0,0, 1,0, 0,1, 1,1\)/, 'must not fall back to one naive 0-1 UV square per tile');

// v4: generalized to also cover seasonal Coldmuck slush on every outdoor
// zone, using the same mechanism as Western Slope snow, not the old
// triangle-scanning job-queue system this replaces in environment-surface-runtime.js.
assert.match(source, /MODE_PRESETS/, 'snow and slush must share one mode-driven preset table instead of separate implementations');
assert.match(source, /slush:\s*Object\.freeze\(\{[^}]*color:\s*0x000000/, 'slush must be black');
assert.match(source, /slush:\s*Object\.freeze\(\{[^}]*transparent:\s*true/, 'slush must be semi-transparent');
assert.match(source, /currentSeasonName\(\)\s*===\s*'Coldmuck'/, 'slush must only appear during the Coldmuck season');
assert.match(source, /function isOutdoorArea\(/, 'slush must be able to appear on any outdoor zone, not just Western Slope');
assert.match(source, /isWesternSlope\(area\)\)\s*return\s*'snow'/, 'Western Slope must always resolve to permanent snow regardless of season');

const runtime = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8');
assert.match(runtime, /retired/i, 'the old job-queue runtime must be retired now that micro-plateau owns both snow and slush');
assert.doesNotMatch(runtime, /processTopWorkSlice|processShellWorkSlice|queueTerrainMesh/, 'the old triangle-scanning job-queue machinery must actually be gone, not just disabled');

console.log('Environment surface micro-plateau source checks passed.');

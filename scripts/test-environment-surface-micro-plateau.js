'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('docs/js/environment-surface-micro-plateau.js', 'utf8');

assert.doesNotMatch(source, /const SURFACE_THICKNESS = /, 'micro plateaus must never extrude a deep independent wall below their supporting walkable surface');
assert.match(source, /const SURFACE_DEPTH = /, 'cap depth must stay a single shallow tunable shared by snow and slush');
assert.match(source, /const EDGE_WIDTH = /, 'inclined micro-plateau sides need a horizontal run inside the owning tile');
assert.match(source, /return LAND_TYPES\.has\(type\) && !WATER_TYPES\.has\(type\)/, 'plateau-owned skipFloor tiles must still receive coverage');
assert.doesNotMatch(source, /!tile\?\.skipFloor/, 'skipFloor must never suppress plateau/ramp coverage');
assert.doesNotMatch(source, /sourceCandidates|prepareSource|sampleTriangle|processScanSlice|SCAN_BUDGET_MS|SCAN_TRIANGLES_PER_SLICE/, 'must not scan rendered terrain mesh triangles at all — height comes directly from grid data');
assert.match(source, /CHUNK_TILES = 16/, 'output must still be partitioned into chunk meshes for frustum culling');
assert.doesNotMatch(source, /BUILD_CHUNKS_PER_FRAME/, 'the whole zone must build in one synchronous pass, not spread across frames');
assert.match(source, /function buildZoneSurface\(/, 'must build the whole zone synchronously on entry');
assert.doesNotMatch(source, /setLegacyVisibility/, 'the micro renderer must never traverse the whole scene each frame to hide legacy snow');
assert.match(source, /function tileSurfaceCorners\(/, 'micro plateaus must preserve the authored walkable surface as their immutable base');
assert.match(source, /corners = \[surface, surface, surface, surface\]/, 'ordinary tile bases must stay flat at their own authored walkable elevation');
assert.match(source, /logicalSurfaceY\(tile\)/, 'flat tile height must come from tile.elevTier, not sampled mesh geometry');
assert.match(source, /rampCornerY/, 'ramps must preserve authored sloped base corners');
assert.match(source, /function walkableEdgeContinuous\(/, 'covered neighbors may join only when their authored edge heights match');
assert.match(source, /function addMicroPlateauTile\(/, 'each tile must build a rooted micro plateau rather than a hanging wall');
assert.match(source, /const axis = \[0, inset, 1 - inset, 1\]/, 'inclined perimeter must live inside the tile and terminate exactly at its edge');
assert.match(source, /baseAt\(u, v\) \+ SURFACE_DEPTH \* depthFactor\(u, v\)/, 'micro-plateau height must be this tile base plus shallow cap depth only');
assert.doesNotMatch(source, /addRoundedLip|oursMid|theirsMid/, 'surface geometry must not extrude toward a neighboring lower mesa');
assert.match(source, /MeshBasicMaterial/, 'surface material must avoid an expensive whole-zone normal solve');
assert.match(source, /isWildernessGrassChunkGroup|isRichFoliageBillboard/, 'grass-blade billboards under the surface cap must be hidden');
assert.match(source, /setGrassHidden\(grassHiddenScene, false\)/, 'grass visibility must be restored when leaving the surface zone');
assert.match(source, /window\.HobunjiSurfaceStretchUV/, 'snow UV must stretch-map across connected micro-plateau surfaces');
assert.match(source, /angleToleranceDeg:\s*89/, 'snow stretch mapping must keep the flat cap and rooted micro-inclines in one connected UV mass');
assert.match(source, /mode === 'snow' \? stretchMapSnowUv\(combined, 'zone'\) : planarFallbackUv\(combined\)/, 'only snow uses connected stretch-to-fit UVs; slush must keep planar mapping');
assert.doesNotMatch(source, /uv\.push\(0,0, 1,0, 0,1, 1,1\)/, 'must not fall back to one naive 0-1 UV square per tile');

assert.match(source, /MODE_PRESETS/, 'snow and slush must share one mode-driven preset table');
assert.match(source, /slush:\s*Object\.freeze\(\{[^}]*color:\s*0x000000/, 'slush must be black');
assert.match(source, /slush:\s*Object\.freeze\(\{[^}]*transparent:\s*true/, 'slush must be semi-transparent');
assert.match(source, /currentSeasonName\(\)\s*===\s*'Coldmuck'/, 'slush must only appear during Coldmuck');
assert.match(source, /function isOutdoorArea\(/, 'slush must be able to appear on any outdoor zone');
assert.match(source, /function isInteriorArea\(area\)\s*\{\s*return area\.startsWith\('map_i_'\);\s*\}/, 'generated building and cavern map_i_ maps must be classified as interiors');
assert.match(source, /if \(isInteriorArea\(area\)\) return 'none';/, 'interiors must resolve to no environment surface before zone-name checks');
assert.match(source, /return area === WESTERN_SLOPE_ID;/, 'only the exterior Western Slope map itself may resolve as the permanent snow zone');
assert.doesNotMatch(source, /area\.includes\('western_slope'\)/, 'a den cavern id containing its parent western_slope name must never inherit outdoor snow');
assert.match(source, /area\.startsWith\('map_'\) && !isInteriorArea\(area\)/, 'seasonal slush must also exclude every map_i_ interior');
assert.match(source, /isWesternSlope\(area\)\)\s*return\s*'snow'/, 'Western Slope exterior must always resolve to permanent snow');
assert.match(source, /version:\s*7/, 'debug version must identify whole-mass snow stretch mapping');

const runtime = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8');
assert.match(runtime, /retired/i, 'the old job-queue runtime must remain retired');
assert.doesNotMatch(runtime, /processTopWorkSlice|processShellWorkSlice|queueTerrainMesh/, 'the old triangle-scanning machinery must stay gone');

console.log('Environment surface micro-plateau source checks passed.');

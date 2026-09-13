'use strict';

const fs = require('fs');
const assert = require('assert');

const runtime = fs.readFileSync('docs/js/environment-surface-runtime.js', 'utf8');
const rain = fs.readFileSync('docs/js/rain-planes.js', 'utf8');
const hub = fs.readFileSync('docs/tools/index.html', 'utf8');

assert.match(runtime, /__installedV4/, 'environment surface runtime must use the post-spatial-split v4 path');
assert.match(runtime, /const WESTERN_SLOPE_ID = 'map_western_slope'/, 'Western Slope policy must remain explicit');
assert.match(runtime, /return currentSeasonName\(\) === 'Coldmuck' \? 'slush' : 'none'/, 'Coldmuck must drive slush outside Western Slope');
assert.match(runtime, /height: 0\.275/, 'Western snow height must remain half of the original 0.55');
assert.match(runtime, /const range = elementRange\(geometry\)/, 'surface extraction must honor geometry drawRange');
assert.match(runtime, /WORK_BUDGET_MS = 1\.25/, 'surface generation must remain tightly time-budgeted');
assert.match(runtime, /MAX_TRIANGLES_PER_SLICE = 160/, 'triangle work must retain a hard per-frame cap');
assert.match(runtime, /terrainRenderChunkSource === true/, 'runtime must discover renderer spatial chunks created after initial scene seeding');
assert.match(runtime, /terrainRenderChunk !== true/, 'renderer discovery must filter specifically to generated spatial chunk children');
assert.match(runtime, /LARGE_TERRAIN_TRIANGLES = 60000/, 'giant terrain sources must defer to the renderer chunk split rather than duplicate full-zone snow work');
assert.match(runtime, /TerrainRenderChunks\?\.installed/, 'large-source deferral must only happen when the renderer spatial splitter is actually installed');
assert.match(runtime, /activeJob\?\.owner === mesh && activeJob\.signature === signature/, 'active source jobs must not be rediscovered and queued again mid-build');
assert.match(runtime, /assets\/textures\/canvas\.png/, 'snow tops must use the canvas PNG');
assert.match(runtime, /rgb: \[255, 255, 255\]/, 'canvas PNG must be shade-filled white');
assert.match(runtime, /HobunjiSurfaceStretchUV/, 'small snow surfaces must reuse the farm\/furniture irregular stretch mapper');
assert.match(runtime, /PROTECTED_SOURCE_EDGE = 0\.16/, 'snow fallback must preserve the same source edge fraction as the farm perimeter frame');
assert.match(runtime, /PROTECTED_SURFACE_EDGE = 0\.06/, 'snow fallback must compress the protected image edge into the same narrow surface band');
assert.doesNotMatch(runtime, /pseudoNoise|snowLayerBulge|snowLayers/, 'snow tops must stay flat instead of reintroducing procedural lump displacement');
assert.match(runtime, /job\.topA\.set\(job\.a\.x, job\.a\.y \+ height, job\.a\.z\)/, 'snow top must use one constant vertical offset');
assert.match(runtime, /globalBoundaryStates/, 'continuous masses must share one cross-owner boundary registry');
assert.match(runtime, /state\.owners\.size !== 1/, 'only globally unmatched mass-perimeter edges may receive a shell');
assert.match(runtime, /SHELL_OUTLINE_LAYER = 1/, 'mass perimeter must use the game shell-outline render layer');
assert.match(runtime, /mesh\.layers\.enable\(SHELL_OUTLINE_LAYER\)/, 'continuous-mass shell must opt into the real inverted-hull outline pass');
assert.match(runtime, /Math\.sin\(t \* Math\.PI\)/, 'edge curve must return its horizontal offset to zero at the surface tile');
assert.match(runtime, /record\.topAY \+ \(record\.ay - record\.topAY\) \* verticalT/, 'edge curve must finish exactly at source-surface height regardless snow scaling');
assert.doesNotMatch(runtime, /edgeDrop:/, 'a fixed edge-drop constant must not be able to leave scaled snow floating above the source tile');
assert.match(runtime, /if \(key\) return key === 'grass'/, 'Coldmuck slush must remain localized to grass');
assert.match(runtime, /LAND_TARGETS\.has\(key\)/, 'Western snow must cover the authored exposed-land target set');
assert.match(runtime, /lastSliceMs/, 'runtime must expose per-frame hitch diagnostics');
assert.match(runtime, /snowTextureState/, 'runtime must expose snow texture load\/tint state');
assert.match(rain, /environment-surface-runtime\.js\?v=20260912a/, 'rain bootstrap must synchronously load the environment runtime before game boot');
assert.match(hub, /data-target="wilderness-generation-lab"/, 'main tool hub must expose the Wilderness + Surface Lab');

console.log('Environment surface runtime regression checks passed.');

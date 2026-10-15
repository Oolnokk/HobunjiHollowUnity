'use strict';

const assert = require('node:assert/strict'); // Assertion API used for source-contract checks below.
const fs = require('node:fs'); // File reader used to inspect the shipped runtime/tool modules.
const path = require('node:path'); // Path helper used to resolve repository-relative module locations.

const repoRoot = path.resolve(__dirname, '..'); // Repository root used by every source read in this test.
const naturalSource = fs.readFileSync(path.join(repoRoot, 'docs/js/natural-surface-materials.js'), 'utf8'); // Actual in-game tree PNG surface authority the wall path must follow.
const woodSource = fs.readFileSync(path.join(repoRoot, 'docs/js/wood-cut-surfaces.js'), 'utf8'); // Shared stump/log/cut-face repair and texture authority.
const materialSource = fs.readFileSync(path.join(repoRoot, 'docs/js/log-wall-materials.js'), 'utf8'); // Single-primitive tree-PNG/cut-cap log bridge under test.
const toolSource = fs.readFileSync(path.join(repoRoot, 'docs/js/wall-builder-log-tool.js'), 'utf8'); // Export tool checked for texture readiness before GLB serialization.
const formatUtilsSource = fs.readFileSync(path.join(repoRoot, 'docs/js/format-utils.js'), 'utf8'); // Main-game loader checked for base -> wood -> atlas ordering.
const panelUiSource = fs.readFileSync(path.join(repoRoot, 'docs/js/panel-ui.js'), 'utf8'); // Wall Builder loader checked for base -> wood -> atlas -> tool ordering.

assert.match(naturalSource, /trunks:\s*\{[^}]*texture:\s*'assets\/textures\/wavy_surface\.png'/, 'in-game tree trunks must still use wavy_surface.png');
assert.match(naturalSource, /tintTreatment:\s*'body-sprite-tint'/, 'tree PNG bark must retain body-sprite tint treatment');
assert.match(woodSource, /wavy_surface\.png/, 'shared wood repair must use the same authored PNG as in-game tree bark');
assert.match(woodSource, /log\.png/, 'shared wood repair must use the authored log PNG for cut faces');
assert.match(woodSource, /new THREE\.MeshBasicMaterial\(\{ map, color: 0xffffff, side: THREE\.DoubleSide \}\)/, 'cut faces must be real double-sided textured geometry rather than exposing backfaces');
assert.match(woodSource, /boundaryLoops\(THREE, mesh\.geometry\)/, 'fallen logs/stumps must detect true open geometry boundaries for cap generation');
assert.match(woodSource, /repairFurnitureInstance/, 'V27-authored wilderness stump/log instances must be repaired after generation');
assert.match(woodSource, /buildStumpMesh = function/, 'direct procedural stump generation must receive the same shared cap repair');

assert.match(materialSource, /remapLogAtlasUv/, 'log walls must remap bark/cap UVs into a single material atlas');
assert.match(materialSource, /makeLogAtlasMaterial/, 'log walls must use the shared wavy_surface.png + log.png atlas material');
assert.match(materialSource, /singlePrimitiveGlb/, 'wall log material bridge must preserve bark and cut caps inside one GLB primitive');
assert.doesNotMatch(materialSource, /MeshStandardMaterial/, 'log walls must not fall back to the previous flat tree-colored material approximation');
assert.match(toolSource, /LogWallMaterials\.waitForTextures/, 'GLB export must wait for the authored PNG atlas to decode before serialization');
assert.match(toolSource, /wavy_surface\.png/, 'Wall Builder UI must surface the actual tree bark PNG being used');
assert.match(toolSource, /log\.png/, 'Wall Builder UI must surface the actual cut-wood PNG being used');

assert.match(formatUtilsSource, /log-wall-extension\.js\?v=[A-Za-z0-9_-]+[\s\S]*wood-cut-surfaces\.js\?v=[A-Za-z0-9_-]+[\s\S]*log-wall-materials\.js\?v=[A-Za-z0-9_-]+/, 'main game must load base log geometry, shared wood repair, then PNG atlas materials');
assert.match(panelUiSource, /log-wall-extension\.js\?v=[A-Za-z0-9_-]+[\s\S]*wood-cut-surfaces\.js\?v=[A-Za-z0-9_-]+[\s\S]*log-wall-materials\.js\?v=[A-Za-z0-9_-]+[\s\S]*wall-builder-log-tool\.js\?v=[A-Za-z0-9_-]+/, 'Wall Builder must load base log geometry, shared wood repair, PNG atlas, then authoring UI');

console.log('log wall tree PNG/cap tests passed');

'use strict';

const assert = require('node:assert/strict'); // Assertion API used for source-contract checks below.
const fs = require('node:fs'); // File reader used to inspect the shipped runtime/tool modules.
const path = require('node:path'); // Path helper used to resolve repository-relative module locations.

const repoRoot = path.resolve(__dirname, '..'); // Repository root used by every source read in this test.
const foliageSource = fs.readFileSync(path.join(repoRoot, 'docs/js/foliage-generator.js'), 'utf8'); // Tree material authority whose bark response the log bridge must match.
const materialSource = fs.readFileSync(path.join(repoRoot, 'docs/js/log-wall-materials.js'), 'utf8'); // New shared tree-material/cut-cap log bridge under test.
const formatUtilsSource = fs.readFileSync(path.join(repoRoot, 'docs/js/format-utils.js'), 'utf8'); // Main-game loader checked for base -> material ordering.
const panelUiSource = fs.readFileSync(path.join(repoRoot, 'docs/js/panel-ui.js'), 'utf8'); // Wall Builder loader checked for base -> material -> tool ordering.

assert.match(foliageSource, /const BARK_EMISSIVE_FLOOR = 0\.3;/, 'tree foliage bark must retain the 30% emissive floor contract');
assert.match(foliageSource, /new T\.MeshLambertMaterial\(\{ color: col, emissive: col\.clone\(\)\.multiplyScalar\(BARK_EMISSIVE_FLOOR\) \}\)/, 'procedural trees must still define bark color + emissive from the same base color');

assert.match(materialSource, /const BARK_EMISSIVE_FLOOR = 0\.3;/, 'log wall bark must use the same emissive floor as trees');
assert.match(materialSource, /new THREE\.MeshStandardMaterial\(/, 'log wood must use the export-stable material form used by baked in-game tree assets');
assert.match(materialSource, /metalness:\s*0/, 'log wood must remain fully non-metallic like baked tree bark');
assert.match(materialSource, /roughness:\s*1/, 'log wood must remain fully rough like baked tree bark');
assert.match(materialSource, /geometry\.addGroup\(0, sideIndexCount, 0\)/, 'tube sides must use bark material slot 0');
assert.match(materialSource, /geometry\.addGroup\(sideIndexCount, capIndexCount, 1\)/, 'both end caps must use cut-wood material slot 1');
assert.match(materialSource, /'Cut Wood', 'cutWood'/, 'fresh-cut cap material must be named and tagged distinctly from bark');
assert.match(materialSource, /cutWoodColor\(THREE, barkColor\)/, 'cut wood color must derive from the authored bark color rather than using an unrelated fixed swatch');
assert.match(materialSource, /treeWoodMaterials:\s*true/, 'generated cache entries must identify the upgraded tree-material prototype');
assert.match(materialSource, /prototype\.prepareLogWallRecipe = function/, 'eager generated-model preparation must be intercepted before the old single-material cache can win');
assert.match(materialSource, /prototype\.build = function/, 'runtime builds must replace any stale generated prototype before placement/instancing');

assert.match(formatUtilsSource, /log-wall-extension\.js\?v=[A-Za-z0-9_-]+[\s\S]*log-wall-materials\.js\?v=[A-Za-z0-9_-]+/, 'main game must load tree materials after the base log extension');
assert.match(panelUiSource, /log-wall-extension\.js\?v=[A-Za-z0-9_-]+[\s\S]*log-wall-materials\.js\?v=[A-Za-z0-9_-]+[\s\S]*wall-builder-log-tool\.js\?v=[A-Za-z0-9_-]+/, 'Wall Builder must load base log geometry, then tree materials, then authoring UI');

console.log('log wall tree material tests passed');

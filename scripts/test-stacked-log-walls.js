
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const stackedSource = read('docs/js/stacked-log-walls.js');
const foliageSource = read('docs/js/foliage-generator.js');
const logExtensionSource = read('docs/js/log-wall-extension.js');
const houseSource = read('docs/js/HousePieceGen.js');
const interiorSource = read('docs/js/interior-scene-builder.js');
const ceilingsSource = read('docs/js/interior-ceilings.js');
const houseEditorSource = read('docs/tools/house-piece-author/index.html');
const interiorEditorSource = read('docs/tools/building-interior-author/index.html');
const formatSource = read('docs/js/format-utils.js');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(stackedSource, context, { filename: 'stacked-log-walls.js' });
const api = context.StackedLogWalls;
assert(api, 'StackedLogWalls publishes its shared runtime API');
assert.equal(api.DEFAULTS.barkColor, '#372f18', 'stacked architecture default bark color matches the approved dark-olive swatch');

const triangle = [[0, 0, 0], [4, 0, 0], [2, 2, 0], [2, 2, 0]];
assert.equal(api.horizontalSpanAtY(triangle, 0.5).length, 3, 'gable course at y=.5 shortens from 4 to 3 world units');
assert.equal(api.horizontalSpanAtY(triangle, 1).length, 2, 'gable course at y=1 shortens to 2 world units');
assert.equal(api.horizontalSpanAtY(triangle, 1.5).length, 1, 'gable course near the ridge shortens to 1 world unit');

assert.match(foliageSource, /function buildGeneratedLogMesh\(options = \{\}\)/, 'FoliageGenerator owns a public arbitrary-length log builder');
assert.match(foliageSource, /const chain = buildWonkyChain\(/, 'generated architectural logs route through the existing real foliage spine implementation');
assert.match(foliageSource, /buildLogMesh\(options\)/, 'FoliageGenerator publishes buildLogMesh');
assert.match(foliageSource, /targetX = -length \* 0\.5 \+ length \* t01/, 'foliage logs lock their source spine to the requested final axial length');
assert.match(stackedSource, /foliage\.buildLogMesh\(/, 'stacked walls ask FoliageGenerator for each source log');
assert.match(stackedSource, /mesh\.scale\.set\(1, 1, 1\)/, 'stacked wall placement never length-scales generated source geometry');
assert.doesNotMatch(stackedSource, /GLTFLoader|loadGlb|glbName/, 'stacked architecture has no baked-GLB dependency');
assert.match(stackedSource, /visibleSegmentsAroundOpenings/, 'stacked logs split real source geometry around wall openings');
assert.match(stackedSource, /Math\.ceil\(panelHeight \/ nominalPitch\)/, 'short gables choose enough rows that course spacing never becomes looser than the authored pitch');
assert.match(stackedSource, /EDGE_SPAN_RECLAIM = 0\.8/, 'gable edge fill reclaims most of the overly conservative full-diameter slope inset');
assert.match(stackedSource, /meta\.logDiameter \* 0\.2/, 'narrow ridge courses are retained instead of being dropped at the old wide-span threshold');
assert.match(stackedSource, /leftOverhang = touchesLeftWallEnd \? meta\.overhang : 0/, 'outside overhang is not allowed to extend a log into a window or door opening');
assert.match(logExtensionSource, /FoliageGenerator[\s\S]{0,1000}buildLogMesh/, 'legacy live log-wall prototype delegates to FoliageGenerator when available');

assert.match(houseSource, /generatedLogStyle[\s\S]{0,1800}StackedLogWalls\.buildGroup/, 'generated Highland structure walls use stacked foliage logs');
assert.match(houseSource, /excludeQuads: openingQuads/, 'generated exterior log walls inherit the same window and door cuts as brick walls');
assert.match(houseSource, /authoredWallStyle[\s\S]{0,3000}generatedLogMode/, 'authored house pieces persist/select generated log construction');
assert.match(interiorSource, /generatedLogStyle[\s\S]{0,1600}StackedLogWalls\.buildGroup/, 'interior base walls use the same generated log renderer');
assert.match(ceilingsSource, /function gableLogPanels\(gables, wallHeight\)/, 'interior gables are converted to explicit triangle wall polygons');
assert.match(ceilingsSource, /gableLogPanels\(data\.gables, data\.wallHeight\)/, 'interior gable triangles feed the same exact-span generated log renderer');
assert.match(ceilingsSource, /excludeQuads: options\.wallBuildOptions\?\.excludeQuads \|\| \[\]/, 'interior log gables inherit authored window and door cuts');

assert.match(houseEditorSource, /<option value="logs">Stacked generated logs<\/option>/, 'House Editor exposes stacked generated logs as a wall construction choice');
assert.match(houseEditorSource, /state\.piece\.wallStyle=.*wallStyle/, 'House Editor serializes the wall construction choice');
assert.match(houseEditorSource, /state\.piece\.logWall=/, 'House Editor serializes log diameter/wonk/gap settings');
assert.match(interiorEditorSource, /<option value="logs">Stacked generated logs<\/option>/, 'Building Interior Editor exposes stacked generated logs');
assert.match(interiorEditorSource, /state\.interior\.logWall=/, 'Building Interior Editor serializes log settings');
assert.match(interiorEditorSource, /logWall:interior\.logWall/, 'Interior preview passes authored log settings through shared runtime builders');
assert.match(formatSource, /stacked-log-walls\.js/, 'main game bootstrap loads the shared exact-span stacked-log renderer');

console.log('stacked log wall integration regression checks passed');

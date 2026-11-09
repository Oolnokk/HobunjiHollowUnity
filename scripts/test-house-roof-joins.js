'use strict';

// Regression coverage for the modular farmhouse roof/wall join system.
// Run with: node scripts/test-house-roof-joins.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const core = read('docs/js/house-pieces-core.js');
const generator = read('docs/js/HousePieceGen.js');
const loader = read('docs/js/house-pieces.js');
const indexHtml = read('docs/index.html');

// Execute the actual pure roof/adjacency helpers from the production module,
// rather than maintaining a second copy of their joining rules in this test.
const roofStart = core.indexOf('  function _rectAdjacency(');
const roofEnd = core.indexOf('  function getExteriorRenderRect(', roofStart);
const sharedStart = core.indexOf('  function _sharedWallCutsFor(', roofEnd);
const sharedEnd = core.indexOf('  function _partialExtensionRect(', sharedStart);
const crossStart = core.indexOf('  function _crossGableConnections(', sharedEnd);
const crossEnd = core.indexOf('  function _crossGablePiece(', crossStart);
assert(roofStart >= 0 && roofEnd > roofStart, 'roof helper range is present');
assert(sharedStart >= 0 && sharedEnd > sharedStart, 'shared-wall helper range is present');
assert(crossStart >= 0 && crossEnd > crossStart, 'cross-gable helper range is present');

const helpers = vm.runInNewContext(`(() => {
  ${core.slice(roofStart, roofEnd)}
  ${core.slice(sharedStart, sharedEnd)}
  ${core.slice(crossStart, crossEnd)}
  return {
    _roofAxisDecision,
    _sameDirectionExtensions,
    _renderRectFor,
    _crossGableConnections,
    _sharedWallCutsFor,
  };
})()`);

// Same-ridge extension still joins the smaller neighboring roof, but the
// helper does not mutate the actual room footprint used by doors and walls.
const mainRoom = { id: 'main', col: 0, row: 0, w: 4, h: 3, roofAxis: 'x' };
const eastWing = { id: 'wing', col: 4, row: 1, w: 3, h: 1, roofAxis: 'x' };
const pair = [mainRoom, eastWing];
const extensions = helpers._sameDirectionExtensions(pair);
assert.equal(extensions.length, 1, 'same-axis neighbors still receive one directed roof extension');
assert.equal(extensions[0].sourceId, 'wing', 'the smaller room supplies the joining roof extension');
assert.equal(helpers._roofAxisDecision(mainRoom, pair), 'x', 'pinned ridge direction remains authoritative');
const roofRect = helpers._renderRectFor(eastWing, extensions);
assert.equal(roofRect.col, 3, 'roof overhang reaches one tile into the host');
assert.equal(roofRect.row, 1);
assert.equal(roofRect.w, 4);
assert.equal(roofRect.h, 1);
assert.equal(eastWing.col, 4, 'roof extension never moves the actual room origin');
assert.equal(eastWing.w, 3, 'roof extension never changes the actual room width');

// Shared wall clipping uses the real room footprint and clips only the
// overlapping portion, including the full body/gable height.
const mainCuts = helpers._sharedWallCutsFor(mainRoom, pair);
assert.equal(mainCuts.length, 1);
assert.equal(mainCuts[0].side, 'east');
assert.equal(mainCuts[0].worldStart, 1);
assert.equal(mainCuts[0].worldEnd, 2);
assert.equal(mainCuts[0].vCenter, 0.5);
assert.match(generator, /\(Number\(opening\.worldStart\) - v0Coord\) \/ edgeSpan/, 'shared boundary is projected onto each wall/gable face in world coordinates');
assert.equal(mainCuts[0].vHeight, 1);
assert.equal(mainCuts[0].kind, 'internal');

// Exercise the actual production wall-clipping function against a full-size
// body wall and its inset gable end. The two surviving sections must land on
// exactly the same world-space shared interval boundary despite different
// face widths.
const cutStart = generator.indexOf('  function _lerp3(');
const cutEnd = generator.indexOf('  function cutDoorPortal(', cutStart);
assert(cutStart >= 0 && cutEnd > cutStart, 'wall opening helpers are present');
const cutOpenings = vm.runInNewContext(`(() => {
  ${generator.slice(cutStart, cutEnd)}
  return _cutFacesForOpenings;
})()`);
const bodyWall = {
  id: 'body-east', tag: 'wall', highlandFrustumWall: true, wallSide: 'east',
  v: [[4, 0, 0], [4, 1.4, 0], [4, 1.4, 3], [4, 0, 3]],
};
const insetGable = {
  id: 'gable-east', tag: 'wall', gableEnd: true, wallSide: 'east',
  v: [[3.4, 1.4, 0.225], [3.4, 2.58, 0.225], [3.4, 2.58, 2.775], [3.4, 1.4, 2.775]],
};
const sharedCutFaces = cutOpenings([bodyWall, insetGable], [{
  side: 'east', worldStart: 1, worldEnd: 2, vCenter: 0.5, vHeight: 1, kind: 'internal',
}]);
const zRanges = id => sharedCutFaces.filter(face => String(face.id).startsWith(id + ':opening:'))
  .map(face => [Math.min(...face.v.map(point => point[2])), Math.max(...face.v.map(point => point[2]))])
  .sort((a, b) => a[0] - b[0]);
const bodyRanges = zRanges('body-east');
const gableRanges = zRanges('gable-east');
assert.equal(bodyRanges.length, 2, 'shared wall leaves two exterior body runs');
assert.equal(gableRanges.length, 2, 'shared wall leaves two exterior gable runs');
assert.ok(Math.abs(bodyRanges[0][1] - 1) < 1e-9 && Math.abs(gableRanges[0][1] - 1) < 1e-9,
  'both body and inset gable end exactly at the shared interval start');
assert.ok(Math.abs(bodyRanges[1][0] - 2) < 1e-9 && Math.abs(gableRanges[1][0] - 2) < 1e-9,
  'both body and inset gable restart exactly at the shared interval end');

// A real doorway must cut the body face but must never cut the room's gable.
const doorCutFaces = cutOpenings([bodyWall, insetGable], [{
  side: 'east', uCenter: 0.5, uWidth: 1 / 3, vCenter: 0.46, vHeight: 0.92, kind: 'door',
}]);
assert.ok(doorCutFaces.includes(insetGable), 'door apertures do not remove the gable face');

// Perpendicular ridge joins continue the smaller gable to the host ridge.
const crossSource = { id: 'cross-source', col: 0, row: 1, w: 4, h: 2, roofAxis: 'x' };
const crossHost = { id: 'cross-host', col: 4, row: 0, w: 2, h: 4, roofAxis: 'z' };
const cross = helpers._crossGableConnections([crossSource, crossHost]);
assert.equal(cross.length, 1, 'perpendicular roof connection remains available');
assert.equal(cross[0].sourceId, 'cross-source');
assert.equal(cross[0].hostId, 'cross-host');
assert.equal(cross[0].boundary, 4);
assert.equal(cross[0].target, 5);

// The live generator has separate wall and roof-only build modes. Roof
// extensions and partial bridge proxies therefore cannot create extra walls.
assert.match(generator, /if \(!opts\.roofOnly\) _addFrustumBody/);
assert.match(generator, /if \(opts\.roofOnly\) faces = faces\.filter\(function \(f\) \{ return f\.tag === 'roof' \|\| f\.roofRidgeCap; \}\)/);
assert.match(generator, /else if \(opts\.bodyOnly\) faces = faces\.filter/);
assert.match(generator, /wallSide: 'north'/);
assert.match(generator, /wallSide: 'east'/);
assert.match(generator, /wallSide: 'south'/);
assert.match(generator, /wallSide: 'west'/);
assert.match(generator, /f\.highlandFrustumWall \|\| \(f\.gableEnd && f\.wallSide\)/, 'only generated side-tagged gables join shared-wall clipping');
assert.match(core, /housePieceRoofOnly = true/, 'roof group is explicitly identified as roof-only');

// Door/window cuts remain on body walls; shared-boundary cuts also remove
// gable portions. Every opening becomes a brick exclusion quad to prevent
// wall cladding from jittering back across a doorway.
assert.match(generator, /!f\.gableEnd \|\| opening\.kind === 'internal'/);
assert.match(generator, /Every aperture is also a WallBuilder exclusion zone/);
assert.match(generator, /excludeQuads: \(gableExtra\.excludeQuads \|\| \[\]\)\.concat\(openingQuads\)/);

// Runtime creates room walls from the real footprint and adds only the
// extended roof as a separate child; entrances/windows are measured there.
assert.match(core, /bodyOnly: true/);
assert.match(core, /roofOnly: true/);
assert.match(core, /const roofRect = _renderRectFor\(entry, exts\)/);
assert.match(core, /HousePieceGen\.buildGroup\(THREE, wallRect\.col/);
assert.match(core, /idx: .*col - wallRect\.col/);
assert.match(core, /len: .*wallRect\.w : wallRect\.h/);
assert.match(core, /function _sharedWallCutsFor\(entry, all\)/);
assert.match(core, /wallCuts: _sharedWallCutsFor\(entry, built\)/);
assert.match(core, /roofOnly: true,[\s\S]{0,200}axisOverride: e\.axis/);

// Force fresh production scripts in the player's page and nested loader.
assert.match(indexHtml, /HousePieceGen\.js\?v=[A-Za-z0-9_-]+/);
assert.match(loader, /house-pieces-core\.js\?v=[A-Za-z0-9_-]+/);
assert.match(indexHtml, /house-pieces\.js\?v=[A-Za-z0-9_-]+/);

console.log('House roof joins: PASS (same-ridge, cross-gable, shared walls, doors, and cache busts)');

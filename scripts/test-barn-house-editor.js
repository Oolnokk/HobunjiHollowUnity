#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const farmBuildingsSource = fs.readFileSync('docs/js/farm-buildings.js', 'utf8');
const editorSource = fs.readFileSync('docs/tools/house-piece-author/index.html', 'utf8');

const expectedBarns = {
  small:  { path: 'docs/config/pieces/barn-small.json',  w: 4, h: 3 },
  medium: { path: 'docs/config/pieces/barn-medium.json', w: 4, h: 5 },
  large:  { path: 'docs/config/pieces/barn-large.json',  w: 6, h: 5 },
};

for (const [tier, expected] of Object.entries(expectedBarns)) {
  const piece = JSON.parse(fs.readFileSync(expected.path, 'utf8'));
  const cells = piece.footprint.cells;
  const xs = cells.map(cell => cell.x);
  const ys = cells.map(cell => cell.y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  assert.equal(w, expected.w, `${tier} barn authored footprint width is ${expected.w}`);
  assert.equal(h, expected.h, `${tier} barn authored footprint height is ${expected.h}`);

  const entries = piece.footprint.extensions.entryTunnels;
  assert.equal(entries.length, 2, `${tier} barn keeps the supplied two-tile entrance marker`);
  const manhattan = Math.abs(entries[0].x - entries[1].x) + Math.abs(entries[0].y - entries[1].y);
  assert.equal(manhattan, 1, `${tier} barn entrance markers are adjacent and therefore mergeable`);
  assert.equal(piece.base.faces.some(face => face.tag === 'entryTunnel'), false,
    `${tier} barn source does not retain the old incorrectly baked one-wide tunnel faces`);
}

assert.match(farmBuildingsSource, /small:\s*\{ file: 'config\/pieces\/barn-small\.json',\s*w: 4, h: 3 \}/,
  'Small barn uses its own 4x3 piece and placement footprint');
assert.match(farmBuildingsSource, /medium:\s*\{ file: 'config\/pieces\/barn-medium\.json',\s*w: 4, h: 5 \}/,
  'Medium barn uses its own 4x5 piece and placement footprint');
assert.match(farmBuildingsSource, /large:\s*\{ file: 'config\/pieces\/barn-large\.json',\s*w: 6, h: 5 \}/,
  'Large barn uses its own 6x5 piece and placement footprint');
assert.match(farmBuildingsSource, /entry\.w = def\.w; entry\.h = def\.h;/,
  'older saved barns migrate from the retired universal footprint to the selected tier footprint');
assert.match(farmBuildingsSource, /Promise\.all\(\[\s*deps\.houseWallBuilder\.loadDefaultGlb\(\),\s*HousePieceGen\.loadShingleGlb\('assets\/models\/'\)/,
  'farm structure rebuild waits for both real brick and shingle templates');
assert.match(farmBuildingsSource, /window\.HousePieces\?\.rebuildStructureMeshes\?\.\(\)/,
  'the player house is rebuilt after the real brick template becomes available');
assert.match(farmBuildingsSource, /continuousMultiTileOpening:run\.cells\.length>1/,
  'runtime barn preparation marks adjacent entry markers as one multi-tile mouth');

assert.match(editorSource, /id="toolTallEntryTunnel"/, 'House Editor exposes the 150% tall entry-tunnel tool');
assert.match(editorSource, /tallEntryTunnels:\[\]/, 'new House Editor pieces carry a tall-entry marker layer');
assert.match(editorSource, /regularEntryHeight\*1\.5/, 'tall entry tunnels are exactly 150% of regular generated height');
assert.match(editorSource, /continuousMultiTileOpening:openingRun\.length>1/,
  'House Editor fuses adjacent same-height markers into a continuous mouth');
assert.match(editorSource, /tunnels\.has\(cellKey\(x,y\)\) \|\| tunnels\.has\(cellKey\(x,y\+1\)\)/,
  'south-wall portal cutting recognizes an entry marker authored directly in a blue boundary cell');
assert.doesNotMatch(editorSource, /&& !footprintSet\.has\(cellKey\(c\.x,c\.y\)\)/,
  'boundary-run detection no longer rejects entry markers merely because they lie inside the blue footprint');
assert.match(editorSource, /Math\.abs\(last\.heightScale-r\.heightScale\)<1e-6/,
  'regular and tall adjacent runs only merge with entries of the same height class');
assert.match(editorSource, /modular-house-piece-author\/v38/,
  'House Editor exports the schema version that includes tall entry markers');

console.log('barn and House Editor regression checks passed');

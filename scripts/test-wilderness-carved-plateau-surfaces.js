'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const TP = require('../docs/js/terrain-preview.js');

const rootTiles = {}; // Synthetic authored root used to overlap every carved surface with one plateau footprint.
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) rootTiles[`${c},${r}`] = { type: 'grass', crop: '', plateau: 'raised_island' };
}
const carvedByKey = new Map([
  ['1,1', 'river'],
  ['2,1', 'stream'],
  ['3,1', 'waterfall'],
  ['1,2', 'trench'],
  ['3,2', 'raised'],
]); // Used to verify all CARVED_TILE_TYPES survive plateau-mask merging.
for (const [key, type] of carvedByKey) rootTiles[key].type = type;

const workspace = {
  maps: [
    {
      id: 'plateau_surface_regression_root',
      category: 'exterior',
      cols: 5,
      rows: 5,
      tiles: rootTiles,
    },
    {
      id: 'plateau_surface_regression_child',
      isSubmap: true,
      parentMapId: 'plateau_surface_regression_root',
      plateauGroupId: 'raised_island',
      cols: 3,
      rows: 3,
      tiles: {},
    },
  ],
  plateauGroups: [{ id: 'raised_island', elevation: 2 }],
};

const merged = TP.buildMergedZoneGrid(workspace, 'plateau_surface_regression_root');
for (const [key, type] of carvedByKey) {
  const tile = merged.tiles.get(key);
  assert.equal(tile?.type, type, `${type} at ${key} must not fold back into plateau grass`);
  assert.equal(tile?.skipFloor, true, `${type} at ${key} must retain plateau-lid ownership metadata`);
}

const zGrid = TP.buildZGrid(merged.cols, merged.rows, merged.tiles);
const mesa = merged.mesas[0];
assert(mesa, 'synthetic plateau should produce one mesa');
const geometry = TP.buildPlateauMesaGeometry(
  mesa,
  (mesa.toTier - mesa.fromTier) * TP.PLATEAU_UNIT,
  mesa.fromTier * TP.PLATEAU_UNIT,
  zGrid
);

const renderedMesaCells = new Set(); // Used to prove the grass lid has no triangles over carved cells.
const gridWidth = (mesa.maxC - mesa.minC + 1) * 2 + 1;
for (let i = 0; i < geometry.idx.length; i += 6) {
  const firstVertex = geometry.idx[i];
  const gi = firstVertex % gridWidth;
  const gj = Math.floor(firstVertex / gridWidth);
  renderedMesaCells.add(`${mesa.minC + Math.floor(gi / 2)},${mesa.minR + Math.floor(gj / 2)}`);
}
for (const key of carvedByKey.keys()) {
  assert(!renderedMesaCells.has(key), `mesa grass lid must leave ${key} open for carved terrain`);
}

const gameSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'game.js'), 'utf8');
const grassSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'zone-grass-billboards.js'), 'utf8');
assert.match(gameSource, /isCarvedPlateauOverride[\s\S]{0,900}outTiles\.set\(key, \{ \.\.\.staked, type: t\.type \}\)/,
  'live workspace fold must mirror the preview carved-plateau preservation rule');
assert.match(gameSource, /const EXCLUDED = new Set\(\[\.\.\.CARVED_TILE_TYPES,[^\n]+TileType\.RAMP, TileType\.PADDY\]\)/,
  'the route grass apron must not cover any carved surface, waterfall, ramp, or paddy');
assert.match(gameSource, /tileIndexRanges[\s\S]{0,4200}refreshTile\(c, r\)[\s\S]{0,1000}indexAttr\.needsUpdate = true/,
  'the route grass apron must retain per-tile index ranges for surgical runtime hole updates');
assert.match(gameSource, /zi\.pathNet\?\.refreshTile\?\.\(col, row\)/,
  'runtime wilderness edits must toggle only the edited route-apron tile');
assert.doesNotMatch(gameSource, /zi\.pathNet = buildPathNetworkGeo\(zi\.grid, zi\.cols, zi\.rows\)/,
  'runtime edits must not regenerate the whole route heightfield');
assert.match(gameSource, /buildTerrainTileGeo\(c, r, tile\.type, zGrid, \{ includeCutWalls: true \}\)/,
  'wilderness trench meshes must request their own visible cut walls');
assert.match(gameSource, /const wallIdx = \[\][\s\S]{0,4000}dirtIdx\.push\(\.\.\.wallIdx\)/,
  'trench cut walls must be included in the dirt geometry');
assert.match(grassSource, /\[deps\.TileType\.GRASS, deps\.TileType\.SHRUB, deps\.TileType\.WEEDS\]\.includes\(liveTile\.type\)/,
  'rich grass patches must reject trenches and other carved runtime tiles');

console.log('wilderness carved plateau surface regression checks passed');

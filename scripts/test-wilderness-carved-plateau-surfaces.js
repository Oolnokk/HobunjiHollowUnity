'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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
const terrainChunkSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'terrain-render-chunks.js'), 'utf8');
const mesaSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'zone-plateau-mesa.js'), 'utf8');
assert.match(gameSource, /isCarvedPlateauOverride[\s\S]{0,900}outTiles\.set\(key, \{ \.\.\.staked, type: t\.type \}\)/,
  'live workspace fold must mirror the preview carved-plateau preservation rule');
assert.match(gameSource, /const EXCLUDED = new Set\(\[\.\.\.CARVED_TILE_TYPES,[^\n]+TileType\.RAMP, TileType\.PADDY\]\)/,
  'the route grass apron must not cover any carved surface, waterfall, ramp, or paddy');
assert.match(gameSource, /const isExcludedCell[\s\S]{0,280}!!tile\?\.incline \|\| !!tile\?\.mesaCliffFace \|\| EXCLUDED\.has\(tile\?\.type\)/,
  'the route grass apron must not cover metadata inclines or geometry-confirmed cliff-face cells');
assert.match(mesaSource, /if \(steep\)[\s\S]{0,360}ownerTile\.mesaCliffFace = true/,
  'the rendered mesa must tag every tile that actually emits a steep stone quad');
assert.match(gameSource, /delete tile\.mesaCliffFace[\s\S]{0,700}buildPlateauMesa/,
  'mesa rebuilds must replace stale geometry-derived cliff ownership tags');
assert.match(gameSource, /isExcludedTile: \(c, r\) => isExcludedCell\(c - minC, r - minR\)/,
  'load-time and runtime route-apron exclusions must share the complete-cell predicate');
assert.match(gameSource, /const PATH_MESA_LIFT = 0\.004[\s\S]{0,4200}ownerTile\?\.skipFloor && !ownerTile\?\.incline \? PATH_MESA_LIFT : 0/,
  'the route grass apron anti-z-fighting lift must apply only over flat mesa lids, never cliff boundaries');
assert.doesNotMatch(gameSource, /NORMAL_TOP \+ PATH_Z_FIGHT_LIFT/,
  'the entire route grass mesh must not be lifted through neighboring cliff faces');
assert.match(gameSource, /mesh\.name = 'zone_path_ground'/,
  'mobile Pixel Probe reports must identify the global path grass mesh directly');
assert.match(gameSource, /bindRenderedGroundGeometry\(geometry\)[\s\S]{0,4200}refreshTile\(c, r\)[\s\S]{0,1000}indexAttr\.needsUpdate = true/,
  'the route grass apron must index the final rendered geometry for surgical runtime hole updates');
assert.doesNotMatch(gameSource, /if \(isExcluded\(tci, tcj\)\) continue/,
  'route geometry must reserve restorable triangles even for tiles carved when the zone first loads');
assert.match(gameSource, /bindRenderedGroundGeometry\(geometry\)[\s\S]{0,1800}this\.isExcludedTile\(c, r\)\) this\.refreshTile\(c, r\)/,
  'initially carved route tiles must be collapsed before the first rendered frame');
assert.match(terrainChunkSource, /notifyTerrainGeometryReady\(scene\)[\s\S]{0,1800}notifyTerrainGeometryReady\(scene\)/,
  'the terrain renderer must return the post-jigsaw, post-spatial-split geometry to runtime terrain owners');
assert.match(gameSource, /zi\.pathNet\?\.refreshTile\?\.\(col, row\)/,
  'runtime wilderness edits must toggle only the edited route-apron tile');
assert.doesNotMatch(gameSource, /zi\.pathNet = buildPathNetworkGeo\(zi\.grid, zi\.cols, zi\.rows\)/,
  'runtime edits must not regenerate the whole route heightfield');
assert.match(gameSource, /buildTerrainTileGeo\(c, r, tile\.type, zGrid, \{ includeCutWalls: true \}\)/,
  'wilderness trench meshes must request their own visible cut walls');
assert.match(gameSource, /const wallIdx = \[\][\s\S]{0,4000}dirtIdx\.push\(\.\.\.wallIdx\)/,
  'trench cut walls must be included in the dirt geometry');
assert.match(gameSource, /const isCutWaterBasin = options\.includeCutWalls && WATERWAY_TYPES\.has\(type\)[\s\S]{0,4200}if \(isDepression && options\.includeCutWalls\)/,
  'wilderness waterways must use the trench-style full-depth basin and cut walls');
assert.match(grassSource, /\[deps\.TileType\.GRASS, deps\.TileType\.SHRUB, deps\.TileType\.WEEDS\]\.includes\(liveTile\.type\)/,
  'rich grass patches must reject trenches and other carved runtime tiles');

// Execute the real buildPathNetworkGeo implementation against a minimal THREE
// buffer shim, then reorder its merged triangle index as TerrainRenderChunks
// does. This proves dig -> fill -> redig mutates the final rendered order,
// rather than merely matching source text that never affects the live mesh.
class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.needsUpdate = false; }
  getX(i) { return this.array[i * this.itemSize]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(attr) { this.index = attr; return this; }
  computeVertexNormals() { return this; }
}
const THREE = { BufferAttribute, Float32BufferAttribute: BufferAttribute, BufferGeometry };

// Execute the renderer wrapper with a tiny non-WebGL scene to prove the
// post-transform handoff callback runs before the underlying render call.
class FakeMesh {}
class FakeRenderer { render() { this.rendered = true; } }
const hookThree = { BufferAttribute, BufferGeometry, Mesh: FakeMesh, WebGLRenderer: FakeRenderer };
const hookWindow = { THREE: hookThree };
vm.runInNewContext(terrainChunkSource, { window: hookWindow, performance, console });
const hookGeometry = new BufferGeometry()
  .setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3))
  .setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
let handedOffGeometry = null;
const hookScene = { isScene: true, userData: {}, children: [{
  isMesh: true,
  parent: null,
  geometry: hookGeometry,
  material: {},
  layers: { mask: 0 },
  userData: { onTerrainGeometryReady: geometry => { handedOffGeometry = geometry; } },
}] };
hookScene.children[0].parent = hookScene;
new hookThree.WebGLRenderer().render(hookScene, {});
assert.strictEqual(handedOffGeometry, hookGeometry,
  'the installed renderer wrapper must hand the final geometry back before drawing');

const TileType = {
  GRASS: 'grass', PATH: 'path', TRENCH: 'trench', RAISED: 'raised',
  RIVER: 'river', STREAM: 'stream', WATERFALL: 'waterfall', SHRUB: 'shrub',
  ROCK: 'rock', TILLED: 'tilled', RAMP: 'ramp', PADDY: 'paddy',
};
const CARVED_TILE_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL, TileType.TRENCH, TileType.RAISED]);
const PLATEAU_UNIT = 2.5;
const _sharedSplitNormals = (_positions, vertCount) => new Float32Array(vertCount * 3);
global.window = { TerrainRenderChunks: { installed: true } };
const pathFunctionMatch = gameSource.match(/(function buildPathNetworkGeo\(srcGrid, gcols, grows\) \{[\s\S]*?\n      \})\n\n      \/\/ ── Path:/);
assert(pathFunctionMatch, 'must be able to execute the live path-network builder in this regression');
const buildPathNetworkGeo = eval(`(${pathFunctionMatch[1]})`); // Executes repository code only.
const liveGrid = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => ({ type: TileType.GRASS, elevTier: 0 })));
liveGrid[3][3].type = TileType.PATH;
liveGrid[2][2].type = TileType.TRENCH;
liveGrid[2][3].incline = true;
liveGrid[2][3].skipFloor = true;
liveGrid[2][4].mesaCliffFace = true;
liveGrid[2][4].skipFloor = true;
liveGrid[3][4].skipFloor = true;
const pathNetwork = buildPathNetworkGeo(liveGrid, 7, 7);
const noMesaLiftGrid = liveGrid.map(row => row.map(tile => ({ ...tile, skipFloor: false }))); // Baseline used to isolate the plateau-only 0.004 vertex lift.
const noMesaLiftNetwork = buildPathNetworkGeo(noMesaLiftGrid, 7, 7);
const vertexYAt = (network, x, z) => {
  const position = (network.pathGeo || network.grassGeo).getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.array[i * 3] - x) < 1e-6 && Math.abs(position.array[i * 3 + 2] - z) < 1e-6) return position.array[i * 3 + 1];
  }
  assert.fail(`missing route-apron vertex at ${x},${z}`);
};
assert(Math.abs(vertexYAt(pathNetwork, 4.5, 3.5) - vertexYAt(noMesaLiftNetwork, 4.5, 3.5) - 0.004) < 1e-6,
  'a flat plateau-top route vertex must retain the mesa anti-z-fighting lift');
assert(Math.abs(vertexYAt(pathNetwork, 3.5, 2.5) - vertexYAt(noMesaLiftNetwork, 3.5, 2.5)) < 1e-6,
  'an incline/cliff route vertex must remain at its real seam height without the mesa lift');
const mergedPosition = [];
const mergedIndex = [];
let vertexBase = 0;
for (const geometryPart of [pathNetwork.pathGeo, pathNetwork.grassGeo].filter(Boolean)) {
  mergedPosition.push(...geometryPart.getAttribute('position').array);
  for (const vertexIndex of geometryPart.index.array) mergedIndex.push(vertexIndex + vertexBase);
  vertexBase += geometryPart.getAttribute('position').count;
}
const reorderedTriangles = [];
for (let i = mergedIndex.length - 3; i >= 0; i -= 3) reorderedTriangles.push(mergedIndex[i], mergedIndex[i + 1], mergedIndex[i + 2]);
const renderedGeometry = new BufferGeometry()
  .setAttribute('position', new BufferAttribute(new Float32Array(mergedPosition), 3))
  .setIndex(new BufferAttribute(new Uint32Array(reorderedTriangles), 1));
const renderedMesh = { geometry: renderedGeometry, userData: {} };
pathNetwork.bindGlobalGroundMesh(renderedMesh);
renderedMesh.userData.onTerrainGeometryReady(renderedGeometry);
const trenchStarts = pathNetwork.renderedTileIndexRanges.get('2,2');
assert.equal(trenchStarts?.length, 72, 'one final rendered route-apron tile must retain all 72 triangles');
const tileIsCollapsed = starts => starts.every(offset => {
  const a = renderedGeometry.index.array[offset];
  return renderedGeometry.index.array[offset + 1] === a && renderedGeometry.index.array[offset + 2] === a;
});
assert(tileIsCollapsed(trenchStarts), 'an initially carved tile must be absent after the final geometry handoff');
const inclineStarts = pathNetwork.renderedTileIndexRanges.get('3,2');
assert.equal(inclineStarts?.length, 72, 'one plateau incline tile must retain all 72 restorable apron triangles');
assert(tileIsCollapsed(inclineStarts), 'a plateau incline must have no flat grass apron intersecting its cliff skin');
const renderedCliffStarts = pathNetwork.renderedTileIndexRanges.get('4,2');
assert.equal(renderedCliffStarts?.length, 72, 'one geometry-confirmed cliff tile must retain all 72 restorable apron triangles');
assert(tileIsCollapsed(renderedCliffStarts), 'a rendered steep mesa tile must have no path grass intersecting its cliff skin');
liveGrid[2][2].type = TileType.GRASS;
assert(pathNetwork.refreshTile(2, 2), 'filling must find the final rendered tile ranges');
assert(!tileIsCollapsed(trenchStarts), 'filling must restore the route-apron surface');
liveGrid[2][2].type = TileType.TRENCH;
assert(pathNetwork.refreshTile(2, 2), 'redigging must find the final rendered tile ranges');
assert(tileIsCollapsed(trenchStarts), 'redigging must remove the restored surface again');
liveGrid[2][3].incline = false;
assert(pathNetwork.refreshTile(3, 2), 'flattening an incline must find the final rendered tile ranges');
assert(!tileIsCollapsed(inclineStarts), 'flattening an incline must restore its route-apron surface');
delete liveGrid[2][4].mesaCliffFace;
assert(pathNetwork.refreshTile(4, 2), 'removing stale rendered-cliff ownership must find the final tile ranges');
assert(!tileIsCollapsed(renderedCliffStarts), 'a mesa rebuild that removes a steep face must restore its route-apron surface');

// Execute the real basin builder too. Wilderness water must be full depth at
// its shoreline and must add vertical wall triangles, while the town call
// (without includeCutWalls) retains its existing softly tapered bank.
const TRENCH_TOP = -0.5, NORMAL_TOP = 0, RAISED_TOP = 0.5, RIVER_TOP = -0.55, STREAM_TOP = -0.55;
const WATERWAY_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL]);
const sameWaterway = (a, b) => a === b || (WATERWAY_TYPES.has(a) && WATERWAY_TYPES.has(b));
const DEPRESSION_TOP = {
  [TileType.TRENCH]: TRENCH_TOP,
  [TileType.RIVER]: RIVER_TOP,
  [TileType.STREAM]: STREAM_TOP,
  [TileType.WATERFALL]: RIVER_TOP,
};
const basinFunctionMatch = gameSource.match(/(function buildTerrainTileGeo\(col, row, type, srcGrid = grid, options = \{\}\) \{[\s\S]*?\n      \})\n\n      \/\/ Procedural farm\/town border terrain/);
assert(basinFunctionMatch, 'must be able to execute the live terrain-basin builder in this regression');
const buildTerrainTileGeo = eval(`(${basinFunctionMatch[1]})`); // Executes repository code only.
const basinGrid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ type: TileType.GRASS })));
basinGrid[1][1].type = TileType.RIVER;
const wildernessBasin = buildTerrainTileGeo(1, 1, TileType.RIVER, basinGrid, { includeCutWalls: true }).dirtGeo;
const townBasin = buildTerrainTileGeo(1, 1, TileType.RIVER, basinGrid).dirtGeo;
assert(wildernessBasin.getAttribute('position').count > townBasin.getAttribute('position').count,
  'wilderness water must add shoreline wall vertices beyond the town tapered-bed vertices');
assert(wildernessBasin.index.count > townBasin.index.count,
  'wilderness water must add visible shoreline wall triangles');
const wildernessPositions = wildernessBasin.getAttribute('position');
const northwestBedY = wildernessPositions.array[1];
assert(northwestBedY < -0.45, 'the wilderness water basin must remain full-depth at its outer corner');
const wallIndexCount = 4 * 6 * 2 * 3; // Four banks, six segments per bank, two triangles per segment.
const wallIndexStart = wildernessBasin.index.count - wallIndexCount;
for (let offset = wallIndexStart; offset < wildernessBasin.index.count; offset += 3) {
  const ia = wildernessBasin.index.array[offset] * 3;
  const ib = wildernessBasin.index.array[offset + 1] * 3;
  const ic = wildernessBasin.index.array[offset + 2] * 3;
  const ax = wildernessPositions.array[ia], ay = wildernessPositions.array[ia + 1], az = wildernessPositions.array[ia + 2];
  const abx = wildernessPositions.array[ib] - ax, aby = wildernessPositions.array[ib + 1] - ay, abz = wildernessPositions.array[ib + 2] - az;
  const acx = wildernessPositions.array[ic] - ax, acy = wildernessPositions.array[ic + 1] - ay, acz = wildernessPositions.array[ic + 2] - az;
  const normalX = aby * acz - abz * acy;
  const normalZ = abx * acy - aby * acx;
  const centerX = (ax + wildernessPositions.array[ib] + wildernessPositions.array[ic]) / 3;
  const centerZ = (az + wildernessPositions.array[ib + 2] + wildernessPositions.array[ic + 2]) / 3;
  assert(normalX * -centerX + normalZ * -centerZ > 0,
    'every cut-wall triangle must face the basin interior so backface culling does not hide it');
}
delete global.window;

console.log('wilderness carved plateau surface regression checks passed');

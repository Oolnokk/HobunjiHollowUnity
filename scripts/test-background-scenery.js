'use strict';
const assert = require('assert');

class BufferGeometry {
  constructor() { this.attributes = {}; this.groups = []; this.index = null; }
  setAttribute(name, value) { this.attributes[name] = value; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(value) { this.index = value; return this; }
  addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }); }
  computeVertexNormals() {}
  computeBoundingSphere() {}
  computeBoundingBox() {}
}
class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.needsUpdate = false; }
}
class Material {
  constructor(opts = {}) { Object.assign(this, opts); this.userData = { ...(opts.userData || {}) }; this.fog = opts.fog !== false; }
  clone() { const copy = new this.constructor({ ...this }); copy.userData = { ...this.userData }; return copy; }
}
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; this.isMesh = true; this.frustumCulled = true; this.castShadow = false; this.receiveShadow = false; this.name = ''; this.parent = null; }
}
class Group {
  constructor() { this.children = []; this.userData = {}; this.parent = null; }
  add(obj) { if (obj.parent?.remove) obj.parent.remove(obj); obj.parent = this; this.children.push(obj); }
  remove(obj) { this.children = this.children.filter(child => child !== obj); if (obj.parent === this) obj.parent = null; }
}
class MeshStandardMaterial extends Material {}
class MeshBasicMaterial extends Material {}
global.THREE = {
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute: BufferAttribute,
  Mesh,
  Group,
  MeshStandardMaterial,
  MeshBasicMaterial,
  DoubleSide: 2,
  InstancedMesh: class {},
  Object3D: class {},
};
global.window = {};
require('../docs/js/zone-plateau-mesa.js');
require('../docs/js/border-terrain.js');
const Core = window.BackgroundScenery;
assert(Core, 'BackgroundScenery export missing');

const town = {
  cols: 60,
  rows: 50,
  routes: [
    { id: 'north_south', label: 'North/South', nodes: [[30,49],[30,20],[30,0]], pathWidth: 3 },
    { id: 'east', label: 'East', nodes: [[40,30],[59,30]], pathWidth: 5 },
    { id: 'west', label: 'West', nodes: [[20,25],[0,25]], pathWidth: 3 },
  ],
  rivers: [
    { id: 'stream', label: 'Town Stream', kind: 'stream', width: 3, seed: 336742, nodes: [[0,0],[13,11],[25,17],[37,20],[50,21],[59,22]] },
  ],
};

let attachments = Core.collectBoundaryAttachments(town);
const byId = id => attachments.find(a => a.id === id);
assert.equal(byId('route:north_south:start').edge, 'south');
assert.equal(byId('route:north_south:end').edge, 'north');
assert.equal(byId('route:east:end').edge, 'east');
assert.equal(byId('route:east:end').width, 5);
assert.equal(byId('river:stream:start').edge, 'north', 'NW-corner river defaults to north');
assert.equal(byId('river:stream:end').edge, 'east');
assert.equal(byId('river:stream:start').seed, 336742);
const cfg = Core.resolveConfig(town);
assert.equal(cfg.ridgeClearanceTiles, 0);
assert.equal(cfg.borderDepthTiles, 18);

const westHorizon = Core.resolveConfig({ id:'map_western_slope', cols:80, rows:80 }).horizonTerrain;
const northHorizon = Core.resolveConfig({ id:'map_northern_cliffs', cols:80, rows:80 }).horizonTerrain;
assert.equal(westHorizon.preset, 'westernMountainChain');
assert.equal(westHorizon.side, 'west');
assert.equal(westHorizon.heightWorld, 72);
assert.equal(westHorizon.overallScale, 1);
assert.equal(westHorizon.segments, 8);
assert.equal(westHorizon.mountainLayers, 48, 'West Slope mountains should allow high-resolution regular plateau tiering');
assert.equal(westHorizon.mountainSeed, 1337);
assert.deepStrictEqual(westHorizon.lockedTiles, {});
assert.equal(northHorizon.preset, 'northernPlateau');
assert.equal(northHorizon.side, 'north');
assert.equal(northHorizon.heightWorld, 64);
assert(northHorizon.heightWorld < westHorizon.heightWorld && northHorizon.heightWorld > westHorizon.heightWorld * 0.85, 'Northern Cliffs plateau should be only slightly shorter than the West Slope chain');
assert.equal(Core.resolveConfig({ id:'map_eastern_mire', cols:80, rows:80 }).horizonTerrain.enabled, false, 'unrelated wilderness maps must not gain a colossal horizon landmark');
const riverAutoA = Core.buildContinuationPolyline(byId('river:stream:start'), cfg, {});
const riverAutoB = Core.buildContinuationPolyline(byId('river:stream:start'), cfg, {});
assert.deepStrictEqual(riverAutoA, riverAutoB, 'seeded river continuation must be deterministic');
assert(riverAutoA.length > 2, 'automatic river continuation should meander, not become one straight segment');

town.backgroundScenery = { attachments: { 'river:stream:start': { edge: 'west' } } };
attachments = Core.collectBoundaryAttachments(town);
assert.equal(attachments.find(a => a.id === 'river:stream:start').edge, 'west', 'corner edge override must win');
delete town.backgroundScenery;

assert.equal(Core.WILDERNESS_PROFILES.map_southern_cloud_forest.side, 'north');
const cloudGrid = Array.from({ length: 8 }, () => Array.from({ length: 20 }, () => ({ type: 'grass', elevTier: 1 })));
for (let c = 3; c <= 4; c++) cloudGrid[0][c].type = 'path';
for (let c = 11; c <= 15; c++) cloudGrid[0][c].type = 'path';
const cloudEntrance = Core.findEdgePathRun(cloudGrid, 20, 8, 'north');
assert.equal(cloudEntrance.widthCells, 5, 'wilderness scenery should select the widest generated north-edge path run');
assert.equal(cloudEntrance.center, 13.5, 'wilderness scenery should center itself on the generated entrance, not a hardcoded column');

const Border = window.BorderTerrain;
assert.equal(Border.CLOUD_FOREST_BASE_TREE_SPACING_WORLD, 1, 'Cloud Forest scenery must translate the generator tree spacing to one world unit');
const denseLayout = Border.buildDenseCloudForestLayout(12, 6, 6, 1.5, () => 2);
const scales = new Set(denseLayout.map(entry => entry.scale));
assert(scales.has(1), 'dense layout must include full-height Shadewoods');
assert(scales.has(0.75), 'dense layout must fill gaps with 75% Shadewoods');
assert(scales.has(0.5), 'dense layout must fill remaining gaps with 50% Shadewoods');
assert(denseLayout.every(entry => Math.abs(entry.x - 6) >= 1.5), 'all tree layers must preserve the authored town-path cut');
const fullTrees = denseLayout.filter(entry => entry.scale === 1);
for (let i = 0; i < fullTrees.length; i++) {
  for (let j = i + 1; j < fullTrees.length; j++) {
    const dx = Math.abs(fullTrees[i].x - fullTrees[j].x);
    const dz = Math.abs(fullTrees[i].z - fullTrees[j].z);
    if (dx < 1e-6 || dz < 1e-6) assert(Math.max(dx, dz) >= 1 - 1e-6, 'full-height centers must retain the one-world-unit base spacing');
  }
}
assert(denseLayout.length > fullTrees.length * 2, 'gap fillers should make the authored wall substantially denser than the base tree lattice');

const syntheticWorkspace = {
  maps: [{
    id: 'map_generated_wilderness_root', cols: 3, rows: 4, tiles: {
      '0,0': { type: 'rock', plateau: 'boundary_a', borderEscarpment: true, generatedBorderEscarpment: true, borderEscarpmentSide: 'north', borderEscarpmentDepth: 2 },
      '1,0': { type: 'path', plateau: 'boundary_b', borderEscarpment: true, generatedBorderEscarpment: true, borderEscarpmentSide: 'north', borderEscarpmentDepth: 2 },
      '0,1': { type: 'grass', plateau: 'interior_a' },
      '1,1': { type: 'path', plateau: 'interior_b' },
    }, generatedFrom: {}
  }],
  generatorPreset: {},
};
Border.removeCloudForestNorthBoundaryCliffs(syntheticWorkspace);
const normalizedRoot = syntheticWorkspace.maps[0];
assert.equal(normalizedRoot.tiles['0,0'].plateau, 'interior_a', 'north cliff tile should inherit its inward plateau instead of a boundary-cliff plateau');
assert.equal(normalizedRoot.tiles['0,0'].type, 'grass', 'north cliff rock should become ordinary ground');
assert.equal(normalizedRoot.tiles['0,0'].borderEntryGate, true, 'raised north-edge ground must merge as a flat plateau top rather than an incline wall');
assert.equal(normalizedRoot.tiles['0,0'].borderEscarpment, undefined);
assert.equal(normalizedRoot.tiles['1,0'].plateau, 'interior_b');
assert.equal(normalizedRoot.tiles['1,0'].type, 'path', 'the actual generated entrance path must survive cliff removal');
assert(normalizedRoot.generatedFrom.northBoundaryCliffsRemoved >= 2);

const scene = { items: [], add(obj) { this.items.push(obj); }, remove() {} };
const tileType = { GRASS:'grass', ROCK:'rock', PATH:'path', RAMP:'ramp', RIVER:'river', STREAM:'stream', WATERFALL:'waterfall', TRENCH:'trench', RAISED:'raised' };
const grassMat = new MeshStandardMaterial({ color: 0x315f2b, fog: true });
const rockMat = new MeshStandardMaterial({ color: 0x676563, fog: true });
const deps = {
  getTownScene: () => scene,
  getTownZone: () => town,
  NORMAL_TOP: 0,
  TileType: tileType,
  CARVED_TILE_TYPES: new Set([tileType.RIVER,tileType.STREAM,tileType.WATERFALL,tileType.TRENCH,tileType.RAISED]),
  resolveTileMat: (_mapId,type) => type === tileType.ROCK ? rockMat : grassMat,
  resolveCliffMat: () => rockMat,
  displaceZoneGeometry: geometry => geometry,
  ROCK_MOUND_CELLS_PER_TILE: 6,
  _zoneScenes: new Map(), _zoneLayouts: new Map(), _zoneMesaMeshGroups: new Map(),
  getGrassBillboardMat: () => null,
  mbRng: seed => { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); },
  getGrassEnabled: () => true,
  grassBladeGeo: {},
  markOutline() {},
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  PLATEAU_UNIT: 2.5,
};
window.BorderTerrain.init(deps);
window.ZonePlateauMesa.init(deps);

const baseField = Core.buildMountainPlateauField(80, 80, 'map_western_slope', westHorizon);
assert.equal(baseField.cols, 48);
assert.equal(baseField.rows, 96);
assert.equal(baseField.frontPeakCount, 8);
assert.equal(baseField.backPeakCount, 7);
assert.equal(baseField.peakCount, 15);
assert(baseField.maxTier >= 25, 'default 72u range should use many ordinary 2.5u plateau tiers');
assert(baseField.maxTier <= westHorizon.mountainLayers);
assert.equal(baseField.mesas.length, baseField.maxTier, 'shared synthetic map should emit one regular plateau transition mask per active elevation tier');

function countComponents(field, minTier = 1) {
  const seen = new Set(); let components = 0;
  const key = (c,r) => r * field.cols + c;
  for (let r=0;r<field.rows;r++) for (let c=0;c<field.cols;c++) {
    if (field.tiers[key(c,r)] < minTier || seen.has(key(c,r))) continue;
    components++; const queue=[[c,r]]; seen.add(key(c,r));
    for(let qi=0;qi<queue.length;qi++){
      const [x,y]=queue[qi];
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,ny=y+dy,k=key(nx,ny);
        if(nx<0||ny<0||nx>=field.cols||ny>=field.rows||seen.has(k)||field.tiers[k]<minTier) continue;
        seen.add(k);queue.push([nx,ny]);
      }
    }
  }
  return components;
}
assert.equal(countComponents(baseField, 1), 1, 'low-tier front/rear mountain stamps should merge into one continuous shared plateau landmass');

const randomized = Core.normalizeHorizonTerrain({ ...westHorizon, mountainSeed: westHorizon.mountainSeed + 1 }, 'map_western_slope');
const randomField = Core.buildMountainPlateauField(80, 80, 'map_western_slope', randomized);
let changedCell = -1, changedCount = 0;
for (let i=0;i<baseField.tiers.length;i++) if (baseField.tiers[i] !== randomField.tiers[i]) { changedCount++; if(changedCell<0) changedCell=i; }
assert(changedCount > 100, 'Randomize seed should materially regenerate the shared mountain plateau map');
assert(changedCell >= 0);
const lockedC = changedCell % baseField.cols, lockedR = Math.floor(changedCell / baseField.cols);
const lockedKey = `${lockedC},${lockedR}`;
const lockedConfig = Core.normalizeHorizonTerrain({
  ...randomized,
  lockedTiles: { [lockedKey]: baseField.tiers[changedCell] },
}, 'map_western_slope');
const lockedField = Core.buildMountainPlateauField(80, 80, 'map_western_slope', lockedConfig);
assert.equal(lockedField.tiers[changedCell], baseField.tiers[changedCell], 'locked 2D brush tile must preserve its exact plateau tier across randomization');
assert.equal(lockedField.lockedCount, 1);

const westHorizonScene = new Group();
const westBudget = Border.buildColossalHorizonTerrain(westHorizonScene, 80, 80, 'map_western_slope', 0, null, westHorizon);
assert.equal(westBudget.rows, 2);
assert.equal(westBudget.frontPeakCount, 8);
assert.equal(westBudget.backPeakCount, 7);
assert.equal(westBudget.peakCount, 15);
assert.equal(westBudget.sharedSyntheticPlateauMap, true);
assert.equal(westBudget.regularPlateauBuilder, true, 'mountain chain must route through ZonePlateauMesa rather than a bespoke mountain mesh generator');
assert.equal(westBudget.fieldCols, 48);
assert.equal(westBudget.fieldRows, 96);
assert.equal(westBudget.mountainLayers, baseField.maxTier);
assert.equal(westBudget.meshes, baseField.mesas.length, 'one shared regular plateau mesh per tier should replace per-mountain meshes');
assert(westBudget.vertices > 100000, 'new version should be substantially higher-poly than the discarded 1,440-vertex custom mesh');
assert(westBudget.triangles > 100000, 'regular plateau half-tile surfaces should provide the requested higher-poly terrain');
assert.equal(westHorizonScene.children.length, westBudget.meshes);
for (const mesh of westHorizonScene.children) {
  assert.equal(mesh.frustumCulled, false, 'every regular plateau tier must remain always visible');
  assert.equal(mesh.castShadow, false, 'horizon plateau tiers must not enter the permanent shadow map');
  assert.equal(mesh.receiveShadow, false);
  assert.equal(mesh.userData.sharedSyntheticPlateauMap, true);
  assert.equal(mesh.userData.cameraObstacle, false, 'distant horizon tiers must not enter normal player-camera occlusion lists');
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  assert(mats.every(m => m !== grassMat && m !== rockMat), 'horizon materials must clone regular materials instead of mutating shared gameplay materials');
  assert(mats.every(m => m.fog === false), 'always-visible cloned plateau materials must bypass scene fog');
}

const hugeWest = Core.normalizeHorizonTerrain({
  preset:'westernMountainChain',
  overallScale:3,
  spanScale:4,
  depthWorld:140,
  mountainLayers:48,
  mountainSeed:westHorizon.mountainSeed,
}, 'map_western_slope');
const hugeWestScene = new Group();
const hugeWestBudget = Border.buildColossalHorizonTerrain(hugeWestScene, 80, 80, 'map_western_slope', 0, null, hugeWest);
assert.equal(hugeWestBudget.effectiveHeightWorld, 216);
assert.equal(hugeWestBudget.effectiveDepthWorld, 420);
assert.equal(hugeWestBudget.spanWorld, 960);
let minNorthSouth = Infinity, maxNorthSouth = -Infinity;
for (const mesh of hugeWestScene.children) {
  const p = mesh.geometry.attributes.position.array;
  for (let i=2;i<p.length;i+=3) { minNorthSouth=Math.min(minNorthSouth,p[i]); maxNorthSouth=Math.max(maxNorthSouth,p[i]); }
}
assert(minNorthSouth < -400, `scaled west range should extend far north of the map; min z=${minNorthSouth}`);
assert(maxNorthSouth > 480, `scaled west range should extend far south of the map; max z=${maxNorthSouth}`);
assert.equal(hugeWestBudget.fieldCols, westBudget.fieldCols, 'physical scaling must keep the synthetic shared-map tile topology stable for brush locks');
assert.equal(hugeWestBudget.fieldRows, westBudget.fieldRows);

const northHorizonScene = { items: [], userData: {}, add(obj) { this.items.push(obj); } };
const northBudget = Border.buildColossalHorizonTerrain(northHorizonScene, 80, 80, 'map_northern_cliffs', 0, null, northHorizon);
assert.equal(northBudget.vertices, 28, 'Northern Cliffs plateau must stay extremely low poly');
assert.equal(northBudget.triangles, 36, 'Northern Cliffs plateau triangle budget regressed');
assert.equal(northHorizonScene.items[0].frustumCulled, false);
assert.equal(northHorizonScene.items[0].geometry.groups.length, 3, 'plateau strips must preserve cliff/top/cliff material grouping');

window.BorderTerrain.buildTownBorderTerrain();
assert(scene.items.length >= 8, `expected terrain, cliff, route and water meshes; got ${scene.items.length}`);
console.log(`PASS background scenery: ${attachments.length} attachments; ${scene.items.length} generated town meshes; cloud entrance ${cloudEntrance.widthCells} tiles at ${cloudEntrance.center}; dense layout ${denseLayout.length} trees.`);

'use strict';
const assert = require('node:assert/strict'); // Exercises the shipped path geometry policy without a WebGL renderer.
const fs = require('node:fs'); // Loads the actual production module, not a duplicate paving implementation.
const vm = require('node:vm'); // Runs the browser terrain module with a tiny centerline stub.

class Vector3 {
  constructor(x=0,y=0,z=0) { this.x=x; this.y=y; this.z=z; }
  clone() { return new Vector3(this.x,this.y,this.z); }
  lerp(v,t) { this.x+=(v.x-this.x)*t; this.y+=(v.y-this.y)*t; this.z+=(v.z-this.z)*t; return this; }
}
class CatmullRomCurve3 {
  constructor(points) { this.points=points; } // Linear stub suffices for a straight road crossing the stream.
  getPoints(n) {
    return Array.from({length:n+1},(_,i)=>{
      const k=i/n*(this.points.length-1),j=Math.min(this.points.length-2,Math.floor(k));
      return this.points[j].clone().lerp(this.points[j+1],k-j);
    });
  }
}
class Matrix4 {
  constructor() { this.elements = new Array(16); }
  decompose(position) {
    [position.x, position.y, position.z] = this.elements.slice(12, 15);
  }
  compose(position) {
    this.elements.splice(12, 3, position.x, position.y, position.z);
  }
}
const context={window:{},THREE:{Vector3,CatmullRomCurve3,Matrix4,Quaternion:class {}},console,Math,Set,Map,Number};
vm.runInNewContext(fs.readFileSync('docs/js/terrain-geometry.js','utf8'),context,{filename:'terrain-geometry.js'});
const terrain=context.window.TerrainGeometry; // Public production API owns the spline and brick clipping.
const waterTypes=new Set(['river','stream','waterfall']); // All permanent channel surfaces; not rain or puddles.
const TileType={PATH:'path',STREAM:'stream',RIVER:'river',WATERFALL:'waterfall'};
terrain.init({TileType,WATERWAY_TYPES:waterTypes,debugLog(){}});
const grid=Array.from({length:9},()=>Array.from({length:9},()=>({type:'grass'}))); // A paved road crossing a 1-tile water strip.
for(let col=1;col<=7;col++)grid[4][col]={type:'path'};
grid[4][4]={type:'stream',bridgeCrossing:true}; // The bridge above does not permit paving the water underneath.
const route={id:'uncut-main-road',nodes:[[1,4],[4,4],[7,4]]}; // Same original unsplit route endpoints.
const spline=terrain.preparePathSplineData(grid,9,9,[route],'town');
assert(spline,'Road spline is still selected despite the river gap');
assert(spline.samples?.length===1 && spline.samples[0]?.length>2,'The single route is not split or truncated on the water');
assert(spline.containsPoint(2.5,4.5),'Road on the eastern bank is still paved');
assert(spline.containsPoint(6.5,4.5),'Road on the western bank is still paved');
assert(!spline.containsPoint(4.5,4.5),'A bridge-crossing tile remains permanent water, not paved road');
assert(spline.isPermanentWaterAt(4.5,4.5),'Permanent stream classification is preserved');
grid[4][4].type='river';
assert(!spline.containsPoint(4.5,4.5),'Rivers are excluded too');
grid[4][4].type='waterfall';
assert(!spline.containsPoint(4.5,4.5),'Waterfalls are excluded too');
grid[4][4].type='stream'; // Restore the stream for the following edge-overlap checks.

const brickBounds={min:{x:-.3,y:-.02,z:-.16},max:{x:.3,y:.02,z:.16}}; // Approximate one laid-down WallBuilder brick.
const instance=(x,z,angle=0)=>{
  const c=Math.cos(angle),s=Math.sin(angle); // Same THREE Y rotation convention as production instance matrices.
  return {elements:[c,0,-s,0,0,1,0,0,s,0,c,0,x,0,z,1]};
}; // Instance matrix with translated local brick geometry.
const overlaps=(x,z,angle=0)=>terrain.pathBrickTouchesPermanentWater(instance(x,z,angle),brickBounds,spline.isPermanentWaterAt);
assert(!overlaps(3.55,4.5),'Brick completely on the bank is retained');
assert(overlaps(3.8,4.5),'Brick center on land but edge over water is removed');
assert(overlaps(4.5,4.5),'Brick centered over the stream is removed');
assert(overlaps(3.75,4.5,Math.PI/4),'Rotated brick corner over water is removed');
assert(!overlaps(3.5,3.5),'Brick safely on the upstream bank is retained');
assert(!terrain.pathBrickTouchesPermanentWater(instance(4.5,4.5),brickBounds,()=>false),'Seasonal wetness without permanent water does not hide road bricks');
// WallBuilder maps a vertical wall model's local XY face onto the flat
// world XZ road; local Z becomes vertical thickness. The original regression
// used local XZ only, missing the real production geometry's transverse edge.
const wallBrickBounds={min:{x:-.3,y:-.3,z:-.02},max:{x:.3,y:.3,z:.02}}; // Horizontal half-width is local Y after WallBuilder's rotation.
const laidFlat=(x,z,theta=0)=>{
  const cosine=Math.cos(theta),sine=Math.sin(theta); // Optional planar brick-jitter rotation after laying the wall flat.
  return {elements:[cosine,0,-sine,0,sine,0,cosine,0,0,-1,0,0,x,0,z,1]};
}; // Basis vectors: local X -> road X, local Y -> road Z, local Z -> road vertical.
const wallOverlaps=(x,z,theta=0)=>terrain.pathBrickTouchesPermanentWater(
  laidFlat(x,z,theta),wallBrickBounds,spline.isPermanentWaterAt);
assert(wallOverlaps(4.5,3.8),'A flattened WallBuilder brick must clip when its LOCAL Y edge crosses the stream');
assert(!wallOverlaps(4.5,3.6),'A flat brick wholly north of the water is retained');
assert(wallOverlaps(3.8,4.5),'A flat brick whose local X edge overlaps the stream is removed');
assert(wallOverlaps(4.5,3.8,Math.PI/6),'A jitter-rotated flat brick still clips correctly');
assert(!wallOverlaps(3.55,3.55,Math.PI/6),'A rotated brick fully on dry land remains');

function makeBrickGroup() {
  const matrices = new Float32Array([
    ...laidFlat(3.5, 4.5, Math.PI / 6).elements,
    ...laidFlat(4.5, 4.5).elements,
    ...laidFlat(5.5, 4.5).elements,
  ]); // Dry bank, permanent water, other dry bank.
  const mesh = {
    isInstancedMesh: true, count: 3, userData: {},
    instanceMatrix: { array: matrices }, geometry: { boundingBox: wallBrickBounds },
    getMatrixAt(i, matrix) { matrix.elements.splice(0, 16, ...matrices.subarray(i * 16, (i + 1) * 16)); },
    setMatrixAt(i, matrix) { matrices.set(matrix.elements, i * 16); },
  };
  return { isGroup: true, name: 'WallBuilder_Instances', userData: {}, children: [mesh], traverse(visit) { visit(mesh); } };
}

const scene = { children: [], userData: {}, add(group) { this.children.push(group); } }; // The compatibility hook handles both existing and later async road chunks.
const raisedRoad = { ...spline, elevTierAt: () => 2, bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 9 } };
terrain.init({ TileType, WATERWAY_TYPES: waterTypes, NORMAL_TOP: 0, PLATEAU_UNIT: 2.5, pathWallBuilder: { build: makeBrickGroup } });
const [raisedChunk] = terrain.buildAllPathBrickChunks(raisedRoad, scene);
const [raisedMesh] = raisedChunk.children;
assert.equal(raisedMesh.count, 2);
assert.equal(raisedMesh.instanceMatrix.array[13], 5, 'Raises a brick that stays in its original slot');
assert.equal(raisedMesh.instanceMatrix.array[29], 5, 'Raises a brick that moves after water clipping');
assert.equal(raisedMesh.instanceMatrix.array[28], 5.5, 'Compaction keeps the dry brick on the far bank');
assert.deepEqual(raisedMesh.instanceMatrix.array.slice(0, 12),
  new Float32Array(laidFlat(3.5, 4.5, Math.PI / 6).elements.slice(0, 12)), 'Preserves the brick orientation');

const townApi = { init() {}, spawnTownBuildings() {} }; // The current town config installs its real scene-add and refresh hooks here.
const townMap = { cols: 9, rows: 9, visualHeights: { '3,4': 0.5 } };
const town = {
  document: {}, TownZoneBuildings: townApi,
  TerrainPreview: { sampleVisualHeight: (heights, x, z) => heights[Math.floor(x) + ',' + Math.floor(z)] ?? 0 },
};
vm.runInNewContext(fs.readFileSync('docs/config/config.js', 'utf8'), town, { filename: 'config.js' });
townApi.init({ getTownZone: () => townMap, getTownScene: () => scene });
townApi.spawnTownBuildings();
assert.equal(raisedMesh.instanceMatrix.array[13], 5.5, 'Existing road bricks receive the authored town height');
assert.equal(raisedMesh.instanceMatrix.array[29], 5, 'A brick outside the authored hill keeps its base height');
const [lateChunk] = terrain.buildAllPathBrickChunks(raisedRoad, scene);
const [lateMesh] = lateChunk.children;
assert.equal(lateMesh.instanceMatrix.array[13], 5.5, 'Road chunks added after town initialization receive the same height');
town.HobunjiTownSubtleElevation.refresh();
assert.equal(lateMesh.instanceMatrix.array[13], 5.5, 'Refresh never adds the town height twice');

console.log('Path paving: spline, water clipping, plateau heights and town hill registration passed.');

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
const context={window:{},THREE:{Vector3,CatmullRomCurve3},console,Math,Set,Map,Number};
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
assert(spline.samples?.length>2,'The route is not split or truncated on the water');
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
console.log('Path paving: intact spline, permanent-water tile mask and rotated brick edge clipping passed.');

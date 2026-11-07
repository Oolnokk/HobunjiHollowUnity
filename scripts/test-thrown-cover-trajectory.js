'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/throw-cover-trajectory.js', 'utf8');
const flaskSource = fs.readFileSync('docs/js/alchemy-flasks.js', 'utf8');
const burdenSource = fs.readFileSync('docs/js/shattercasks.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const state = { coverTop: null, door:false, semantic:false, groundRise:false }; // Scenario controls for finite/tall/door/semantic cover fixtures.
const window = {
  InteriorDoorTiles: { blocksBox:(_area,x)=>state.door && x >= 2.9 && x <= 3.3 },
  NearbyVolumeCollision: { segmentSightHit:(start,end)=> {
    if (!state.semantic) return null;
    if (Math.max(start.x,end.x) < 2.9 || Math.min(start.x,end.x) > 3.3) return null;
    return {t:(2.9-start.x)/(end.x-start.x)};
  } },
};
const context = { window }; // Standalone module does not boot the WebGL/game runtime.
vm.runInNewContext(source, vm.createContext(context), { filename:'throw-cover-trajectory.js' });
const resolver = window.ThrowCoverTrajectory;
assert(resolver?.resolve && resolver?.sweep, 'shared cover module exports its expected APIs');
const opts = {
  deps: {
    TILE:64,
    getCurrentArea:()=> 'test',
    worldSurfaceY:(x)=>state.groundRise && x/64 >= 3 ? 2.5 : 0,
    canOccupyAt:(x,_z,_radius,y)=>state.coverTop == null || x/64 < 2.9 || x/64 > 3.3 || y > state.coverTop,
  },
  groundAt:()=>0,
};
const origin = { x:.5, y:1.15, z:.5 }; // Standing throwing-hand origin.
const desired = { x:8.5, y:0, z:.5 }; // Long throw across the test obstacle.
let result = resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,false,'clear ground keeps the requested landing');
assert(Math.abs(result.target.x - desired.x)<0.0001);
state.coverTop=0.25;
result=resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,false,'a low obstacle can be cleared by the physical throw arc');
state.coverTop=Infinity;
result=resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,true,'tall cover blocks even the high arc');
assert(result.target.x < 2.9 && result.target.x > .5,'the ring snaps to the near side of tall cover');
state.coverTop=null;
state.door=true;
result=resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,true,'actual interior doors block thrown items');
state.door=false;
state.semantic=true;
result=resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,true,'authored furniture/semantic cover blocks outside combat too');
state.semantic=false;
state.groundRise=true;
result=resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,true,'an abrupt terrain rise clips the trajectory');
state.groundRise=false;
window.DevRandomRuin = { shaftSegmentHit:(start,end,_radius,intersect)=> {
  if (Math.max(start.x,end.x) < 2.9 || Math.min(start.x,end.x) > 3.3) return null;
  const box = {box:{min:{x:2.9,y:0,z:0},max:{x:3.3,y:4,z:1}}};
  return intersect(start,end,box)?.enter ?? null;
} };
result = resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,true,'the ranged shaft voxel blocker also cuts off physical throws');
assert.equal(result.kind,'shaft-cover');
delete window.DevRandomRuin;
window.DynamicSurfaces = { sampleSupport:(x,_z)=>x>=2.9&&x<=3.3?{y:1.8}:null };
result = resolver.resolve(origin,desired,opts);
assert.equal(result.blocked,true,'elevated support floors intercept the throw arc');
assert.equal(result.kind,'raised-floor-cover');
delete window.DynamicSurfaces;

const blockedStep = resolver.sweep({x:2.8,y:1,z:.5},{x:3.6,y:.9,z:.5},{
  ...opts,deps:{...opts.deps,canOccupyAt:(x)=>x/64 < 3.1},
});
assert(blockedStep?.x >= 3.09 && blockedStep.x < 3.2,'cover appearing during flight is caught in the physical sweep');

class Geometry {
  constructor(inner,outer) {
    const samples=[[inner,0,0],[outer,0,0],[0,inner,0],[0,outer,0]];
    this.attributes={position:{
      count:samples.length,
      getX:i=>samples[i][0],getY:i=>samples[i][1],setZ:(i,z)=>{samples[i][2]=z;},
      values:samples,needsUpdate:false,
    }};
  }
  computeBoundingSphere() { this.rebounded=true; }
}
class Mesh {
  constructor(geometry,material) {this.geometry=geometry;this.material=material;this.position={z:0};this.children=[];this.userData={};}
  add(object) {this.children.push(object);}
}
const THREE = {RingGeometry:Geometry,MeshBasicMaterial:class{constructor(props){Object.assign(this,props);}},Mesh,DoubleSide:2};
const groundRing = new Mesh(null,null);
groundRing.position.x=5; groundRing.position.z=7;
const outline=resolver.attachOutline(groundRing,THREE);
assert(outline?.material?.color===0x050505,'outline is near-black on any backdrop');
assert.equal(resolver.attachOutline(groundRing,THREE),outline,'outline does not duplicate on frame updates');
resolver.projectOutline(groundRing,3,0,()=>0.5);
assert(outline.geometry.attributes.position.needsUpdate,'terrain changes rebuild the black contour');
assert.equal(outline.geometry.attributes.position.values[0][2],0.5/3);

assert(indexSource.indexOf('throw-cover-trajectory.js')<indexSource.indexOf('alchemy-flasks.js'),
  'shared resolver is loaded before flask runtime');
assert(indexSource.indexOf('throw-cover-trajectory.js')<indexSource.indexOf('shattercasks.js'),
  'shared resolver is loaded before burden runtime');
for (const [name,content] of [['flask',flaskSource],['burden',burdenSource]]) {
  assert.match(content,/ThrowCoverTrajectory\?\.resolve/,'both throw systems use the shared height-aware resolver: '+name);
  assert.match(content,/ThrowCoverTrajectory\?\.sweep/,'both throw systems test in-flight cover: '+name);
  assert.match(content,/ThrowCoverTrajectory\?\.attachOutline/,'both target rings receive black contours: '+name);
  assert.match(content,/ThrowCoverTrajectory\?\.projectOutline/,'both black contours follow live terrain: '+name);
}
console.log('Shared thrown-cover clipping, flight sweep, and black-ring-outline regression passed.');

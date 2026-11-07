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
assert(resolver?.resolve && resolver?.sweep && resolver?.sweepFlight, 'shared cover module exports its expected APIs');
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
state.coverTop=1.3;
assert(resolver.sweep(origin,desired,opts), 'a straight chord would incorrectly hit mid-height cover');
assert.equal(resolver.sweepFlight(origin,desired,0,1,opts),null,
  'a long frame sweeps the curved arc rather than the blocked straight chord');
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
window.DynamicSurfaces = { sampleSupport:()=>({y:2}) };
const elevatedOrigin = { x:.5, y:3.05, z:.5 }; // Player standing on a raised floor, with their hand above the surface.
const elevatedTarget = { x:8.5, y:2, z:.5 }; // Legitimate destination on that same floor.
const elevatedOpts = { ...opts, groundAt:()=>2 };
assert.equal(resolver.resolve(elevatedOrigin,elevatedTarget,elevatedOpts).blocked,false,
  'the ground supporting an elevated landing must not pull the large reticle backward');
assert.equal(resolver.sweepFlight(elevatedOrigin,elevatedTarget,0,1,elevatedOpts),null,
  'an unobstructed throw along an elevated floor must reach its actual target');
const belowFloor = { x:.5, y:1, z:.5 };
assert(resolver.sweepFlight(belowFloor,elevatedTarget,0,1,elevatedOpts),
  'an elevated floor remains genuine cover when a throw approaches from below it');
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

// Exercise AlchemyFlasks' *real* aim/release entry points with the shared
// resolver installed: the earlier geometry tests alone cannot detect a missed
// integration call or a stale un-clipped ground reticle.
class Vector3Lite {
  constructor(x=0,y=0,z=0) { this.x=x; this.y=y; this.z=z; }
  set(x,y,z) { this.x=x;this.y=y;this.z=z;return this; }
  setScalar(value) { this.x=value;this.y=value;this.z=value;return this; }
}
class Object3DLite {
  constructor() { this.position=new Vector3Lite();this.rotation=new Vector3Lite();this.scale=new Vector3Lite(1,1,1);this.parent=null;this.children=[];this.userData={}; }
  add(child) {child.parent=this;this.children.push(child);}
  remove(child) {this.children=this.children.filter(item=>item!==child);child.parent=null;}
}
class MeshLite extends Object3DLite {
  constructor(geometry,material) {super();this.geometry=geometry;this.material=material;}
}
const flaskThree = {
  Mesh:MeshLite, Group:class extends Object3DLite {},
  RingGeometry:Geometry, SphereGeometry:Geometry,
  MeshBasicMaterial:THREE.MeshBasicMaterial,
  DoubleSide:THREE.DoubleSide, AdditiveBlending:2,
};
const flaskScene = new Object3DLite(); // Real aim ring and launched flight are mounted here.
const flaskPlayer = {x:32,y:32,angle:0}; // Live gameplay pixels, matching the shared cover origin.
const flaskInventory = {testThrow:2}; // Counted at release, not at preview.
window.ThrowCoverTrajectory=resolver;
window.AlchemySystem = {
  POTION_ITEMS:{testThrow:{recipeId:'throwFixture',potencyTier:0}},
  RECIPE_DEFS:{throwFixture:{id:'throwFixture',useMode:'throw',splashRadius:1}},
  DEFAULT_SPLASH_RADIUS_TILES:1,
  ensureRecipeItemDef:()=> 'testThrow',
};
const flaskContext = {
  window,console,performance:{now:()=>1000},
  document:{dispatchEvent(){}},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  addEventListener(){},
};
vm.runInNewContext(fs.readFileSync('docs/js/alchemy-flasks.js','utf8'),flaskContext);
window.AlchemyFlasks.init({
  THREE:flaskThree,TILE:64,inventory:flaskInventory,
  getPlayer:()=>flaskPlayer,getAimAngle:()=>0,
  getCurrentArea:()=> 'test',getActiveScene:()=>flaskScene,
  getSelectedItemKey:()=> 'testThrow',
  getGroundYAtWorld:()=>0,worldSurfaceY:()=>0,
  getHeldWorldPosition:()=>({x:.5,y:1.15,z:.5}),
  canOccupyAt:opts.deps.canOccupyAt,
  makeFlaskProjectile:()=>null,
});
state.coverTop=Infinity;
assert(window.AlchemyFlasks.beginAim(),'the actual flask action enters aim while cover is present');
assert(window.AlchemyFlasks.setTarget(8.5*64,.5*64),'the actual flask action accepts distant input');
const actualAim = window.AlchemyFlasks.diagnostics(); // Preview source used by the live ring.
const actualRing = flaskScene.children.find(item=>item.userData?.throwCoverOutline);
assert(actualAim.coverBlocked,'the real flask aim reports cover rather than ignoring the resolver');
assert(actualRing,'the actual flask ring carries its black outline');
assert(Math.abs(actualRing.position.x-actualAim.target.x/64)<1e-6,
  'the visible ground reticle is placed at the clipped aim point');
assert(actualRing.position.x<2.9,'real aiming stops before high cover');
assert(window.AlchemyFlasks.confirmThrow(),'the real flask can confirm the same clipped aim');
window.AlchemyFlasks.update(.28);
assert.equal(flaskInventory.testThrow,1,'release consumes exactly one flask');
const launched = flaskScene.children.find(item=>item instanceof flaskThree.Group);
assert(launched,'release creates a real projectile group');
const travel=window.AlchemyFlasks.flightDuration(actualRing.position.x-.5);
const ratio=Math.min(1,.28/travel);
const expectedX=.5+(actualRing.position.x-.5)*ratio;
assert(Math.abs(launched.position.x-expectedX)<0.03,
  'the launched flask follows the reticle-clipped endpoint, not the original distant aim');
state.coverTop=null;

console.log('Shared thrown-cover clipping, flight sweep, and black-ring-outline regression passed.');

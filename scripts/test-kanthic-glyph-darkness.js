'use strict';
// node scripts/test-kanthic-glyph-darkness.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const original=fs.readFileSync('docs/js/cloud-forest-fog.js','utf8'); // The test instruments the production compositor rather than recreating it.
const fog=original.replace('  function ordinaryBuildingInterior(area) {',
  '  window.__probeGlyphMasks=(scene,deps,now=2000)=>{lightingDeps=deps;drawRuinPatternGlowMasks(scene,now);return {...ruinGlowStats};};\n  function ordinaryBuildingInterior(area) {');
assert.notEqual(fog,original,'test hook must be inserted into the production source');
new vm.Script(fog,{filename:'cloud-forest-fog.js'});

class Vec {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  applyMatrix4(){return this;} // The identity world matrix makes texture-to-screen expectations exact.
  setFromMatrixColumn(){return this.set(1,0,0);}
  sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z);}
  length(){return Math.hypot(this.x,this.y,this.z);}
  multiplyScalar(scale){return this.set(this.x*scale,this.y*scale,this.z*scale);}
  dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;}
}
let tradition='kanthic'; // Switches between the new precise Kanthic rule and the unchanged Hronal rule.
let blockedByStone=false; // The fake Three.js raycaster exercises the real glyph-occlusion path without a GPU.
class Raycaster {
  set(){}
  intersectObjects(casters,recursive,hits){if(blockedByStone&&casters.length)hits.push({distance:1,object:casters[0]});return hits;}
}
const win={THREE:{Vector3:Vec,Raycaster,RepeatWrapping:1000},WeatherFX:{init(){}},DevRandomRuinLichThemes:{activeTheme:()=>tradition}};
vm.runInNewContext(fog,{window:win,performance:{now:()=>2000},console});
const draws=[]; // All light-mask paints are recorded for assertions and mobile-neutral regression coverage.
const context={
  canvas:{width:500,height:500},globalCompositeOperation:'source-over',globalAlpha:1,
  save(){},restore(){},beginPath(){},rect(){},moveTo(){},lineTo(){},closePath(){},clip(rule){if(rule==='evenodd')draws.push({kind:'platform-clip',mode:this.globalCompositeOperation});},arc(){},fill(){draws.push({kind:'fill',mode:this.globalCompositeOperation});},
  transform(...args){draws.push({kind:'transform',args});},
  createPattern(img,mode){draws.push({kind:'pattern',mode,img});return {img,mode};},
  fillRect(...args){draws.push({kind:'tiles',mode:this.globalCompositeOperation,args});},
  drawImage(img){draws.push({kind:'image',mode:this.globalCompositeOperation,alpha:this.globalAlpha,img});},
  createRadialGradient(){draws.push({kind:'gradient'});return {addColorStop(){}};},
};
const camera={matrixWorld:{},near:0.01,far:100,
  getWorldPosition(v){return v.set(-20,0,0);},
  getWorldDirection(v){return v.set(1,0,0);}};
const deps={lctx:context,camera,getCurrentArea:()=> 'map_i_dev_random_ruin',getPlayerWorldY:()=>0,
  getThreeRect:()=>({width:500,height:500}),worldToOverlay:(x,y,z)=>({x:100+x*10,y:100+z*10})};
const image={width:16,height:16}; // Engraving atlas coverage is what the compositor must use, not a radial gradient.
const positions={array:new Float32Array([1,1,1, 3,1,1, 1,1,3]),count:3};
const uvs={array:new Float32Array([0,1, 1,1, 0,0]),count:3};
const geometry={boundingSphere:{center:new Vec(1.5,1,1.5),radius:2},
  getAttribute(name){return name==='position'?positions:name==='uv'?uvs:null;}};
const mesh={name:'engraving-glyph-glow',isMesh:true,visible:true,userData:{},
  matrixWorld:{getMaxScaleOnAxis:()=>1},geometry,
  material:{visible:true,opacity:.8,map:{image,flipY:true}},
  updateWorldMatrix(){},getWorldPosition(v){return v.set(1.5,1,1.5);}};
const scene={traverse(cb){cb(mesh);}};mesh.parent=scene;
function draw(){draws.length=0;return win.__probeGlyphMasks(scene,deps);}
const lit=draw();
assert.equal(lit.found,1,'real additive engraving layer is discovered');
assert.equal(lit.drawn,1,'engraving gets a visible darkness exemption');
assert.equal(lit.triangles,1,'three screen-projected glyph vertices form one alpha mask triangle');
assert.equal(draws.filter(d=>d.kind==='image').length,1,'texture alpha is the sole Kanthic darkness mask');
assert.equal(draws.find(d=>d.kind==='image').mode,'destination-out','atlas alpha clears only the engraved pixels');
assert.equal(draws.find(d=>d.kind==='image').alpha,.8,'authored emissive intensity controls the exemption strength');
assert(!draws.some(d=>d.kind==='gradient'||d.kind==='fill'),'Kanthic glyphs create no radial reveal or colored light halo');
const wall={name:'shaft-hub-feature-wall',isMesh:true,geometry:{},visible:true,userData:{cameraObstacle:true},material:{visible:true,opacity:1}};
const blockedScene={traverse(callback){callback(mesh);callback(wall);}};mesh.parent=blockedScene;wall.parent=blockedScene;
blockedByStone=true;
draws.length=0;
const hidden=win.__probeGlyphMasks(blockedScene,deps,4000);
assert.equal(hidden.drawn,0,'physically occluded glyphs cannot punch through the darkness overlay');
assert.equal(hidden.triangles,0,'a wall-hidden engraving submits no texture triangles');
assert.equal(draws.length,0,'no 2D light mask is painted for the wall-hidden glyph');
const projectedOnscreen=deps.worldToOverlay; // Restore the authored camera mapping after testing offscreen occlusion cost.
deps.worldToOverlay=(x,y,z)=>({x:100000+x*10,y:100000+z*10});
const offscreen=win.__probeGlyphMasks(blockedScene,deps,6000);
assert.equal(offscreen.drawn,0,'offscreen runes never clear the darkness');
assert.equal(win.CloudForestFog.getDebugState().ruinEngravingGlowMasks.occlusionChecks,0,
  'offscreen runes are culled before any expensive 3D stone occlusion rays');
deps.worldToOverlay=projectedOnscreen;
blockedByStone=false;mesh.parent=scene;
assert.equal(draw().drawn,1,'the real glyph reappears once its physical surface is unobstructed');
const transform=draws.find(d=>d.kind==='transform').args;
assert(Math.abs(transform[0]-1.25)<1e-6&&Math.abs(transform[3]-1.25)<1e-6,
  'UV atlas scales to the actual triangle in screen pixels');
assert(Math.abs(transform[4]-110)<1e-6&&Math.abs(transform[5]-110)<1e-6,
  'cutout is positioned on the wall glyph, not around its center');
// A raised walkable shaft slab hides only the overlapping pixels of a much larger wall rune.
// Its non-BoxGeometry tests the real TileSpan case, which replaces the source slab geometry.
const platform={name:'jump-f0-2-stone',visible:true,isMesh:true,userData:{ruinShaftPlatform:true},
  geometry:{boundingBox:{min:new Vec(.5,.3,1),max:new Vec(1.6,.7,2)}},
  matrixWorld:{},updateWorldMatrix(){}};
const platformScene={traverse(callback){callback(mesh);callback(platform);}};
mesh.parent=platformScene;platform.parent=platformScene;
draws.length=0;
const partial=win.__probeGlyphMasks(platformScene,deps,7000);
assert.equal(partial.drawn,1,'the visible part of an engraved wall survives an overlapping platform');
assert.equal(partial.triangles,1,'partial platform coverage does not discard the entire wall triangle');
assert.equal(win.CloudForestFog.getDebugState().ruinEngravingGlowMasks.platformCandidates,1,
  'the compositor discovers real shaft slabs even after TileSpan replaces their BoxGeometry');
assert.equal(win.CloudForestFog.getDebugState().ruinEngravingGlowMasks.platformClips,1,
  'a projected slab silhouette subtracts only the obscured part of a wall glyph');
assert(draws.some(d=>d.kind==='platform-clip'&&d.mode==='destination-out'),
  'partial occlusion is applied to the destination-out glyph ink, not the entire scene lighting');
platform.visible=false;draws.length=0;
assert.equal(win.__probeGlyphMasks(platformScene,deps,7100).drawn,1,'a hidden platform does not erase the visible wall glyph');
assert(!draws.some(d=>d.kind==='platform-clip'),'a hidden upper story never generates a platform cutout');
platform.visible=true;
platform.geometry.boundingBox.min.x=4;platform.geometry.boundingBox.max.x=5;
const regularProjection=deps.worldToOverlay;
deps.worldToOverlay=(x,y,z)=>({x:100+z*10+x*.1,y:100+y*10}); // Preserve a nonzero projected radius while comparing depth-aligned overlapping silhouettes.
draws.length=0;
assert.equal(win.__probeGlyphMasks(platformScene,deps,7200).drawn,1,'a slab farther away than the wall leaves the wall glyph visible');
assert(!draws.some(d=>d.kind==='platform-clip'),'slabs behind the wall must not be treated as foreground cover');
deps.worldToOverlay=regularProjection;
mesh.parent=scene;
mesh.visible=false;
assert.equal(draw().drawn,0,'hidden wall sections must not cut through darkness');
mesh.visible=true;
mesh.material.map.image=null;
assert.equal(draw().drawn,0,'unloaded or disposed atlases make no fake light');
mesh.material.map.image=image;
positions.array[0]=-30;positions.array[3]=-30;positions.array[6]=-30;
assert.equal(draw().drawn,0,'engraving behind the camera cannot project a giant mask');
positions.array[0]=1;positions.array[3]=3;positions.array[6]=1;
mesh.name='ruin-ladder-rune-glow';mesh.userData.ruinLadderRuneGlow=true;
mesh.material.map.wrapS=1000;mesh.material.map.wrapT=1000;
uvs.array[5]=-4; // Long etched ladder strips must repeat the PNG many times, not stop at the first tile.
const ladder=draw();
assert.equal(ladder.drawn,1,'repeat-wrapped ladder rune is exposed through Kanthic darkness');
assert(draws.some(d=>d.kind==='tiles'&&d.mode==='destination-out'),'the rune shape repeats using the image alpha');
assert(!draws.some(d=>d.kind==='image'||d.kind==='gradient'||d.kind==='fill'),'rune repetition emits no radial halo or separate lighting');
assert.equal(draws.filter(d=>d.kind==='pattern').length,1,'the PNG is converted into a repeating mask pattern once');
draw();
assert.equal(draws.filter(d=>d.kind==='pattern').length,0,'the image pattern stays cached across overlay redraws');
mesh.name='engraving-glyph-glow';delete mesh.userData.ruinLadderRuneGlow;
mesh.material.map.wrapS=undefined;mesh.material.map.wrapT=undefined;uvs.array[5]=0;

context.globalAlpha=.6; // The darkness compositor may run inside an inherited canvas opacity.
const pulsed=draw();
assert.equal(pulsed.examined,1,'one visible triangle costs exactly one unit of the work budget');
assert(Math.abs(draws.find(d=>d.kind==='image').alpha-.48)<1e-8,'glyph pulse multiplies, rather than replaces, the existing canvas opacity');
assert.equal(context.globalAlpha,.6,'glyph mask restores the caller\'s alpha');
context.globalAlpha=1;
win.RuinRoomSystem={lightAllowed:()=>true,withLightClip(){}}; // A sealed room can skip the draw callback entirely.
assert.equal(draw().drawn,0,'room clipping must reject the glyph');
assert.equal(win.__probeGlyphMasks(scene,deps).examined,0,'a rejected callback cannot reuse a previous mesh triangle count');
delete win.RuinRoomSystem;
const repeatedTriangles=1002;
const originalPositions=positions.array,originalUvs=uvs.array,originalPositionCount=positions.count,originalUvCount=uvs.count;
positions.array=new Float32Array(repeatedTriangles*9);uvs.array=new Float32Array(repeatedTriangles*6);
for(let n=0;n<repeatedTriangles;n++){
  positions.array.set([1,1,1,3,1,1,1,1,3],n*9);
  uvs.array.set([0,1,1,1,0,0],n*6);
}
positions.count=repeatedTriangles*3;uvs.count=repeatedTriangles*3;
const capped=draw();
assert.equal(capped.examined,960,'Kanthic bounds inspected geometry, not merely triangles actually painted');
assert.equal(capped.triangles,960,'at most 960 textured triangles are submitted in one darkness refresh');
assert.equal(draws.filter(d=>d.kind==='image').length,960,'overlapping faces cannot bypass the work budget');
positions.array=originalPositions;uvs.array=originalUvs;positions.count=originalPositionCount;uvs.count=originalUvCount;

tradition='hronal'; // Non-Kanthic traditions preserve their existing soft atmospheric engraving glow.
assert.equal(draw().drawn,1,'other traditions still display wall patterns');
assert(draws.some(d=>d.kind==='gradient'),'Hronal retains the prior soft engraved-glow treatment');
assert(!draws.some(d=>d.kind==='image'),'the Kanthic-only correction does not change Hronal engraving rendering');
assert(original.includes('const mistActive = active;'),'the Kanthic room must use actual Cloud Forest mist geometry');
assert(original.includes("ruinTradition === 'kanthic' ? 0.32 : 1"),'the player lantern is less than one tile in Kanthic');
console.log('Kanthic depth-occluded glyph masks, real fog, tiny player lantern, repeat-wrapped runes and other ruins: PASS');

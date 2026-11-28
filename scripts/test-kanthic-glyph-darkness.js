'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/cloud-forest-fog.js','utf8');
const fog=source.replace('  function ordinaryBuildingInterior(area) {',
  '  window.__glyphTest=(deps,paint)=>{lightingDeps=deps;drawUnifiedLightingOverlay=()=>{paint();lastUnifiedLightingDraw=123;unifiedLightingPaintRevision=1;};window.WeatherFX.drawLightingOverlay=drawUnifiedLightingOverlay;};\n  function ordinaryBuildingInterior(area) {');
assert.notEqual(fog,source);
class Vec{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  applyMatrix4(){return this;}
  transformDirection(){return this;}
}
class Box{copy(b){this.min=b.min;this.max=b.max;return this;}applyMatrix4(){return this;}}
class Plane{constructor(normal,constant){this.normal=normal;this.constant=constant;}}
class Scene{
  constructor(){this.children=[];this.fog=null;}
  add(o){this.children.push(o);o.parent=this;}
  remove(o){this.children.splice(this.children.indexOf(o),1);o.parent=null;}
  traverse(fn){fn(this);for(const o of this.children)fn(o);}
}
class Layers{constructor(){this.mask=0xffffffff;}set(bit){this.mask=1<<bit;}}
class Camera{constructor(){this.layers=new Layers();}}
class Mesh{
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.visible=true;this.isMesh=true;this.matrix={copy(){}};this.matrixWorld={};this.layers=new Layers();}
}
class Points extends Mesh{constructor(g,m){super(g,m);this.isMesh=false;this.isPoints=true;this.userData={};}}
class Texture{constructor(image){this.image=image;}}
class Shader{constructor(o){Object.assign(this,o);}}
let tradition='kanthic',area='map_i_dev_random_ruin',region='room:a',fade=0,paintCount=0,depthCount=0;
let worldFrameOpen=false,poseHook=null; // Simulate the real RenderHooks bracket without a WebGL context.
const bounds=(minX,maxX,minY=-Infinity,maxY=Infinity)=>({minX,maxX,minY,maxY,minZ:0,maxZ:5});
const regions={'room:a':bounds(0,5,-1,5),'room:b':bounds(5,10,-1,5),shaft:bounds(10,20)};
const roomSystem={activeGlyphRegion:()=>region,glyphRegionBounds:id=>regions[id]};
const win={THREE:{Vector3:Vec,Box3:Box,Plane,Scene,Mesh,Points,CanvasTexture:Texture,ShaderMaterial:Shader,Camera,PlaneGeometry:class{}},
  WeatherFX:{init(){}},DevRandomRuinLichThemes:{activeTheme:()=>tradition},RuinRoomSystem:roomSystem,
  RenderHooks:{ORDER:{PLAYER_BODY_COMPOSER:800},register:hook=>{poseHook=hook;},isWorldFrameOpen:()=>worldFrameOpen},
  PngPlaneOutlineOccluder:{renderDepth(){depthCount++;}}};
vm.runInNewContext(fog,{window:win,performance:{now:()=>2000},console});
const api=win.CloudForestFog,canvas={width:500,height:500,style:{visibility:''}};
const deps={lctx:{canvas},getCurrentArea:()=>area,getPlayerWorldY:()=>0,getSceneTransAlpha:()=>fade};
win.__glyphTest(deps,()=>paintCount++);
function glyph(x,y=1,halfWidth=1,halfHeight=1){
  const mesh=new Mesh({boundingBox:{min:new Vec(x-halfWidth,y-halfHeight,0),max:new Vec(x+halfWidth,y+halfHeight,2)},boundingSphere:{center:new Vec(x,y,1),radius:1}}, {map:{},visible:true,depthTest:true,opacity:1});
  mesh.name='engraving-glyph-glow';mesh.updateWorldMatrix=()=>{};return mesh;
}
const scene=new Scene(),a=glyph(1),b=glyph(7),shaft=glyph(12),high=glyph(13,20),broad=glyph(5,1,3);
const ladder=glyph(2);ladder.name='ladder';ladder.userData={ruinLadderRuneGlow:true};
for(const mesh of [a,b,shaft,high,ladder,broad])scene.add(mesh);
const calls=[],camera=new Camera(),renderer={autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,localClippingEnabled:false,render(s,c){assert.equal(this.autoClear,false,'preserve world depth for both draws');assert.equal(this.autoClearDepth,false,'Color backgrounds must not force depth clears');assert.equal(this.autoClearColor,false);assert.equal(this.autoClearStencil,false);assert.equal(c.layers.mask,1<<7,'auxiliary passes never trigger the base-world x-ray replay');const visible=s.children.filter(o=>o.visible);if(s.name==='kanthic_room_glyph_depth'){assert.equal(s.fog,null,'runes pierce the black outer fog, but retain depth testing');assert.equal(this.localClippingEnabled,true);assert(visible.every(o=>o.material.clippingPlanes.length>=4));}calls.push(visible);}};
function frame(now,direct=false){
  calls.length=0;
  assert.equal(api.prepareKanthicGlyphFrame(scene,now),true);
  assert([a,b,shaft,high,ladder,broad].every(m=>!m.visible),'off-room glow and duplicate base-pass glow sleep');
  const beforeRenderPaints=paintCount;
  const ready=api.hasKanthicLightingPass();
  const result=api.renderKanthicGlyphFrame(renderer,camera,scene,direct);
  if(!api.getDebugState().ruinEngravingGlowMasks.lastError)assert.equal(ready,result,'shared readiness gate predicts GPU darkness draw');
  assert.equal(paintCount,beforeRenderPaints,'lighting and potential surface repair must finish before the world depth is bound');
  api.endKanthicGlyphFrame();
  assert([a,b,shaft,high,ladder,broad].every(m=>m.visible),'render-only visibility restores');
  assert.equal(renderer.autoClear,true);assert.equal(renderer.autoClearDepth,true);assert.equal(renderer.autoClearColor,true);assert.equal(renderer.autoClearStencil,true);assert.equal(renderer.localClippingEnabled,false);assert.equal(camera.layers.mask,0xffffffff,'camera mask restores');
  assert([a,b,shaft,high,ladder,broad].every(m=>m.material.clippingPlanes===undefined),'borrowed materials restored');
  return result;
}
assert.equal(frame(2000),true);
assert.equal(calls.length,2,'one darkness quad plus one room-only depth draw');
assert.equal(calls[1].length,3,'occupied room, ladder and shared wall are submitted with fragment clipping');
assert(calls[1].every(p=>p.material.depthTest));
assert.equal(canvas.style.visibility,'hidden','do not apply the same darkness twice');
assert.equal(api.getDebugState().ruinEngravingGlowMasks.textureUploads,1);
frame(2010);
assert.equal(api.getDebugState().ruinEngravingGlowMasks.textureUploads,1,'unchanged canvas is not uploaded again');
assert.equal(api.getDebugState().ruinEngravingGlowMasks.scans,1,'unchanged chamber does not traverse the scene');
region='room:b';assert.equal(frame(2020,true),true);
assert.equal(api.getDebugState().ruinEngravingGlowMasks.scans,1,'room transitions use the cached ownership index');
assert.equal(calls[1].length,2);assert(calls[1].some(p=>p.material===b.material));assert.equal(depthCount,1);
region='shaft';assert.equal(frame(2030),true);
assert.equal(calls[1].length,2,'shaft includes the tall wall even when its center is above the player');
assert.equal(calls[1][0].material,shaft.material);
// A lit canonical particle emitter participates even in a room with no glyphs.
regions['room:fire']=bounds(30,35,-1,5);region='room:fire';
const flame=new Points({}, {visible:true,depthTest:true});
flame.userData.hobunjiFlameBoundsRadius=1;
const halo={visible:true};
const anchor={visible:true,children:[flame,halo],getWorldPosition:v=>v.set(32,1,2)};
scene.add(anchor);flame.parent=anchor;halo.parent=anchor;
const fireLight={x:32,y:1,z:2,active:true,flameAnchor:anchor,flameHalo:halo};
win.RuinMultifloorV50Style={lightSources:()=>[fireLight]};
const nativeRender=renderer.render;
renderer.render=function(s,c){if(s.name==='kanthic_room_glyph_depth'){assert.equal(flame.visible,false);assert.equal(halo.visible,false);}nativeRender.call(this,s,c);};
assert.equal(frame(2031),true);assert.equal(calls[1].length,1);assert(calls[1][0].isPoints);assert.equal(calls[1][0].geometry,flame.geometry);
assert.equal(flame.visible,true);assert.equal(halo.visible,true);assert.equal(api.getDebugState().ruinEngravingGlowMasks.flamesDrawn,1);
fireLight.active=false;renderer.render=nativeRender;assert.equal(frame(2032),false,'unlit brazier does not force the GPU darkness pass');
// A conservative sphere culls the whole emitter without reading sentinel positions.
let flameInView=false;
win.THREE.Frustum=class{setFromProjectionMatrix(){} intersectsObject(){return true;} intersectsSphere(s){assert.equal(s.center.x,32);assert.equal(s.radius,1);return flameInView;}};
win.THREE.Matrix4=class{multiplyMatrices(){return this;}};
win.THREE.Sphere=class{constructor(){this.center=new Vec();}};
camera.isCamera=true;fireLight.active=true;
calls.length=0;api.prepareKanthicGlyphFrame(scene,2033,camera);
assert.equal(flame.visible,false,'offscreen particles skip the base pass too');
assert.equal(api.hasKanthicLightingPass(),false,'offscreen flame alone cannot trigger a GPU darkness draw');
assert.equal(api.getDebugState().ruinEngravingGlowMasks.flamesCulled,1);
api.endKanthicGlyphFrame();assert.equal(flame.visible,true);
flameInView=true;api.prepareKanthicGlyphFrame(scene,2034,camera);
assert.equal(api.hasKanthicLightingPass(),true,'returning to view immediately restores the emission pass');
assert.equal(api.renderKanthicGlyphFrame(renderer,camera,scene),true);api.endKanthicGlyphFrame();
assert.equal(flame.visible,true);assert.equal(flame.material.clippingPlanes,undefined);
fireLight.active=true;region=null;assert.equal(frame(2040),false);assert.equal(calls.length,0);
assert.equal(canvas.style.visibility,'','unassigned corridor uses ordinary darkness and no GPU glyph work');
region='room:a';fade=1;assert.equal(frame(2050),false);assert.equal(canvas.style.visibility,'');
fade=0;frame(2060);
const normalRender=renderer.render;renderer.render=function(s,c){if(s.name==='kanthic_room_glyph_depth')throw Error('injected depth failure');normalRender.call(this,s,c);};
assert.equal(frame(2065),false);assert.equal(api.getDebugState().ruinEngravingGlowMasks.lastError,'injected depth failure');
renderer.render=normalRender;assert.equal(frame(2066),true);
area='farm';assert.equal(api.prepareKanthicGlyphFrame(scene,2070),false);assert.equal(canvas.style.visibility,'');
area='map_i_dev_random_ruin';tradition='hronal';assert.equal(api.prepareKanthicGlyphFrame(scene,2080),false);
// The real player's named avatar must win over a carried child's valid neck rig.
{
tradition='kanthic';region=null;fireLight.active=false;
const playerRoot=new Scene(),avatar=new Scene(),child=new Scene();
avatar.name='player_avatar';child.name='carried_toddler';
const bodyPoint=new Vec(2,1,3),childPoint=new Vec(8,8,8);
const body={getWorldPosition:out=>out.copy(bodyPoint)},childPlane={getWorldPosition:out=>out.copy(childPoint)};
avatar.userData={neckRig:{skinnedPlane:body}};child.userData={neckRig:{skinnedPlane:childPlane}};
avatar.add(body);child.add(childPlane);playerRoot.add(child);playerRoot.add(avatar);scene.add(playerRoot);
win.PlayerBodyTransformComposer={getPlayerMesh:()=>playerRoot};
deps.player={x:2,y:3};deps.TILE=1;deps.getActiveScene=()=>scene;deps.getThreeRect=()=>({width:500,height:500});
deps.camera=camera;camera.getWorldPosition=out=>out.set(0,1,3);camera.getWorldDirection=out=>out.set(0,0,-1);
camera.matrixWorld={elements:Array.from({length:16},(_,i)=>i%5===0?1:0)};
camera.projectionMatrix={elements:camera.matrixWorld.elements.slice()};
const anchor=()=>api.getDebugState().kanthicCameraAtmosphere.lantern;
function prepOnly(now){api.prepareKanthicGlyphFrame(scene,now,camera);api.endKanthicGlyphFrame();}
prepOnly(2100);assert.equal(anchor().x,2);assert.equal(anchor().anchor,'portrait-plane');
playerRoot.remove(avatar);prepOnly(2110);
assert.equal(anchor().anchor,'ground-fallback','a carried toddler is never selected as the player during a rebuild');
assert.equal(anchor().y,.5);
playerRoot.add(avatar);prepOnly(2120);assert.equal(anchor().y,1);
let paints=paintCount;prepOnly(2130);assert.equal(paintCount,paints,'unchanged camera and avatar retain the existing mask');
camera.matrixWorld.elements[0]=.9;prepOnly(2140);
assert.equal(paintCount,++paints,'camera roll invalidates the mask even with an unchanged forward ray');
camera.projectionMatrix.elements[8]=.2;prepOnly(2150);
assert.equal(paintCount,++paints,'off-axis projection invalidates without changing the camera position or FOV');
// The frame-scoped compositor changes and restores the avatar around a native draw.
let repairs=0,bound=false;
win.WeatherFX.ensurePresentationSurface=()=>{assert(!bound,'no renderer repair with world depth bound');repairs++;return {rect:deps.getThreeRect()};};
worldFrameOpen=true;
api.prepareKanthicGlyphFrame(scene,2160,camera);
assert.equal(paintCount,paints,'world-frame preparation repairs surfaces but defers the actual mask paint');
assert.equal(repairs,1);
bound=true;bodyPoint.y=1.8;
const hookCtx={scene,camera,worldScene:true};
assert(poseHook.appliesTo(hookCtx));poseHook.afterRender(hookCtx);assert.equal(anchor().y,1.8);
assert(!poseHook.appliesTo(hookCtx),'auxiliary passes cannot overwrite the captured pose');
bodyPoint.y=1;
assert.equal(api.renderKanthicGlyphFrame(renderer,camera,scene),false,'unassigned corridor retains the DOM darkness fallback');
assert.equal(paintCount,++paints,'one final paint even without glyphs');
assert.equal(anchor().y,1.8,'render rollback cannot overwrite the displayed anchor');
bound=false;api.endKanthicGlyphFrame();worldFrameOpen=false;
}
const rooms=require('../docs/js/ruin-room-system.js');
let player={x:2,z:2},py=0;
const session=rooms.mount({layout:{shaft:{x:10,z:10,w:10,d:10},rooms:[
  {id:'ground',x:0,z:0,w:5,d:5,y:0},{id:'upper',x:0,z:0,w:5,d:5,y:16}
]},getPlayerPosition:()=>player,getPlayerY:()=>py});
assert.equal(rooms.activeGlyphRegion(),'room:ground');
py=16;assert.equal(rooms.activeGlyphRegion(),'room:upper','overlapping stories have separate owners');
assert(rooms.glyphRegionBounds('room:upper').minY>rooms.glyphRegionBounds('room:ground').maxY);
player={x:12,z:12};assert.equal(rooms.activeGlyphRegion(),'shaft');
py=0;assert.equal(rooms.activeGlyphRegion(),'shaft','the vertical shaft is one region');
player={x:7,z:7};assert.equal(rooms.activeGlyphRegion(),null,'unassigned corridors are not the shaft');
session.dispose();assert.equal(rooms.activeGlyphRegion(),null);assert.equal(rooms.glyphRegionBounds('shaft'),null);
const pipeline=fs.readFileSync('docs/js/world-render-pipeline.js','utf8');
assert(pipeline.includes('prepareKanthicGlyphFrame?.(activeScene,now,camera)'));
assert(pipeline.includes('endKanthicGlyphFrame?.()'));
assert.equal((pipeline.match(/renderKanthicGlyphFrame\?\.\(/g)||[]).length,2,'both outline paths share the depth pass');
assert(!source.includes('ruinGlowRaycaster')&&!source.includes('drawRuinGlyphSilhouette'),'remove the expensive and inaccurate Canvas2D glyph reconstruction');
console.log('Kanthic glyphs: occupied room/shaft, depth-preserving render, no cross-room masks, cached uploads, cleanup and direct-render parity OK');

#!/usr/bin/env node
'use strict';
// Real route graph -> authored exterior cave gate -> world transition -> timed
// instrument -> return to correct elevated balcony. No browser/WebGL required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

class SceneObject {
  constructor(){this.children=[];this.parent=null;this.userData={};this.visible=true;
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation={x:0,y:0,z:0};
    this.scale={x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;},setScalar(n){this.set(n,n,n);}};}
  add(child){child.parent?.remove?.(child);this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(p=>p!==child);if(child.parent===this)child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse?.(fn);}
  getObjectByName(name){return this.children.find(child=>child.name===name)||null;}
  translateZ(n){this.position.z+=n;}
}
class Group extends SceneObject {}
class Mesh extends SceneObject {constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
class Material {
  constructor(opts={}){this.color={hex:opts.color,setHex(v){this.hex=v;}};this.map=opts.map;}
  dispose(){this.disposed=true;}
}
class Geometry {dispose(){this.disposed=true;}}
const THREE={Group,Mesh,MeshBasicMaterial:Material,CylinderGeometry:Geometry,PlaneGeometry:Geometry,
  TextureLoader:class{load(name){return {name};}},DoubleSide:2,SRGBColorSpace:'srgb'};
const handlers=new Map(); // Browser-like instrument event delivery used by the actual exterior melody controller.
const context={console,THREE,Math,Promise,Number,Map,Set,Date,
  addEventListener:(type,handler)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(handler);},
  removeEventListener:(type,handler)=>handlers.get(type)?.delete(handler),
  __farmLog:()=>{},
};
context.window=context;context.globalThis=context;
function load(file) {
  const module={exports:{}};context.module=module;
  vm.runInNewContext(read(file),context,{filename:file});
  return module.exports;
}
context.CliffRouteNetwork=load('docs/js/cliff-route-network.js');
context.PuzzleCaveMelody=load('docs/js/puzzle-cave-melody.js');
context.LocaleCliffWallMounts=load('docs/js/locale-cliff-wall-mounts.js');
const Exterior=load('docs/js/puzzle-cave-entrances.js');

const grid=Array.from({length:28},()=>Array.from({length:14},(_,col)=>({
  type:col===6?'rock':'grass',incline:col===6,elevTier:col<6?0:1,
})));
const area='map_test_cliffs',mapId='map_i_den_map_test_cliffs_den1';
const network=context.CliffRouteNetwork.build(grid,{area,
  tileY:tile=>(tile.elevTier||0)*9,blocked:tile=>!tile||tile.incline||tile.type==='rock'});
assert(network.balconies.length>0,'the real cliff route planner generates a valid mini-cliff');
const site=index=>({contents:'puzzle_cave',mapId,denId:'den1',signature:'cave-outdoor-'+index,
  mouthAnchor:{x:4,y:9}});
let profile=null,selected=null;
for(let i=0;i<30;i++){
  const trial=Exterior.plan(network,[site(i)]);
  if(trial[0]?.requiresSong){profile=site(i);selected=trial[0];break;}
}
assert(selected,'some cave entrances require an outdoor score');
assert(context.CliffRouteNetwork.shelfContains(selected.shelf,selected.plate.x,selected.plate.z,-.1),
  'the exterior pressure plate rests on the actual raised mini-cliff top');
assert(Math.hypot(selected.entry.c+.5-selected.plate.x,selected.entry.r+.5-selected.plate.z)>.55,
  'player can move from the plate onto the door tile after the last note');
assert.equal(Exterior.plan({...network,balconies:[]},[profile]).length,0,
  'no fictitious entrance is generated without a reachable mini-cliff');

let sampledPortals=0; // Multi-seed cliff outlines catch irregular mini-cliffs that would strand the exterior pressure plate.
for(let seed=0;seed<12;seed++){
  const edgeCol=5+(seed%5);
  const variedGrid=Array.from({length:48},()=>Array.from({length:36},(_,col)=>({
    type:col===edgeCol?'rock':'grass',incline:col===edgeCol,elevTier:col<edgeCol?0:1,
  })));
  const varied=context.CliffRouteNetwork.build(variedGrid,{
    area:'map_ledge_test_'+seed,tileY:tile=>(tile.elevTier||0)*(7+seed%6),
    blocked:tile=>!tile||tile.incline||tile.type==='rock',
  });
  const requests=Array.from({length:8},(_,index)=>({
    contents:'puzzle_cave',mapId:'map_ledge_cave_'+seed+'_'+index,denId:'den'+index,
    signature:'ledge-'+seed+'-'+index,mouthAnchor:{x:1+(index%3),y:2+5*index},
  }));
  for(const p of Exterior.plan(varied,requests)){
    sampledPortals++;
    assert(context.CliffRouteNetwork.shelfContains(p.shelf,p.plate.x,p.plate.z,-.13),
      'the music plate must stay inside the actual irregular balcony polygon');
    assert(p.shelf.footprint.some(cell=>cell.c===Math.floor(p.plate.x)&&cell.r===Math.floor(p.plate.z)),
      'the music plate must stand above a real registered balcony tile');
    assert(Math.hypot(p.plate.x-p.entry.c-.5,p.plate.z-p.entry.r-.5)>.65,
      'the music plate cannot overlap the world transition activation tile');
  }
}
assert(sampledPortals>=12,'multiple generated balcony shapes and heights were exercised');

const scene=new Group();scene.name='zone-scene';
const denFacades=new Group();denFacades.name='animalDenEntrances'; // Scene's existing animal-den entrance meshes must reappear when the mini-cliff portal is retired.
const originalFacade=new Mesh(new Geometry(),new Material({color:0x888888}));
originalFacade.userData.denId='den1';denFacades.add(originalFacade);scene.add(denFacades);
const entranceRing=new Mesh(new Geometry(),new Material({color:0xeac86a})); // Cached scene's original ground-level entrance marker must be restored on cliff regeneration.
entranceRing.userData.mapEditorRef={kind:'spot',id:'den_den1_enter'};
entranceRing.position.set(4.5,.1,10.5);scene.add(entranceRing);
const den={id:'den1',x:3,y:8,w:3,h:3,mouthAnchor:{x:4,y:10}};
const layoutTransition={id:'den_den1_enter',col:4,row:10,target:'building',targetMapId:mapId};
const copiedTransition={...layoutTransition};
const zoneLayouts=new Map([[area,{dens:[den],transitions:[layoutTransition]}]]);
const zoneScenes=new Map([[area,{scene,transitions:[copiedTransition]}]]);
const player={x:0,y:0,onCliffBalcony:null,climbing:false};
let activeArea=area,opened=0,closed=0;
context.MusicMinigame={beginPlayerSession(){opened++;return true;},close(){closed++;}};
const saved=new Map(); // Persistent site state shared between scene lifetimes.
context.CaveSiteSystem={
  exteriorPuzzleState:id=>saved.get(id)||{solved:false,tier:1},
  markExteriorPuzzleSolved:(id,tier)=>{if(saved.get(id)?.solved)return false;saved.set(id,{solved:true,tier});return true;},
  sitesForZone:()=>[profile],
};
const blockers=new Map();
context.DynamicSurfaces={
  registerBlocker:o=>blockers.set(o.id,o),remove:id=>blockers.delete(id),
};
context.AuthoredFurniture={
  load:async key=>({key,puzzle:{motion:{parts:{cliff_door_slab:{
    off:{y:.54,sz:1.0805},on:{y:1.0851,sz:.001},
  }}}}}),
  buildGroup:()=>{
    const group=new Group(),slab=new Mesh(new Geometry(),new Material({color:0x777777}));
    group.userData.meshById=new Map([['cliff_door_slab',slab]]);
    group.add(slab);return group;
  },
};
Exterior.init({zoneLayouts,zoneScenes,player,TILE:64,getCurrentArea:()=>activeArea});
const [gate]=Exterior.mount(area,network,scene);
assert(gate&&gate.requiresSong,'a real supported ledge owns one outdoor music puzzle');
assert.equal(originalFacade.visible,false,'the original den facade is concealed by the cliff door');
const lateFacade=new Mesh(new Geometry(),new Material({color:0x888888}));
lateFacade.userData.denId='den1';denFacades.add(lateFacade);
Exterior.update(.8,area);
assert.equal(lateFacade.visible,false,'newly loaded den facade meshes are also concealed by the mounted cliff door');
assert.equal(den.mouthAnchor.x,gate.entry.c,'a cave exit returns to the generated cliff entrance');
assert.equal(layoutTransition.target,'puzzle_cave_locked','unsolved cave entrance is not an actionable world transition');
assert.equal(copiedTransition.target,'puzzle_cave_locked','cached scene cannot bypass a locked cave');
assert.equal(layoutTransition.col,gate.entry.c);
assert.equal(blockers.size,1,'a real physical slab blocker is registered');
assert.equal(entranceRing.visible,false,'a locked gate hides its relocated cached entrance marker');
const blocker=[...blockers.values()][0];
assert(blocker.enabled(),'unsolved cliff-door collision blocks movement');
activeArea=mapId;
assert(!blocker.enabled(),'a locked cliff gate cannot block movement in a different map');
activeArea=area;
assert(!blocker.blocksAt(0,0,1,null,0,{y:gate.door.y-4}),
  'lower ground under the raised balcony is never blocked by a gate above it');
player.onCliffBalcony=gate.shelf.id;
player.x=gate.plate.x*64;player.y=gate.plate.z*64;
Exterior.update(.01,area);
assert.equal(opened,1,'stepping onto the plate enters the existing live instrument mode');
const song=gate.song;
let elapsed=0; // Musical clock advanced through the actual exterior controller's per-frame path.
for(const note of song.notes){
  const target=(note.startTick+.10)*song.secondsPerTick;
  while(elapsed<target-1e-8){
    const amount=Math.min(.04,target-elapsed);
    Exterior.update(amount,area);elapsed+=amount;
  }
  for(const handler of handlers.get('hobunji-kurraya-puzzle-note')||[])
    handler({detail:{area,noteIndex:note.index}});
}
assert(gate.solved,'the procedural one/two-measure outdoor score opens the gate');
assert(saved.get(mapId).tier>=1,'the outside difficulty tier persists with the cave signature');
player.x=(gate.entry.c+.5)*64;player.y=(gate.entry.r+.5)*64;
for(let i=0;i<30;i++)Exterior.update(.05,area);
assert(gate.rise>=.98,'the authored stone slab has completely risen');
assert.equal(layoutTransition.target,'building','the normal world transition is enabled at the raised doorway');
assert.equal(copiedTransition.target,'building','cached scene transition follows the same gate state');
assert(!blocker.enabled(),'physical collision opens along with the recorded transition');
activeArea=mapId;Exterior.update(.01,mapId);
activeArea=area;player.onCliffBalcony=null;
Exterior.update(.01,area);
assert.equal(player.onCliffBalcony,gate.shelf.id,'returning from the cavern restores the correct balcony elevation');
assert.equal(player.climbSurfaceY,gate.shelf.y);
Exterior.clear(area);
assert.equal(gate.shelf.puzzleCavePortal,undefined,'a retired cave portal releases its mini-cliff reservation');
assert.equal(originalFacade.visible,true,'retiring a cliff door restores the original den facade visibility');
assert.equal(lateFacade.visible,true,'retiring a cliff door restores later loaded den facade meshes');
assert.equal(layoutTransition.target,'building','scene retirement restores original transition type');
assert.equal(layoutTransition.col,4,'scene retirement restores original cave entrance tile');
assert.equal(den.mouthAnchor.x,4,'scene retirement restores the original den mouth');
assert.equal(blockers.size,0,'scene retirement unregisters physical slab collision');
assert.equal(entranceRing.position.x,4.5,'scene retirement restores the cached entrance marker X');
assert.equal(entranceRing.position.y,.1,'scene retirement restores the cached entrance marker elevation');
assert.equal(entranceRing.position.z,10.5,'scene retirement restores the cached entrance marker Z');
assert.equal((handlers.get('hobunji-kurraya-puzzle-note')||new Set()).size,0,
  'scene retirement removes the actual live flute event listener');

// Generic Locale Editor wall binding uses the SAME generated cliff route nodes.
const route=network.routes.find(route=>route.nodes?.length);
const center=route.nodes[Math.floor(route.nodes.length/2)];
const marker={id:'surface1',kind:'surface_placeholder',key:'unknownCliffFace',
  x:center.x-1,z:center.z, y:center.z-.5,w:2,h:1,visual:{renderer:'unknown_wall_plane'}};
const furniture={id:'fixture1',key:'cliffDoor',kind:'furniture',wallMountId:'surface1',
  visual:{mountHeightFraction:.5,mountOffsetY:.15},rot:0};
const face=context.LocaleCliffWallMounts.resolveFace(network,marker,furniture);
assert(face&&Number.isFinite(face.y),'unknown wall placeholder resolves to a real cliff-face node');
assert(Number.isFinite(face.rotation),'wall furniture faces out along the resolved cliff normal');
const wallScene=new Group();
const result=context.LocaleCliffWallMounts.mount(area,network,wallScene,
  [{objects:[marker,furniture]}]);
assert.equal(result.failed,0);
assert.equal(result.count,1,'world locates the explicitly associated wall fixture');
context.LocaleCliffWallMounts.clear(area);
console.log('Puzzle Cave exterior: real cliff planner, score, gate collision, transition, elevation return and unknown-wall binding PASS.');

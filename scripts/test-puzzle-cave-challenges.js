// Headless integration test of the REAL layered challenge composer, not only
// the isolated note judge. Stubs only THREE presentation and event delivery.
'use strict';
const assert=require('node:assert/strict');
const Song=require('../docs/js/puzzle-cave-melody.js'); // The authored procedural score and timing judge are the actual browser module.
const {compose}=require('../docs/js/ruin-layer-challenges.js'); // Same composed chamber code loaded in the game.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'); // Load the real game movement occupancy registry into a standalone test context.
const footprintContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../docs/js/area-footprint-blockers.js'),'utf8'),footprintContext);
const areaFootprints=footprintContext.window.AreaFootprintBlockers; // The same blocksBox(area,x,z,half,worldY) API used by game.js.

class Object3D {
  constructor(){this.children=[];this.parent=null;this.userData={};this.visible=true;this.position={x:0,y:0,z:0,
    set(x,y,z){this.x=x;this.y=y;this.z=z;}};}
  add(child){if(child.parent)child.parent.remove(child);this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(item=>item!==child);if(child.parent===this)child.parent=null;}
}
class Group extends Object3D {}
class Geometry {dispose(){this.disposed=true;}}
class Mesh extends Object3D {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class Material {
  constructor(opts={}){this.hex=opts.color;this.color={setHex:color=>{this.hex=color;}};}
  dispose(){this.disposed=true;}
}
const THREE={Group,Mesh,MeshBasicMaterial:Material,BoxGeometry:Geometry,CylinderGeometry:Geometry,
  ConeGeometry:Geometry,PlaneGeometry:Geometry,DoubleSide:2}; // Runtime-facing geometry and materials needed by composed Puzzle Caves.

function eventBus(){
  const listeners=new Map(); // Registered music events are removed when the cave scene is destroyed.
  return {
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
    dispatch(name,detail){for(const fn of listeners.get(name)||[])fn({detail});},
    count(name){return listeners.get(name)?.size||0;},
  };
}

const room={x:3,z:5,w:9,d:9};
const area='puzzle_cave_test';
const parent=new Group();
let activeArea=area; // Scoped collider test switches maps without unloading the cached cave scene.
const blockers=new Map(); // Minimal DynamicSurfaces adapter records and releases the ONE authoritative cave gate blocker.
const dynamicSurfaces={registerBlocker:record=>{assert(!blockers.has(record.id),'duplicate cave collider ID');blockers.set(record.id,record);},
  remove:id=>blockers.delete(id)};

let lit=0,completed=0;
const hot=new Set(); // Fire patches with the same area-scoped positions that PersistentGroundFire.intersects receives.
const torchEmitters=[]; // Stand-in for the shared authored campfire renderer; asserts both sconces reuse it and dispose it.
const puzzleFireVisuals={attachCampfireFlame(anchor,options){
  assert(anchor instanceof Group,'sconce flames use emitter anchors rather than triangle/cone geometry');
  assert(options.rateScale>0);
  const record={anchor,updates:0,disposed:false,update(){this.updates++;},dispose(){this.disposed=true;}};
  torchEmitters.push(record);return record;
}};
const fire=compose({THREE,parent,room,id:'fire-test',kind:'fireSconces',y:0,area,
  isActive:()=>activeArea===area,onSolved:()=>{completed++;},DynamicSurfaces:dynamicSurfaces,AreaFootprintBlockers:areaFootprints,
  groundFire:{intersects:(scope,x,z)=>scope===area&&hot.has(x+','+z)},puzzleFireVisuals,
  onSconceLit:()=>{lit++;},
  getPlayerPosition:()=>({x:0,z:0}),getPlayerY:()=>0,
});
assert.equal(fire.sconces.length,2);
assert.equal(torchEmitters.length,2,'two authored campfire emitters replace the old conical fire visuals');
assert(torchEmitters.every(record=>record.anchor.visible===false),'unlit torches do not emit fire');
assert.equal(blockers.size,1,'fire cave registers exactly one authoritative stone gate');
const fireCollider=[...blockers.values()][0];
assert(fireCollider.enabled(),'an unsolved fire cave gate blocks movement in its map');
const gateX=room.x+room.w/2,gateZ=room.z+room.d-1.28; // The collision target follows the rock-clearance offset of the authored gate.
assert(areaFootprints.blocksBox(area,gateX,gateZ,.18),'player movement physically collides with a locked fire-sconce gate');
assert(!areaFootprints.blocksBox('other_map',gateX,gateZ,.18),'other maps can use the same tile coordinates without colliding with this cave');
assert(!areaFootprints.blocksBox(area,gateX,gateZ,.18,10),'high projectiles pass over the short stone gate');
activeArea='other_map';
assert(!fireCollider.enabled(),'cached cave collision never leaks into another map');
activeArea=area;
fire.tick(.016);
assert.equal(completed,0,'unlit sconces cannot raise the stone gate');
hot.add(fire.sconces[0].x+','+fire.sconces[0].z);
fire.tick(.016);
assert.equal(lit,1,'actual ground fire lights the first sconce');
assert.equal(completed,0,'one live flame is insufficient');
hot.clear();
fire.tick(.016);
assert(fire.sconces[0].lit,'the first torch remains lit when its splash expires');
hot.add(fire.sconces[1].x+','+fire.sconces[1].z);
fire.tick(.016);
assert.equal(completed,1,'second torch unlocks the gate exactly once');
assert(fire.solved,'the shared challenge records the solve');
fire.animate(1);
assert(fire.door.position.y>1.75,'opening raises the physical stone slab visual');
assert.equal(fire.backdrop.visible,false,'the black doorway plane disappears once the chest can be revealed');
assert(!fireCollider.enabled(),'the collider opens only after the animated gate clears the threshold');
assert(!areaFootprints.blocksBox(area,gateX,gateZ,.18),'player movement also clears the opened stone gate');
fire.tick(.016);
assert.equal(completed,1,'a solved fire cave cannot award its treasure again');
fire.dispose();
assert(torchEmitters.every(record=>record.disposed),'cave teardown disposes both authored flame emitters');
assert.equal(blockers.size,0,'retiring the scene unregisters its physical collision');
assert.equal(areaFootprints.providerIds().length,0,'retiring the cave removes its authoritative player and NPC footprint blocker');
assert.equal(parent.children.length,0,'cave teardown removes mechanism meshes');

const events=eventBus(); // The existing music bridge emits these exact instrument-input events.
let playing=0,closed=0,awarded=0;
const music={beginPlayerSession(){playing++;return true;},close(){closed++;}};
let player={x:room.x+room.w/2,z:room.z+room.d/2-1.6};
const timed=compose({THREE,parent,room,id:'music-test',kind:'timedMelody',y:0,area,
  isActive:()=>activeArea===area,onSolved:()=>awarded++,getPlayerPosition:()=>player,getPlayerY:()=>0,
  music,events,puzzleCaveMelody:Song,songOptions:{difficulty:5},DynamicSurfaces:dynamicSurfaces,AreaFootprintBlockers:areaFootprints,
});
assert.equal(timed.song.measures,2);
assert.equal(blockers.size,1,'music cave reuses the same single-owner gate lifecycle');
const timedCollider=[...blockers.values()][0];
assert(timedCollider.enabled(),'the music gate starts physically locked');
assert(areaFootprints.blocksBox(area,gateX,gateZ,.18),'the stone-song gate blocks real player movement until solved');
assert.equal(events.count('hobunji-kurraya-puzzle-note'),1,'only real instrument notes reach the score');
timed.tick(0);
assert.equal(playing,1,'stepping onto the pressure plate opens the existing instrument session');
const firstNote=timed.song.notes[0].index;
events.dispatch('hobunji-kurraya-puzzle-note',{area:'wrong_map',noteIndex:firstNote});
assert.equal(timed.session.snapshot().progress,0,'an instrument in another map cannot solve the cave');
events.dispatch('hobunji-kurraya-puzzle-note',{area,noteIndex:(firstNote+1)%8});
assert.equal(timed.session.snapshot().progress,0,'wrong notes invalidate the attempt');
player={x:room.x,z:room.z};
timed.tick(.016);
assert.equal(closed,1,'leaving the plate closes the instrument overlay');
events.dispatch('hobunji-kurraya-puzzle-note',{area,noteIndex:firstNote});
assert.equal(timed.session.snapshot().progress,0,'off-plate notes have no effect');
player={x:room.x+room.w/2,z:room.z+room.d/2-1.6};
timed.tick(0);
assert.equal(playing,2,'returning to the pressure plate starts a fresh attempt');
let elapsed=0; // Total score time advanced through the actual composed chamber tick.
for(let index=0;index<timed.song.notes.length;index++){
  const note=timed.song.notes[index];
  const target=(note.startTick+.10)*timed.song.secondsPerTick;
  while(elapsed<target-1e-8){
    const amount=Math.min(.05,target-elapsed);
    timed.tick(amount);
    elapsed+=amount;
  }
  assert.equal(timed.session.activeIndex(),index,'the composed chamber lights the expected note');
  events.dispatch('hobunji-kurraya-puzzle-note',{area,noteIndex:note.index});
}
assert.equal(awarded,1,'a complete correct performance grants treasure once');
assert(timed.solved,'the authored gate is unlocked');
assert(areaFootprints.blocksBox(area,gateX,gateZ,.18),'the gate remains physically solid during its opening animation');
timed.animate(.52);
assert(areaFootprints.blocksBox(area,gateX,gateZ,.18),'the still-rising music slab cannot be walked through');
timed.animate(.35);
assert.equal(timed.backdrop.visible,false,'the solved instrument gate also reveals its chamber instead of leaving a black plane');
assert(!areaFootprints.blocksBox(area,gateX,gateZ,.18),'the fully raised music slab no longer blocks player movement');
assert.equal(closed,2,'the normal instrument overlay closes after the final note');
timed.dispose();
assert.equal(blockers.size,0,'music cave disposes the registered collider');
assert.equal(areaFootprints.providerIds().length,0,'music cave also unregisters the movement collider');
assert.equal(events.count('hobunji-kurraya-puzzle-note'),0,'cave teardown unregisters live music events');
assert.equal(parent.children.length,0,'cave teardown has no permanent authored scene nodes');
console.log('Puzzle Cave chambers: real timed instrument bridge, plate gating, dual fire sconces, gate rising, one-shot solve and disposal PASS.');

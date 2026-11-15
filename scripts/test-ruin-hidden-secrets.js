'use strict';
// Optional dungeon secrets use their own RNG, room state and collision registry.
const assert=require('node:assert/strict');
const api=require('../docs/js/ruin-hidden-secrets.js');
const room={id:'floor1-E-room2',kind:'challenge-room',challenge:'pressurePlate',x:40,z:50,w:16,d:15,y:12};
assert.equal(api.planForRoom({...room,challenge:'ropeChain'},0,'tothal'),null);
assert.equal(api.planForRoom({...room,w:8},0,'tothal'),null);
const found={};
for(let seed=0;seed<30000;seed++){
 const spec=api.planForRoom(room,seed,'kanthic');
 if(!spec)continue;
 assert.deepEqual(api.planForRoom(room,seed,'kanthic'),spec,'same seed, same secret');
 assert(spec.corner>=0&&spec.corner<=3);
 assert(spec.tier===1||spec.tier===2);
 assert(spec.babies>=0&&spec.babies<=3);
 const category=spec.kind==='closet'?'closet:'+spec.trigger:spec.kind==='suspended'?'suspended:'+spec.suspension:spec.kind||'nest';
 found[category]??=seed;
 if(spec.babies>0)found.babies??=seed;
}
for(const key of ['pillar','closet:projectile','closet:fire','closet:melody','suspended:ice','suspended:net','nest','babies'])
 assert(Number.isInteger(found[key]),'missing deterministic '+key);
class Group{
 constructor(){this.children=[];this.parent=null;this.position={set(x,y,z){Object.assign(this,{x,y,z})},y:0};
 this.rotation={};this.scale={setScalar(){}};this.userData={};this.visible=true;}
 add(child){child.parent?.remove(child);this.children.push(child);child.parent=this;}
 remove(child){this.children=this.children.filter(v=>v!==child);child.parent=null;}
 traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
}
class Mesh extends Group{constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class Geometry{dispose(){}}
class Material{constructor(opts){Object.assign(this,opts);}dispose(){}}
global.THREE={Group,Mesh,BoxGeometry:Geometry,MeshBasicMaterial:Material};
global.DynamicSurfaces={registerBlocker(x){this.ids.add(x.id)},remove(id){this.ids.delete(id)},ids:new Set()};
global.DevRandomRuinDungeonChests={create(o){
 const group=new Group();group.position.set(o.x,o.y,o.z);o.parent.add(group);
 return {group,opened:false,control:{kind:'dungeonChest'}};}};
const projectiles=new Set();
global.DevRandomRuinSimplePuzzles={hasActiveRuinState:()=>true,
 registerExternalProjectileTarget(t){projectiles.add(t);return()=>projectiles.delete(t);}};
const fire=new Map();
global.DungeonFire={registerTarget(t){fire.set(t.id,t);return t.id;},unregisterTarget(id){fire.delete(id)}};
let feetY=12,groundOn=false,player={x:43,z:53}; // Scenario controls simulate stacked floor fire and remote instrument input.
global.PersistentGroundFire={intersects:()=>groundOn};
global.RuinInteractionAudio={watchPlate(){}};
let notesReceived=0,melodyListener=null; // Confirms one secret score cannot receive a different plate's notes.
global.PuzzleCaveMelody={ruinDifficulty:()=>3,generate:()=>({notes:[{index:1}],bpm:90}),
 createSession:(_song,cbs)=>({step(){},note(){notesReceived++;},stop(){},solve:()=>cbs.onSolved()})};
global.RuinMelodyGlyphDecal={create:()=>({dispose(){}})};
global.addEventListener=(_type,callback)=>{melodyListener=callback;};
global.removeEventListener=(_type,callback)=>{if(melodyListener===callback)melodyListener=null;};
const rigUpdates=[]; // Each baby must receive the actual rig's folded-wing hatchling pose, not render as an adult flyer.
global.DevRandomRuinInteractions={activeCamera:()=>({getWorldPosition(){}})};
global.SkeeriRuins={paletteFor:theme=>({theme}),createRig:async()=>({root:new Group(),update:(_camera,pose)=>rigUpdates.push(pose),dispose(){this.disposed=true;}})};
const controls=new Set();
for(const [key,seed] of Object.entries(found)){
 feetY=12;groundOn=false;player={x:43,z:53};
 const owner=api.create({room,seed,theme:'kanthic',parent:new Group(),THREE,
  getPlayerY:()=>feetY,getPlayerPosition:()=>player,
  addControl:c=>controls.add(c),removeControl:c=>controls.delete(c)});
 assert(owner);
 owner.tick(.05);
 if(key==='closet:projectile'||key==='suspended:net'||key==='suspended:ice'){
   assert.equal(owner.targets.length,1);owner.targets[0].onHit();assert(owner.unlocked);
 }
 if(key==='closet:fire'){
   feetY=30;groundOn=true;owner.tick(.05);
   assert(!owner.unlocked,'ground fire on another floor cannot unlock the secret brazier');
   feetY=12;owner.tick(.05);assert(owner.unlocked,'ground fire on the correct floor unlocks the brazier');
   groundOn=false;
 }
 if(key==='closet:melody'){
   assert(owner.melody&&melodyListener,'native timed score and note event listener are present');
   const noteEvent={detail:{area:'map_i_dev_random_ruin',noteIndex:1,pressedAtMs:100}};
   melodyListener(noteEvent);assert.equal(notesReceived,0,'distant music cannot feed a hidden score');
   player={x:owner.platePoint.x,z:owner.platePoint.z};
   feetY=30;melodyListener(noteEvent);assert.equal(notesReceived,0,'other story cannot feed a hidden score');
   feetY=12;melodyListener(noteEvent);assert.equal(notesReceived,1,'notes at the correct plate reach the judge');
   owner.melody.solve();assert(owner.unlocked);
 }
 if(key==='suspended:net')assert(owner.cover.position.y>room.y+2,'net not at world origin');
 if(key.startsWith('suspended:')){
   for(let i=0;i<30;i++)owner.tick(.05);
   assert.equal(owner.chest.group.position.y,room.y,'chest dropped to floor');
   assert(Math.abs(owner.targets[0].object.position.x-owner.chest.group.position.x)>.6,
     'projectile clasp must be outside the ice/net cover rather than embedded inside');
 }
 assert.equal(owner.snapshot().babies,owner.babies);
 assert([...controls].filter(c=>c.kind==='ruinSkeeriNest').every(c=>c.claimAction1!==true),
   'inspecting the hidden brood must not steal weapon Action 1');
 owner.dispose();
 assert.equal(global.DynamicSurfaces.ids.size,0);
 assert.equal(projectiles.size,0);
 assert.equal(fire.size,0);
 assert.equal(controls.size,0);
}
// Wait for the same asynchronous flying-rig creation used by real game assets before inspecting its pose.
const seed=found.babies,brood=api.create({room,seed,theme:'kanthic',parent:new Group(),THREE,
  getPlayerY:()=>12,getPlayerPosition:()=>({x:43,z:53}),
  addControl:c=>controls.add(c),removeControl:c=>controls.delete(c)});
Promise.resolve().then(()=>Promise.resolve()).then(()=>{
  assert.equal(brood.nest.loaded,brood.babies,'all hatchling rigs resolve into the intended shelf');
  brood.tick(.05);
  assert(rigUpdates.length>=brood.babies&&rigUpdates.every(pose=>pose==='hatchling'),
    'every flying animal rig must explicitly enter hatchling pose with the actual camera');
  brood.dispose();
  assert.equal(controls.size,0);
  assert.equal(global.DynamicSurfaces.ids.size,0);
  console.log('Hidden ruin secrets: deterministic generation, reachable switches, folded Skeeri, and cleanup PASS');
}).catch(error=>{console.error(error);process.exitCode=1;});

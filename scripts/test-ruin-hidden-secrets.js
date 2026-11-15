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
global.PersistentGroundFire={intersects:()=>false};
global.RuinInteractionAudio={watchPlate(){}};
global.PuzzleCaveMelody={ruinDifficulty:()=>3,generate:()=>({notes:[{index:1}],bpm:90}),
 createSession:(_song,cbs)=>({step(){},note(){},stop(){},solve:()=>cbs.onSolved()})};
global.RuinMelodyGlyphDecal={create:()=>({dispose(){}})};
global.addEventListener=()=>{};global.removeEventListener=()=>{};
global.SkeeriRuins={paletteFor:theme=>({theme}),createRig:async()=>({root:new Group(),dispose(){}})};
const controls=new Set();
for(const [key,seed] of Object.entries(found)){
 const owner=api.create({room,seed,theme:'kanthic',parent:new Group(),THREE,
  getPlayerY:()=>12,getPlayerPosition:()=>({x:43,z:53}),
  addControl:c=>controls.add(c),removeControl:c=>controls.delete(c)});
 assert(owner);
 owner.tick(.05);
 if(key==='closet:projectile'||key==='suspended:net'||key==='suspended:ice'){
   assert.equal(owner.targets.length,1);owner.targets[0].onHit();assert(owner.unlocked);
 }
 if(key==='closet:fire'){owner.fireRecord.onBurn();assert(owner.unlocked);}
 if(key==='closet:melody'){assert(owner.melody);owner.melody.solve();assert(owner.unlocked);}
 if(key==='suspended:net')assert(owner.cover.position.y>room.y+2,'net not at world origin');
 if(key.startsWith('suspended:')){
   for(let i=0;i<30;i++)owner.tick(.05);
   assert.equal(owner.chest.group.position.y,room.y,'chest dropped to floor');
 }
 assert.equal(owner.snapshot().babies,owner.babies);
 owner.dispose();
 assert.equal(global.DynamicSurfaces.ids.size,0);
 assert.equal(projectiles.size,0);
 assert.equal(fire.size,0);
 assert.equal(controls.size,0);
}
console.log('Hidden ruin secrets: deterministic types, puzzle activations, ceiling drop and cleanup PASS');

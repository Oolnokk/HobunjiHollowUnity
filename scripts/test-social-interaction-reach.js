#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ranged = fs.readFileSync('docs/js/combat/ranged-weapons.js','utf8');
const functionSource = name => ranged.slice(ranged.indexOf(`  function ${name}(`),ranged.indexOf('\n  function ',ranged.indexOf(`  function ${name}(`)+1));
class Vector {
  constructor(x,y,z){Object.assign(this,{x,y,z});}
  clone(){return new Vector(this.x,this.y,this.z);}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
  lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
}
let frame=0,pressed=0;
const ray={origin:new Vector(0,.5,-3),direction:new Vector(0,0,1)};
const window={},context=vm.createContext({window,console,AIM_EPSILON:1e-8,interactionAimRay:()=>ray});
// Execute the production camera-ray/slab selector; only its camera source and lightweight vector boundary are injected.
vm.runInContext(functionSource('segmentHitboxInterval')+functionSource('focusCandidates')+'\nwindow.testFocus=focusCandidates;',context);
vm.runInContext(fs.readFileSync('docs/js/furniture-table-system.js','utf8'),context);
const tables=window.FurnitureTableSystem;
const actor=(id,x,z,area='town')=>({rec:{id},area,root:{position:{x,y:0,z},visible:true}});
const target=actor('aimed',0,5),offRay=actor('near-but-off-ray',1.3,1),tooFar=actor('too-far',0,6.1),otherMap=actor('other-map',0,.5,'map_i_inn');
const walkers=[target,offRay,tooFar,otherMap];
tables.init({getArea:()=> 'town',getPlayerPosition:()=>({x:0,z:0}),getWalkers:()=>walkers,frameId:()=>frame,
  getPlayerSeat:()=>null,focusCandidates:window.testFocus,
  actorHitbox:w=>({box:{min:{x:w.root.position.x-.2,y:0,z:w.root.position.z-.2},max:{x:w.root.position.x+.2,y:1,z:w.root.position.z+.2}}}),
  makeSitInteractable:()=>({getButtons:()=>[{action:'obj_sit',allowed:true}],onAction:()=>{pressed++;return{ok:true};}})});
const root=(x,z)=>({parent:{},position:{x,y:0,z},scale:{x:1,y:1,z:1}});
const table=root(0,1.5),chair=root(0,3);
tables.registerPlacement('town',{id:'buffet',key:'tableSmall',col:-1,row:1},table,{fw:2,fd:1});
tables.registerPlacement('town',{id:'chair',key:'chairSimple',col:0,row:3},chair,{fw:1,fd:1,sit:true});
assert.equal(tables.focusedTarget('town').walker,target,'aimed NPC at five tiles wins through buffet/chair collision');
assert.equal(tables.objectAt('town',0,3),null,'the same social target owns prompt and press');
target.root.position.z=6.1;frame++;
assert.notEqual(tables.focusedTarget('town')?.kind,'npc','beyond six tiles is excluded; nearby off-ray NPCs cannot steal aim');
target.root.position.z=5;target.root.position.x=2;frame++;table.parent=null;
assert.equal(tables.focusedTarget('town').kind,'chair','chairs remain directly targetable when no NPC is aimed at');
assert(tables.objectAt('town',0,3).onAction('obj_sit').ok);assert.equal(pressed,1);
const nearer=actor('nearer-on-ray',0,4);walkers.push(nearer);target.root.position.x=0;frame++;
assert.equal(tables.focusedTarget('town').walker,nearer,'overlapping NPC silhouettes use the first actor along the ray');
assert.equal(tables.snapshot().socialReach,6);assert.equal(tables.snapshot().socialIgnoresColliders,true);
// A raised camera must target real serving objects instead of the broad parent-table blocker.
// Load the shipped eight attachments so this also detects accidentally changing their authoring.
const servingData=JSON.parse(fs.readFileSync('docs/config/furniture-authored/servingTable.json','utf8')); // Actual Gorkunash placements define the fixture.
const servingRoot=root(0,1.5); // A four-tile table with its physical children at the authored surface anchors.
servingRoot.userData={authoredItemPlacements:{children:servingData.itemPlacements.map(placement=>({
  userData:{surfacePlacement:placement},
  getWorldPosition(out){out.x=placement.position.u;out.y=.545;out.z=1.5+placement.position.v;return out;}
}))}};
window.THREE={Vector3:Vector}; // Shared furniture focus uses the same world-vector shape as the production ray selector.
tables.registerPlacement('raised-view-test',{id:'gorkunash_feast',key:'servingTable',col:-2,row:1,serviceId:'gorkunash-feast'},servingRoot,{fw:4,fd:1});
tables.registerService('gorkunash-feast',{enabled:()=>true,buttons:()=>[{action:'obj_inspect_meal',allowed:true}],onAction:()=>({ok:true})});
for(const placement of servingData.itemPlacements) {
  ray.origin=new Vector(placement.position.u,2.35,-3); // Mirrors the actually elevated camera position in world space.
  ray.direction=new Vector(0,-1.7/(4.5+placement.position.v),1); // Reticle intersects this authored object above its tabletop.
  frame++;
  const focus=tables.focusedTarget('raised-view-test'); // The same result drives both prompts and interaction input.
  assert.equal(focus?.placement?.id,placement.id,'lifted camera must reach '+placement.id+' rather than the table blocker');
  assert.equal(tables.objectAt('raised-view-test',0,1)?.getButtons?.()[0]?.action,'obj_inspect_meal',
    'authored service action must be reachable for '+placement.id);
}
ray.origin=new Vector(0,.1,-3);ray.direction=new Vector(0,0,1);frame++;
assert.notEqual(tables.focusedTarget('raised-view-test')?.kind,'service','a ray below the tabletop does not acquire a pot');
const barrier=root(0,-1); // An unrelated tall solid between the camera and buffet should still occlude the pots.
tables.registerPlacement('raised-view-test',{id:'unrelated-barrier',key:'block',col:0,row:-1},barrier,{fw:1,fd:1}).height=3;
ray.origin=new Vector(0,2.35,-3);ray.direction=new Vector(0,-.38,1);frame++;
assert.equal(tables.focusedTarget('raised-view-test')?.entry?.id,'unrelated-barrier','foreign geometry still blocks surface interactions');
barrier.parent=null;frame++; // Remove the external barrier, then put one inside the buffet's broad parent box.
const insetBarrier=root(0,1.1); // Its world hit lies ahead of the pot but behind the parent's oversized bounding face.
tables.registerPlacement('raised-view-test',{id:'inset-barrier',key:'bookcase',col:0,row:1.1},insetBarrier,{fw:.2,fd:.2}).height=2;
ray.origin=new Vector(0,2.35,-3);ray.direction=new Vector(0,-1.7/4.27,1);frame++;
assert.notEqual(tables.focusedTarget('raised-view-test')?.kind,'service',
  'an intervening solid inside the serving table bounding box must not let the pot show a prompt through it');
insetBarrier.parent=null;frame++;
assert.equal(tables.focusedTarget('raised-view-test')?.placement?.id,'pot-1',
  'removing the internal obstruction restores the actual pot without requiring an extra game tick');

// Pin the camera-ray contract: interaction rays originate at the lifted camera,
// not at an independently stored or hard-coded original character eye height.
const gameSource=fs.readFileSync('docs/game.js','utf8'); // Verifies the runtime camera-to-interaction dependency, not just a fixture.
const interactionStart=gameSource.indexOf('function currentPlayerInteractionRay()'); // Limits the assertion to the source ray authority.
const interactionEnd=gameSource.indexOf('function playerPerspectiveOriginWorld()',interactionStart);
assert(interactionStart>=0 && interactionEnd>interactionStart,'currentPlayerInteractionRay must exist');
assert.match(gameSource.slice(interactionStart,interactionEnd),/setFromCamera\(ndc, camera\)/,
  'world interaction ray must read the live rendered camera');
const surfaceStart=gameSource.indexOf('const surfaceView = window.HobunjiShoulderCameraCharacterFraming');
const cameraPositionAt=gameSource.indexOf('const cameraY =',surfaceStart);
assert(surfaceStart>=0 && cameraPositionAt>surfaceStart,'camera surface framing must run before the camera position is resolved');
assert.match(gameSource.slice(surfaceStart,cameraPositionAt),/lookY \+= surfaceView\.lift/,
  'short-species surface lift must affect the actual camera and hence interaction-ray origin');

console.log('Social focus: production directional ray, six-tile reach, collider-independent NPC aim, map/range exclusions, chair prompt/press and raised-camera buffet service hits passed.');

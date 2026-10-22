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
console.log('Social focus: production directional ray, six-tile reach, collider-independent NPC aim, map/range exclusions and chair prompt/press passed.');

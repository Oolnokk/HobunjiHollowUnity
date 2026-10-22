#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Real table-membership and direct-interaction behavior across area types.
const fs = require('node:fs'); // Loads the runtime authority and authored locale data.
const vm = require('node:vm'); // Small engine adapters keep the regression independent of WebGL/browser installation.
const window = {}; // Same public namespace used by gameplay and editor-built furniture.
vm.runInNewContext(fs.readFileSync('docs/js/furniture-table-system.js','utf8'), {window});
const tables = window.FurnitureTableSystem; // Production API under test.
let area='town', playerSeat=null, changed=0, aim={c:0,r:0}; // Independent map, chair, persistence and directional targeting inputs.
const walkers=[]; // Reservations and actual seated actors share the ordinary walker array.
tables.init({getArea:()=>area,getWalkers:()=>walkers,getPlayerSeat:()=>playerSeat,getPlayerPosition:()=>({x:1.5,z:.5}),getAim:()=>aim,
 assignmentChanged:()=>changed++,makeSitInteractable:()=>({getButtons:()=>[{action:'obj_sit',allowed:true}],onAction:()=>({ok:true})})});
function root(x,z){return {parent:{},position:{x,z},scale:{x:1,z:1},userData:{}};}
function populate(map){
 tables.registerPlacement(map,{id:'dining',key:'tableSmall',col:0,row:0},root(.5,.5),{fw:1,fd:1});
 tables.registerPlacement(map,{id:'other',key:'tableSmall',col:8,row:0},root(8.5,.5),{fw:1,fd:1});
 tables.registerPlacement(map,{id:'chair',key:'chairSimple',col:1,row:0,tableId:'dining'},root(1.5,.5),{sit:true,fw:1,fd:1});
 tables.registerPlacement(map,{id:'guest-chair',key:'chairSimple',col:2,row:0,tableId:'dining'},root(2.5,.5),{sit:true,fw:1,fd:1});
}
for(const map of ['town','farm','interior','map_i_inn','map_cloud_forest'])populate(map);
assert.equal(tables.tableForSeat('map_hobunji_town',{furnitureId:'chair'})?.id,'dining','exterior map aliases share the real town area');
walkers.push({rec:{id:'arrived'},area:'town',root:{position:{x:2.5,z:.5}},currentScheduleTarget:{pose:'sit',furnitureId:'guest-chair'}});
walkers.push({rec:{id:'walking'},area:'town',root:{position:{x:12,z:3}},currentScheduleTarget:{pose:'sit',furnitureId:'chair'}});
walkers.push({rec:{id:'elsewhere'},area:'map_i_inn',root:{position:{x:2.5,z:.5}},currentScheduleTarget:{pose:'sit',furnitureId:'guest-chair'}});
playerSeat={phase:'active',furnitureId:'chair'};
assert.deepEqual(Array.from(tables.members('town','dining'),m=>m.id),['player','arrived'],'only actual occupants enter the shared table array');
assert.equal(tables.members('map_i_inn','dining')[0].id,'elsewhere','same ids in different maps remain isolated');
assert.equal(tables.objectAt('town',2,0).getButtons()[0].allowed,false,'occupied outdoor chair cannot be taken');
assert.equal(tables.objectAt('town',2,0).onAction('obj_sit').ok,false,'occupation is rechecked when pressed');
assert.equal(tables.objectAt('farm',1,0).getButtons()[0].action,'obj_sit','farm/exterior chairs reuse the ordinary Sit input');
assert.equal(tables.assignTable('town','chair','other'),true);
assert.equal(changed,1,'relationship owner is notified for save persistence');
assert.equal(tables.tableForSeat('town',{furnitureId:'chair'}).id,'other','explicit assignment wins over the physically closer table');
assert.deepEqual(Array.from(tables.members('town','dining'),m=>m.id),['arrived']);
assert.equal(tables.assignTable('town','chair','missing'),false,'missing cross-map/stale table ids are rejected');
assert.equal(tables.assignTable('town','chair',''),true,'unassigned chairs remain ordinary usable seats');
assert.equal(tables.tableForSeat('town',{furnitureId:'chair'}),null);
const savedPlayerSeat=playerSeat;playerSeat=null;walkers[1].currentScheduleTarget=null;
// Physical reservations apply even without a table link or an arrived actor.
tables.setSeatTarget('future',{area:'town',pose:'sit',furnitureId:'chair'});
assert.equal(tables.isSeatTaken('town',{furnitureId:'chair'},'another'),true);
assert.equal(tables.objectAt('town',1,0).getButtons()[0].allowed,false,'approaching NPC reserves an unassigned chair');
assert.equal(tables.isSeatTaken('town',{furnitureId:'chair'},'future'),false,'the owner keeps its own reservation');
tables.setSeatTarget('future',null);playerSeat=savedPlayerSeat;
assert.equal(tables.isSeatTaken('town',{furnitureId:'chair'},'another'),true,'player still reserves the active seat');
playerSeat=null;
assert.equal(tables.isSeatTaken('town',{furnitureId:'chair'},'another'),false,'standing releases the player seat');
tables.assignTable('town','chair','dining');playerSeat={phase:'active',furnitureId:'chair'};
assert.equal(tables.companionSeat('town','future'),null,'arrived player and NPC occupy every seat at this table');
walkers[0].currentScheduleTarget=null;
const companion=tables.companionSeat('town','future');
assert.equal(companion.furnitureId,'guest-chair','companion reserves a different actual chair at the player’s table');
assert.equal(tables.companionSeat('town','third'),null,'two followers cannot claim the same last free seat');
assert.equal(tables.blocksBox('town',.5,.5),true,'ordinary outdoor table blocks movement');
assert.equal(tables.blocksBox('town',1,.5,.15),true,'whole-body footprint cannot squeeze between furniture centers');
assert.equal(tables.blocksBox('farm',20,20),false,'collision is map-local and spatial');
const free=root(12.5,.5);tables.registerPlacement('town',{id:'rug',key:'rug',col:12,row:0},free,{fw:1,fd:1,walkable:true});
assert.equal(tables.blocksBox('town',12.5,.5),false,'walkable furniture remains walkable');
assert(tables.grassFootprintKeys('town').has('12,0'),'walkable structures still clear grass');
// A non-holiday provider proves surface services do not depend on FestivalSystem or a named locale.
const counter=root(4,.5), holder={userData:{surfacePlacement:{service:{kind:'stock'}}},getWorldPosition(out){out.x=4;out.z=.5;}}; // Rendered attachment anchor, moved independently from any hardcoded world coordinates.
counter.userData.authoredItemPlacements={children:[holder]};
tables.registerPlacement('town',{id:'counter',key:'tableSmall',col:3,row:0,serviceId:'shop'},counter,{fw:1,fd:1});
let enabled=true, sales=0; // Provider lifecycle and action dispatch use the same engine as serving pots.
tables.registerService('shop',{enabled:()=>enabled,buttons:()=>[{action:'obj_buy',label:'Buy',allowed:true}],onAction:()=>({ok:++sales>0})});
aim={c:4,r:.5};
const object=tables.objectAt('town',4,0);
assert.equal(object.getButtons()[0].action,'obj_buy');
assert.strictEqual(object.getButtons()[0].promptRoot,holder,'the floating prompt follows the actual attached object');
assert.equal(object.onAction('obj_buy').ok,true);assert.equal(sales,1);
enabled=false;assert.equal(tables.aimedService('town'),null,'inactive providers do not steal ordinary world actions');
area='interior';assert.equal(tables.aimedService(area),null,'service targets cannot leak across scenes');
tables.clearArea('town');assert.equal(tables.members('town','dining').length,0,'layout replacement removes old relationships');
assert.equal(tables.tableForSeat('map_i_inn',{furnitureId:'chair'}).id,'dining','clearing town leaves interiors intact');
console.log('Shared furniture table membership, occupancy, map isolation and provider-driven surface interactions passed.');

// Real authored-part transforms drive the high-surface probe, including map changes and moved furniture.
class SurfaceVector {
  fromArray(a) { [this.x,this.y,this.z]=a; return this; }
  applyMatrix4(m) { this.x+=m.x; this.y+=m.y; this.z+=m.z; return this; }
  transformDirection() { return this; }
} // Translation-only adapter isolates probe selection from Three.js's already-tested matrix implementation.
window.THREE={Vector3:SurfaceVector};
const top={id:'top',partId:'slab',localCentroid:[0,.1,0],localNormal:[0,1,0],role:'workSurface'}; // Authored local face matches actual surface placement data.
window.AuthoredFurniture={peek:()=>({recognizedSurfaces:[top]})};
const elevated=root(0,-1.25), slab={visible:true,matrixWorld:{x:0,y:1,z:-1.25},updateWorldMatrix(){}}; // Movable part carries its own world transform.
elevated.userData.meshById=new Map([['slab',slab]]);
tables.registerPlacement('surface-test',{id:'elevated',key:'tableSmall',col:0,row:-2},elevated,{fw:2,fd:1});
assert.equal(tables.highSurfaceAhead('surface-test',0,0,.5,0,-1).active,true,'a high top ahead activates camera help');
assert.equal(tables.highSurfaceAhead('surface-test',0,0,1.2,0,-1).active,false,'already-visible low tops do not raise the camera');
assert.equal(tables.highSurfaceAhead('surface-test',0,0,.5,0,1).active,false,'looking away releases camera help');
assert.equal(tables.highSurfaceAhead('other-map',0,0,.5,0,-1).active,false,'nearby tops in another map never activate');
assert.equal(tables.highSurfaceAhead('surface-test',0,0,1.12,0,-1,true).active,true,'small height changes retain the active surface without flickering');
slab.matrixWorld.x=8;
assert.equal(tables.highSurfaceAhead('surface-test',0,0,.5,0,-1).active,false,'part movement is reflected without a scene scan');
slab.matrixWorld.x=0;top.localNormal=[0,-1,0];
assert.equal(tables.highSurfaceAhead('surface-test',0,0,.5,0,-1).active,false,'undersides cannot trigger a view lift');
top.localNormal=[0,1,0];elevated.visible=false;
assert.equal(tables.highSurfaceAhead('surface-test',0,0,.5,0,-1).active,false,'hidden furniture cannot trigger');

elevated.visible=true;
assert.equal(tables.highSurfaceAhead('surface-test',0,1,.5,0,-1).active,false,'looking at a table outside neighboring tiles cannot trigger');
const diagonal=root(1.5,1.5), diagonalPart={visible:true,matrixWorld:{x:1.5,y:1,z:1.5},updateWorldMatrix(){}}; // Occupies the diagonally adjacent tile to a player anywhere in tile zero.
diagonal.userData.meshById=new Map([['slab',diagonalPart]]);
tables.registerPlacement('diagonal-test',{id:'diagonal',key:'tableSmall',col:1,row:1},diagonal,{fw:1,fd:1});
assert.equal(tables.highSurfaceAhead('diagonal-test',.01,.01,.5,1,0).active,true,'diagonally adjacent tile works with a broad camera direction even from the far corner');
assert.equal(tables.highSurfaceAhead('diagonal-test',.01,.01,.5,-1,0).active,false,'looking away from a diagonally adjacent top releases assistance');
assert.equal(tables.highSurfaceAhead('diagonal-test',-.01,.01,.5,1,0).active,false,'crossing into a tile two columns away ends adjacency');
assert.equal(tables.highSurfaceAhead('diagonal-test',1.4,1.4,.5,1,0).active,true,'same-tile surfaces also work');
for (const [tileX,tileZ] of [[0,0],[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
 const centerX=tileX+.5,centerZ=tileZ+.5; // Each test moves the authored furniture into one of the nine allowed tiles.
 diagonal.position.x=centerX;diagonal.position.z=centerZ;diagonalPart.matrixWorld.x=centerX;diagonalPart.matrixWorld.z=centerZ;
 const distance=Math.hypot(tileX,tileZ); // Face the tile center; the same-tile case does not require a direction.
 assert.equal(tables.highSurfaceAhead('diagonal-test',.5,.5,.5,distance?tileX/distance:1,distance?tileZ/distance:0).active,true,`same/neighbor tile ${tileX},${tileZ} activates`);
}

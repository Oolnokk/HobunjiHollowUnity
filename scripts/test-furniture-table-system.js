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

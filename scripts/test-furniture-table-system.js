#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Real table-membership and direct-interaction behavior across area types.
const fs = require('node:fs'); // Loads the runtime authority and authored locale data.
const vm = require('node:vm'); // Small engine adapters keep the regression independent of WebGL/browser installation.
let probeClock=0; // Controlled monotonic time exercises cache expiration without sleeping.
const window = {}; // Same public namespace used by gameplay and editor-built furniture.
vm.runInNewContext(fs.readFileSync('docs/js/furniture-table-system.js','utf8'), {window,performance:{now:()=>probeClock}});
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
assert.equal(tables.nearbySurface('surface-test',0,0).active,true,'a neighboring authored top activates camera help');
assert.equal(tables.nearbySurface('other-map',0,0).active,false,'nearby tops in another map never activate');
slab.matrixWorld.x=8;elevated.position.x=8;probeClock+=100;
assert.equal(tables.nearbySurface('surface-test',0,0).active,false,'moving the furniture away ends proximity assistance');
slab.matrixWorld.x=0;elevated.position.x=0;top.localNormal=[0,-1,0];probeClock+=100;
assert.equal(tables.nearbySurface('surface-test',0,0).active,false,'undersides cannot trigger a view lift');
top.localNormal=[0,1,0];elevated.visible=false;probeClock+=100;
assert.equal(tables.nearbySurface('surface-test',0,0).active,false,'hidden furniture cannot trigger');
elevated.visible=true;
assert.equal(tables.nearbySurface('surface-test',0,1).active,false,'a table outside neighboring tiles cannot trigger');
const diagonal=root(1.5,1.5), diagonalPart={visible:true,matrixWorld:{x:1.5,y:1,z:1.5},updateWorldMatrix(){}}; // Occupies the diagonally adjacent tile to a player anywhere in tile zero.
diagonal.userData.meshById=new Map([['slab',diagonalPart]]);
tables.registerPlacement('diagonal-test',{id:'diagonal',key:'tableSmall',col:1,row:1},diagonal,{fw:1,fd:1});
assert.equal(tables.nearbySurface('diagonal-test',.01,.01).active,true,'diagonally adjacent tile works even from the far corner');
assert.equal(tables.nearbySurface('diagonal-test',-.01,.01).active,false,'crossing into a tile two columns away ends adjacency');
assert.equal(tables.nearbySurface('diagonal-test',1.4,1.4).active,true,'same-tile surfaces also work');
for (const [tileX,tileZ] of [[0,0],[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
 const centerX=tileX+.5,centerZ=tileZ+.5; // Moves the authored furniture into every allowed tile with no direction input.
 diagonal.position.x=centerX;diagonal.position.z=centerZ;diagonalPart.matrixWorld.x=centerX;diagonalPart.matrixWorld.z=centerZ;probeClock+=100;
 assert.equal(tables.nearbySurface('diagonal-test',.5,.5).active,true,`proximity alone activates at tile ${tileX},${tileZ}`);
}
for (const invalid of [NaN,Infinity,undefined]) assert.equal(tables.nearbySurface('diagonal-test',invalid,.5).active,false,'invalid player positions cannot trigger assistance');

const cachedScans=tables.snapshot('diagonal-test').surfaceCamera.probe.scans; // Per-frame calls must reuse the same tile query until expiration.
for(let frame=0;frame<120;frame++)tables.nearbySurface('diagonal-test',.6,.6);
assert.equal(tables.snapshot('diagonal-test').surfaceCamera.probe.scans,cachedScans+1,'invalid-input recovery scans once then 119 frames hit the cache');
probeClock+=99;tables.nearbySurface('diagonal-test',.6,.6);
assert.equal(tables.snapshot('diagonal-test').surfaceCamera.probe.scans,cachedScans+1,'stationary proximity remains cached before 100ms');
probeClock+=1;tables.nearbySurface('diagonal-test',.6,.6);
assert.equal(tables.snapshot('diagonal-test').surfaceCamera.probe.scans,cachedScans+2,'moving furniture is picked up within 100ms');
tables.nearbySurface('diagonal-test',3.5,.6);
assert.equal(tables.snapshot('diagonal-test').surfaceCamera.probe.scans,cachedScans+3,'crossing a tile boundary checks immediately');
tables.clearArea('diagonal-test');
assert.equal(tables.nearbySurface('diagonal-test',3.5,.6).active,false,'layout deletion invalidates cached proximity immediately');

let frame = 1; // The gameplay frame stamp activates the indexed collision path.
tables.init({ frameId: () => frame });
const indexed = root(4, 4); // Spans multiple broad-phase cells and checks exact point and body queries.
tables.registerPlacement('indexed', { id:'table', key:'tableSmall', col:4, row:4 }, indexed, { fw:2, fd:2 });
assert.equal(tables.blocksBox('indexed', 3.5, 4.5), true);
assert.equal(tables.blocksBox('indexed', 4.5, 3.5), true);
assert.equal(tables.blocksBox('indexed', 3, 4.5), false, 'the exact edge of a table is outside a point probe');
assert.equal(tables.blocksBox('indexed', 3, 4.5, 0.1), true, 'a whole body can overlap the same edge');
assert.equal(tables.blocksBox('indexed', 4.5, 4.5, 0, 4), false, 'a high projectile clears the table');
indexed.position.x = 8;
frame++;
assert.equal(tables.blocksBox('indexed', 4.5, 4.5), false, 'new frames read current transforms');
assert.equal(tables.blocksBox('indexed', 8, 4.5), true);
tables.clearArea('indexed');
assert.equal(tables.blocksBox('indexed', 8, 4.5), false, 'a same-frame removal invalidates the index');


// A scene clear owns rope registration as well as table membership. Late authored
// asset promises must not recreate an invisible grab hook after its map disappeared.
{
  const ropeEvents=[]; // Records registration and removal for two independent lifecycle cases.
  const deferred=[]; // Queued AuthoredFurniture.load completions stand in for mobile asset latency.
  window.RopeFurniture={
    register:(map,id)=>ropeEvents.push(['register',map,id]),
    unregister:(map,id)=>ropeEvents.push(['unregister',map,id]),
  };
  window.AuthoredFurniture={load:()=>({then(callback){deferred.push(callback);}})};
  window.THREE.Box3=class {setFromObject(){return this;} isEmpty(){return true;}};
  const piece=root(2,2);piece.parent={};
  tables.registerPlacement('rope-map',{id:'live',key:'ruinRopeMount',col:2,row:2},piece,{fw:1,fd:1});
  deferred.shift()({rope:{enabled:true}});
  assert.deepEqual(ropeEvents,[['register','rope-map','live']],'the authored furniture rope registers only after its asset resolves');
  tables.clearArea('rope-map');
  assert.deepEqual(ropeEvents.at(-1),['unregister','rope-map','live'],'a cleared area releases its rope hook');
  const afterClearCount=ropeEvents.length; // Ensures an in-flight promise cannot revive an absent area.
  const late=root(4,4);late.parent={};
  tables.registerPlacement('late-map',{id:'pending',key:'ruinRopeMount',col:4,row:4},late,{fw:1,fd:1});
  tables.clearArea('late-map');
  deferred.shift()({rope:{enabled:true}});
  assert.equal(ropeEvents.length,afterClearCount+1,'a stale authored load cannot register an orphaned rope');
  assert.deepEqual(ropeEvents.at(-1),['unregister','late-map','pending']);
}

// A visible NPC must use an actual registered chair, never a fallback tile.
{
  const gameSource=fs.readFileSync('docs/game.js','utf8');
  const start=gameSource.indexOf('      function resolveSeatWorldTransform('),end=gameSource.indexOf('      function beginSitInteraction(',start);
  const nStart=gameSource.indexOf('      function npcSeatTransformForTarget('),nEnd=gameSource.indexOf('      async function makeNpcWalker(',nStart);
  const resolver=gameSource.slice(start,end)+gameSource.slice(nStart,nEnd);
  const loadTable=w=>{vm.runInNewContext(fs.readFileSync('docs/js/furniture-table-system.js','utf8'),{window:w});return w.FurnitureTableSystem;};
  const loadResolver=w=>vm.runInNewContext(resolver+'\n({resolve:npcSeatTransformForTarget, navigate:npcSeatNavigationTarget});', {window:w,DECORATIVE_FURNITURE_DEFS:{chairSimple:{sit:true,fw:1,fd:1},stool:{sit:true,fw:1,fd:1},bench:{sit:true,fw:1,fd:1}}});
  const check=(condition,message)=>assert.ok(condition,message);

  class SeatVector { set(x,y,z){Object.assign(this,{x,y,z});return this;} }
  const w={THREE:{Vector3:SeatVector},AuthoredFurniture:{
    peek:()=>({}),seatAnchorFor:(_data,index)=>({position:{x:index*.2,y:.3,z:0},rotationDeg:{y:0}}),
  }};
  const tables=loadTable(w);
  const area='map_i_chair_qa';
  tables.init({getArea:()=>area,surfaceY:()=>.4});
  const mesh=(x,y,z)=>({parent:{},position:{x,y,z},scale:{x:1,y:1,z:1},userData:{},localToWorld(v){v.x+=this.position.x;v.y+=this.position.y;v.z+=this.position.z;return v;}});
  const chair=mesh(8.5,1.2,9.5);
  tables.registerPlacement(area,{id:'moved',key:'chairSimple',col:1,row:2,npcStationId:'legacy-station'},chair,{sit:true});
  tables.registerPlacement(area,{id:'other',key:'stool',col:1,row:2},mesh(1.5,0,2.5),{sit:true});
  const target={area,pose:'sit',furnitureId:'moved',furnitureKey:'chairSimple',c:1,r:2,seatIndex:1};
  const {resolve,navigate}=loadResolver(w);
  const anchor=resolve(target);
  const walker={};
  const nav=navigate(walker,target,anchor);
  check(nav.c===8&&nav.r===9&&nav.furnitureId==='moved','navigation routes to the live chair tile, not its outdated station');
  check(navigate(walker,target,anchor)===nav,'unchanged seat reuses navigation target');
  const missingTarget={...target,furnitureId:'gone'};
  const standing=navigate(walker,missingTarget,null);
  check(standing.pose==='stand'&&!standing.furnitureId&&!standing.furnitureKey,'invalid chair releases reservation and overlap privilege');
  check(navigate(walker,missingTarget,null)===standing,'missing chair fallback is cached');
  const floorSit={...target,furnitureId:'',furnitureKey:''};
  check(navigate(walker,floorSit,null)===floorSit,'floor sitting is unaffected');
  const offscreen={...target,area:'unloaded'};
  check(navigate(walker,offscreen,resolve(offscreen))===offscreen,'offscreen logical schedule stays unchanged');
  check(anchor.x===8.7&&anchor.z===9.5&&Math.abs(anchor.worldY-1.5)<1e-9&&Math.abs(anchor.y-1.1)<1e-9,'live moved chair and absolute elevation');
  check(resolve({...target,furnitureId:'gone'})===null,'missing named chair does not substitute another');
  check(resolve({...target,furnitureId:'',stationId:'legacy-station',c:99,r:99}).x===8.7,'legacy station follows stable placement');
  check(resolve({...target,furnitureId:'',furnitureKey:'bench'})===null,'legacy coordinate cannot substitute another type');
  check(resolve({...target,furnitureId:'',furnitureKey:'stool'}).x===1.7,'legacy typed lookup still works');
  tables.registerPlacement(area,{id:'ambiguous',key:'chairSimple',col:1,row:2},mesh(3,0,4),{sit:true});
  check(resolve({...target,furnitureId:''})===null,'ambiguous legacy NPC chair is rejected');
  chair.position.x=11;
  check(resolve(target).x===11.2,'live transform tracks subsequent movement');
  check(navigate(walker,target,resolve(target)).c===11,'moving an attached chair invalidates the navigation destination');
  check(resolve({...target,furnitureId:'',sourceFurnitureId:'moved',c:99,r:99}).x===11.2,'authored source identity cannot fall back to stale coordinates');
  tables.unregisterPlacement(area,'moved');
  check(resolve(target)===null,'removed chair clears seated anchor');
  tables.clearArea(area);
  check(resolve(target)===null,'active area with no registered furniture cannot air sit');
  check(resolve({...target,area:'unloaded'}).x===1.7,'unloaded offscreen schedules retain logical anchor');
  check(resolve({...target,area:undefined}).x===1.7,'area-less authored cutscene retains logical anchor');

  console.log('NPC physical seat anchor regression passed');
}

// A player taking a moved NPC's chair must retain the same physical seat id and height.
{
  const gameSource=fs.readFileSync('docs/game.js','utf8');
  const start=gameSource.indexOf('      function beginSitInteraction('),end=gameSource.indexOf('      function endSitInteraction(',start);
  const ctx={window:{FarmAnimals:{isHarvesting:()=>false},FurnitureTableSystem:{
    isSeatTaken:(_area,target)=>target.furnitureId==='occupied',
    seatTransform:(_area,target)=>target.furnitureId==='moved' ? {x:8.5,z:9.5,y:1.5,worldY:1.5,facingRad:0,furnitureId:'moved'} : null,
  }},sitInteraction:null,currentArea:'interior',dialogueOpen:false,player:{x:0,y:0},facingAngle:0,TILE:32,
  activeCameraMode:'default',activeCameraTarget:null,activeSurfaceYAtWorld:()=>.4,THREE:{Vector3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}}},
  wrapAzimuthDeg:x=>x,cameraModeConfig:()=>({azimuthDeg:0}),cameraAzimuthOffsetDeg:0,cameraAngleOffsetDeg:0,
  resolveSeatWorldTransform:()=>{throw Error('named seat must never fall back to tile geometry');}};
  const begin=vm.runInNewContext(gameSource.slice(start,end)+'\nbeginSitInteraction;',ctx);
  assert.equal(begin('chairSimple',1,2,1,1,0,0,'missing').ok,false);
  assert.equal(begin('chairSimple',1,2,1,1,0,0,'occupied').ok,false);
  assert.equal(begin('chairSimple',1,2,1,1,0,0,'moved').ok,true);
  assert.equal(ctx.sitInteraction.furnitureId,'moved');
  assert.equal(ctx.sitInteraction.targetX,8.5*32);
  assert.equal(ctx.sitInteraction.targetY,9.5*32);
  assert.equal(ctx.sitInteraction.seatAbsoluteWorldY,1.5);
  assert.equal(ctx.sitInteraction.seatWorldY,1.1);
  assert.equal(ctx.activeCameraTarget.position.y,1.65);
}

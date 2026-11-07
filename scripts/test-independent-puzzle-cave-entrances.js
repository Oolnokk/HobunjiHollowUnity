'use strict';
// Regression checks for separately counted outdoor Puzzle Caves and rock-hidden cave-to-cave doors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { console, setTimeout, clearTimeout, Promise, Map, Set, Math, __hobunjiPlayerProfile:{worldId:'session'} };
context.window = context;
context.__farmLog = () => {};
const expandFootprint = (floor, rooms=[]) => {
  const cells = new Set((floor || []).map(([col,row]) => col+','+row));
  for(const room of rooms){
    if(room.tiles)for(const [col,row] of room.tiles)cells.add(col+','+row);
    else for(let row=room.row;row<room.row+room.depth;row++)
      for(let col=room.col;col<room.col+room.width;col++)cells.add(col+','+row);
  }
  return [...cells].map(key=>key.split(',').map(Number));
}; // Headless equivalent of the footprint union needed by procedural cave placement.
context.CavernSculptor={expandFootprint};
context.CavernGenerator={
  caveShape:()=>({base:1,full:2.5}),
  expandCavernMapData(map, rooms){
    map.floor=expandFootprint(map.floor,rooms);
    map.outerRimTiles=[];
  },
};
vm.createContext(context);
for(const path of ['docs/js/cave-site-system.js','docs/js/puzzle-cave-entrances.js'])
  vm.runInContext(fs.readFileSync(path,'utf8'),context,{filename:path});
const Cave=context.CaveSiteSystem,Entrances=context.PuzzleCaveEntrances;
assert(Cave&&Entrances);

const zone='map_independent_puzzle_test';
const ordinaryDens=Array.from({length:6},(_,index)=>({
  id:'animal_den_'+index,x:12+index*8,y:14+index*5,w:3,h:3,
  mouthAnchor:{x:13+index*8,y:17+index*5},
})); // Ordinary caves remain untouched by both independent puzzle sources.
Cave.applyWorkspaceProfiles(zone,{animalDens:ordinaryDens});
const ordinary=Cave.sitesForZone(zone);
assert.equal(ordinary.length,6);
assert(ordinary.every(site=>site.contents!==Cave.TYPES.PUZZLE_CAVE));
assert.equal(Cave.debugSnapshot(zone).caveCount,6);

const shelves=Array.from({length:32},(_,index)=>({
  id:'shelf_'+index,base:{footprint:[[1,1]]},
  footprint:[{c:index*5+2,r:14},{c:index*5+3,r:14},{c:index*5+2,r:15},{c:index*5+3,r:15}],
  x:index*5+2.5,z:14.5,y:2,width:2.1,depth:1.6,
  normal:{x:0,z:1},tangent:{x:1,z:0},
})); // Non-animal mini-cliff candidates that each support a distinct entry and song plate.
const independent=Cave.registerOutdoorPuzzleSites(zone,shelves);
assert(independent.length>=4&&independent.length<=24);
assert(independent.every(site=>site.source==='independent_cliff'&&site.inhabitant==='none'));
assert.equal(JSON.stringify(Cave.registerOutdoorPuzzleSites(zone,shelves)),JSON.stringify(independent));
assert.equal(Cave.sitesForZone(zone).length,ordinary.length,'puzzle density never replaces ordinary cave sites');
assert.equal(Cave.debugSnapshot(zone).outdoorPuzzleCaveCount,independent.length);

const layout={dens:ordinaryDens,transitions:[]},scene={transitions:[]};
const zoneLayouts=new Map([[zone,layout]]),zoneScenes=new Map([[zone,scene]]);
Entrances.init({zoneLayouts,zoneScenes,TILE:1,getCurrentArea:()=>zone,player:{x:0,y:0}});
const gates=Entrances.mount(zone,{balconies:shelves},{add(){},getObjectByName(){return null;}});
assert.equal(gates.length,independent.length);
assert.equal(layout.transitions.length,gates.length);
assert.equal(scene.transitions.length,gates.length);
assert(layout.transitions.every(t=>t.puzzleCaveOnly&&t.target==='puzzle_cave_locked'&&t.targetSpotId==='den_exit'),
  'every independent outdoor transition points to its cavern\'s real entrance, including cached re-entry');
assert.equal(layout.dens.length,ordinaryDens.length,'independent doors never become pack or barbarian home anchors');
Entrances.clear(zone);
assert.equal(layout.transitions.length,0);
assert.equal(scene.transitions.length,0,'teardown removes the scene transition copies too');

function caveMap(id){
  const floor=[];
  for(let row=1;row<=11;row++){
    for(let col=1;col<=11;col++)floor.push([col,row]);
    for(let col=15;col<=25;col++)floor.push([col,row]);
  }
  for(let col=12;col<=14;col++)for(let row=5;row<=6;row++)floor.push([col,row]);
  const walkable=new Set(floor.map(pair=>pair.join(','))),rim=new Set();
  for(const [col,row] of floor)for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const key=(col+dc)+','+(row+dr);
    if(!walkable.has(key))rim.add(key);
  }
  const rimTiles=[...rim].map(key=>key.split(',').map(Number));
  return {id,cols:27,rows:13,floor,exitCol:1,exitRow:5,
    exits:[{id:'den_exit',tiles:[[1,5]],targetMap:''}],
    outerRimTiles:rimTiles,colliders:rimTiles.map(tile=>[...tile]),oreRocks:[],furniture:[],creatureSpawns:[]};
} // Two substantial chambers joined by a narrow mineable corridor, matching real cave constraints.
let hidden=0;
let sampleChild=null,sampleDoor=null,sampleParent=null;
for(let index=0;index<8;index++){
  const id='map_i_test_ordinary_'+index;
  const profile={schema:3,zoneId:zone,denId:'ordinary_'+index,mapId:id,
    signature:'ordinary-test:'+index,contents:'ore_mine',inhabitant:'none',layers:['ore_mine']};
  Cave.__test.sitesByMapId.set(id,profile);
  const map=Cave.decorateCavernMapData(id,caveMap(id));
  assert.equal(map.caveSite.contents,'ore_mine','parent keeps its ordinary contents');
  const plan=Cave.__test.plansByMapId.get(id);
  if(!plan?.puzzleDoor)continue;
  hidden++;
  const door=plan.puzzleDoor;
  const child=Cave.profileForMapId(door.targetMapId);
  const exit=map.exits.find(entry=>entry.id===door.id);
  assert(child&&child.contents==='puzzle_cave'&&child.parentMapId===id);
  assert(exit&&exit.targetMap===child.mapId&&exit.targetSpotId==='den_exit');
  assert(plan.separator.farKeys.includes(door.col+','+door.row));
  assert(map.oreRocks.some(rock=>rock.caveSeparator&&rock.caveSeparatorLayer===1));
  assert(map.caveProps.some(prop=>prop.id===door.id&&prop.key==='cliffDoor'&&prop.alwaysOpen));
  assert(map.oreRocks.length>0,'parent mine and mined separator still contain ore resources');
  sampleChild=child;sampleDoor=door;sampleParent=id;
}
assert(hidden>0,'at least one of eight eligible ordinary caves gets a rock-hidden separate Puzzle Cave');
assert.equal(Cave.debugSnapshot(zone).rockPuzzleCaveCount,hidden);
const childMap=Cave.decorateCavernMapData(sampleChild.mapId,caveMap(sampleChild.mapId));
assert(childMap.cavePuzzle,'the secret destination has its own actual one-room puzzle');
assert.equal(childMap.entrySpots?.den_exit?.col,childMap.exitCol,'named entrance uses real generated cave column');
assert.equal(childMap.entrySpots?.den_exit?.row,childMap.exitRow,'named entrance uses real generated cave row');
assert(childMap.floor.some(([col,row])=>col===childMap.exitCol&&row===childMap.exitRow),
  'cached cave entry is a genuine walkable floor tile, not the synthetic 0,0 fallback');
assert.equal(childMap.creatureSpawns.length,0,'Puzzle Caves have no den encounters');
assert.equal(childMap.exits[0].targetMap,sampleParent,'returning goes to the parent cave, not the wilderness');
assert.equal(childMap.exits[0].targetSpotId,sampleDoor.id,'reciprocal return finds the hidden doorway');
assert.equal(childMap.exits[0].spawnCol,sampleDoor.col);
assert.equal(childMap.exits[0].spawnRow,sampleDoor.row);
// Execute the actual cached-room entry function from game.js, rather than trusting
// just the new map metadata: previously a cached Puzzle Cave spawned at solid 0,0.
{
  const gameSource=fs.readFileSync('docs/game.js','utf8'); // The production entry function is the authority for cached scene behavior.
  const start=gameSource.indexOf('      function enterBuilding(');
  const end=gameSource.indexOf('\n      // Resolves once _buildingScenes',start);
  assert(start>=0&&end>start,'production cached building-entry function is available to regression tests');
  const cached={cols:childMap.cols,rows:childMap.rows,entrySpots:childMap.entrySpots,transitions:[],grid:null,scene:null};
  const player={x:0,y:0,vx:0,vy:0};
  const runtime={
    window:{BuildingEntrySpawn:{fromExit:()=>({col:0,row:0}),arrivalAngle:()=>null},MapLayoutSystem:{resolveActiveLayout:()=>null,currentSnapshot:()=>({})}},
    _buildingScenes:new Map([[sampleChild.mapId,cached]]),_rawMapDataByMapId:new Map(),
    _activeLayoutByMap:new Map([[sampleChild.mapId,'default']]),_isBuildingArea:id=>String(id).startsWith('map_i_'),
    _isCavernBuildingArea:()=>true,
    currentArea:sampleParent,_currentBuildingMapId:'',_pendingEntrySpotId:'',
    _pendingEntrySpawnFromExit:false,_pendingArrivalFromArea:null,
    loadBuildingScene(){throw Error('cached scene unexpectedly regenerated');},
    player,TILE:1,farmPlayerSave:null,buildingSpawnFromExit:()=>({col:0,row:0}),
    setPlayerFacingInstant(){},_snapCameraTarget(){},refreshActionBar(){},logMapSwap(){},
  }; // Cached destination still has the original map's generated SDF entrance.
  vm.createContext(runtime);
  vm.runInContext(gameSource.slice(start,end)+
    '\nenterBuilding('+JSON.stringify(sampleChild.mapId)+',0,0,"den_exit");',runtime);
  assert.equal(player.x,childMap.exitCol+0.5,'cached entry ignores incorrect 0,0 override and uses the named SDF entrance');
  assert.equal(player.y,childMap.exitRow+0.5,'cached entry is positioned on the guaranteed cave entrance row');
}
console.log('Independent Puzzle Caves: ordinary counts, dense mini-cliff gates, inert NPC slots, mined secret doors, safe cached arrivals and reciprocal exits passed.');

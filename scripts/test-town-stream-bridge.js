// Run: node scripts/test-town-stream-bridge.js
'use strict';
const assert = require('node:assert/strict'); // Guards the only town stream crossing while preserving the approved map.
const fs = require('node:fs'); // Loads production map data and the real pathfinder module.
const vm = require('node:vm'); // Executes the pathfinder in a lightweight browser-like context.

const map = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json','utf8')); // The live town map.
const workspace = JSON.parse(fs.readFileSync('docs/config/town-workspace-v1.json','utf8')); // The editor's authoritative town representation.
const town = workspace.maps.find(m => m.id === 'map_hobunji_town'); // Paired map entry for every crossing check.
const recipe = JSON.parse(fs.readFileSync('docs/config/furniture-authored/townStairBridge.json','utf8')); // Exact placed authored bridge.
const index = JSON.parse(fs.readFileSync('docs/config/furniture-authored/index.json','utf8')); // Runtime furniture catalog.
const repaired = ['25,15','26,15','27,15','28,15','23,19','24,19','25,19']; // Seven old path cells that cut across flowing water.
const crossing = ['26,15','27,15','26,16','27,16','25,17','26,17','25,18','26,18','24,19','25,19']; // Walkable stream cells beneath the bridge.
assert(town, 'Town is missing from the workspace');
assert.equal(Object.keys(map.visualHeights).length,653,'Keep the latest main town elevation map after placing the bridge');
assert.deepEqual(town.visualHeights,map.visualHeights,'Editor must retain the updated town elevations');
const ikmc=map.buildings.find(b=>b.id==='bldg_ikmc_outpost'); // Latest main relocation must survive the bridge cherry-pick.
assert(ikmc&&ikmc.gridX===4&&ikmc.gridZ===40,'Preserve the moved IKMC outpost and its porch footprint');
assert.deepEqual(town.buildings.find(b=>b.id==='bldg_ikmc_outpost'),ikmc,'Runtime and editor must share the relocated outpost');
assert.equal(workspace.maps.length,15,'Unrelated town workspace maps must survive the crossing edit');
const workspaceTiles = new Map(town.tiles.map(t=>[t.c+','+t.r,t])); // Match editor and runtime tile coordinates.
for (const key of repaired) {
  assert.equal(map.tiles[key]?.type,'stream','Old road must be replaced by water at '+key);
  assert.equal(workspaceTiles.get(key)?.type,'stream','Editor must show the same water at '+key);
}
for (const key of crossing) {
  assert.equal(map.visualHeights[key],undefined,'Current main cleared raised terrain beneath the bridge at '+key);
  assert.equal(map.tiles[key]?.type,'stream','Bridge must leave water at '+key);
  assert.equal(map.tiles[key]?.bridgeCrossing,true,'Bridge must mark its deck over water at '+key);
  assert.equal(workspaceTiles.get(key)?.bridgeCrossing,true,'Editor must preserve walkable water flag at '+key);
}
assert.equal(map.tiles['28,15']?.bridgeCrossing,undefined,'Water beside the bridge must remain impassable');
assert.equal(map.tiles['23,19']?.bridgeCrossing,undefined,'Unbridged stream remains water');
for (const key of ['27,14','24,21'])
  assert.equal(map.tiles[key]?.type,'path','Bridge must land on the original path at '+key);
assert.equal(map.furniture.length,1,'Exactly one authored bridge spans the repaired stream');
assert.deepEqual(town.furniture,map.furniture,'Editor and game must place the same bridge');
const placement=map.furniture[0]; // Source position, yaw and length used by both renderers and the path test.
assert.equal(placement.key,'townStairBridge');
assert.equal(placement.authoredFurnitureKey,'townStairBridge');
assert.equal(placement.bridgeCrossing,true);
assert.equal(placement.walkableElevation,true,'Characters must stand on the bridge rather than on water');
assert.equal(placement.tileSpanTiles,8);
assert(index.furniture.some(f=>f.key==='townStairBridge'&&f.file==='config/furniture-authored/townStairBridge.json'),
  'Town bridge must be loadable through the shared authored furniture catalog');
assert.equal(recipe.key,'townStairBridge');
assert.equal(recipe.tileSpan.enabled,true);
assert.equal(recipe.tileSpan.axis,'x');
assert.equal(recipe.tileSpan.startTiles,1);
assert.equal(recipe.tileSpan.endTiles,1);
assert.equal(recipe.tileSpan.middleTiles,2);
assert.equal(recipe.tileSpan.totalTiles,8);
assert.deepEqual(recipe.footprint,{w:8,d:2},'Full bridge footprint must be eight by two tiles');
const stairs=recipe.parts.filter(p=>p.name?.includes('staircase')); // Eight rigid authored steps in one-tile-long flights.
const deck=recipe.parts.find(p=>p.name?.includes('bridge deck')); // Only this deck and its rails extend over added center tiles.
const rails=recipe.parts.filter(p=>p.name?.includes('Stretchable railing'));
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-5,label+': '+a+' != '+b);
assert.equal(stairs.length,8,'Both flights keep all four original steps');
assert.equal(rails.length,2,'The deck retains both stretchable railings');
assert.equal(deck.tileSpanRole,'stretch');
for(const side of ['start','end']){
  const parts=stairs.filter(p=>p.tileSpanRole===side);
  assert.equal(parts.length,4);
  const min=Math.min(...parts.map(p=>p.transform.x-p.transform.sx/2));
  const max=Math.max(...parts.map(p=>p.transform.x+p.transform.sx/2));
  near(max-min,1,'Four rigid '+side+' steps occupy one tile in the travel direction');
  assert(parts.every(p=>Math.abs(p.transform.sz-1.8001)<.0001),'Stairs remain two tiles wide');
  assert(parts.every(p=>Math.abs(p.transform.sx-.25)<.0001),'All four steps are scaled, not removed');
  assert(parts.every(p=>p.walkableElevation===true),'Stair treads must participate in physical bridge support');
}
assert.equal(deck.walkableElevation,true,'The deck, not the railing, is physical ground');
assert(recipe.parts.filter(p=>p.walkableElevation).every(p=>p.tileSpanRole!=='none'),'Every support part belongs to the authored span');
assert(rails.every(p=>p.walkableElevation!==true),'Railings cannot become a raised invisible floor');
const start=recipe.parts.find(p=>p.id===deck.tileSpanRoots.start.partId);
const end=recipe.parts.find(p=>p.id===deck.tileSpanRoots.end.partId);
assert(start&&end,'Both deck roots must resolve');
near(start.transform.x+start.transform.sx/2,-1,'Start staircase meets base-length deck');
near(end.transform.x-end.transform.sx/2,1,'End staircase meets base-length deck');
const delta=(placement.tileSpanTiles-recipe.tileSpan.startTiles-recipe.tileSpan.endTiles-recipe.tileSpan.middleTiles)*recipe.tileSpan.tileSize;
near(delta,4,'The middle adds four tiles without changing the stairs');
near(start.transform.x-delta/2+start.transform.sx/2,-3,'Start staircase joins extended deck');
near(end.transform.x+delta/2-end.transform.sx/2,3,'End staircase joins extended deck');

const yaw=placement.rotY*Math.PI/180, cx=placement.col+.5+(placement.postX||0), cz=placement.row+.5+(placement.postZ||0); // Rotated bridge center in actual tile world space.
const cos=Math.cos(yaw),sin=Math.sin(yaw); // THREE Y rotation maps local +X to (cos, -sin) in world XZ.
function worldAt(x,z=0) { return {x:cx+x*cos+z*sin,z:cz-x*sin+z*cos}; }
for(const [x,key] of [[-4,'27,14'],[4,'24,21']]) {
  const point=worldAt(x);
  const [col,row]=key.split(',').map(Number);
  assert(Math.hypot(point.x-(col+.5),point.z-(row+.5))<.7,
    'Bridge stair landing '+x+' must reach existing path tile '+key);
}
for(const key of crossing) {
  const [col,row]=key.split(',').map(Number),dx=col+.5-cx,dz=row+.5-cz;
  const localX=dx*cos-dz*sin,localZ=dx*sin+dz*cos;
  assert(Math.abs(localX)<=4.01&&Math.abs(localZ)<=1.01,'Walkable crossing tile must lie under the actual rotated bridge: '+key);
}
// Terrain crossing stays connected as a water body: the river is not replaced by an invisible road surface.
const water=(col,row)=>map.tiles[col+','+row]?.type==='stream';
const queue=[[24,15]],visited=new Set(['24,15']); // River-side upstream and downstream check points.
for(let i=0;i<queue.length;i++){
  const [col,row]=queue[i];
  for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const x=col+dc,z=row+dr,k=x+','+z;
    if(x<20||x>34||z<13||z>23||visited.has(k)||!water(x,z))continue;
    visited.add(k);queue.push([x,z]);
  }
}
assert(visited.has('29,16'),'The stream remains continuous across the former road cut');

// Run the shipped NPC collision module against town water, not just a regex match.
const context={window:{}};
vm.runInNewContext(fs.readFileSync('docs/js/npc-pathfinding.js','utf8'),context,{filename:'npc-pathfinding.js'});
const grid=Array.from({length:map.rows},()=>Array.from({length:map.cols},()=>({type:'grass'}))); // Real town terrain attributes within each grid cell.
for(const [key,record] of Object.entries(map.tiles)){const [col,row]=key.split(',').map(Number);grid[row][col]={...record};}
context.window.NpcPathfinding.init({
  TileType:{TRENCH:'trench',RIVER:'river',STREAM:'stream'},
  npcGridForArea:()=>grid,isBuildingArea:()=>false,isZoneArea:()=>false,
  isSolid:t=>t==='stream'||t==='river'||t==='wall',
  npcMovementConfig:()=>({collisionRadiusTiles:.22}),
  isTownBuildingCollisionTile:()=>false,
  furnitureOnlyBlocksMovementAt:()=>false
});
assert(context.window.NpcPathfinding.isNpcTileWalkable('town',26,15),'NPCs can walk over the actual bridge tile');
assert(context.window.NpcPathfinding.isNpcTileWalkable('town',25,19),'NPCs can leave the far bridge end');
assert(!context.window.NpcPathfinding.isNpcTileWalkable('town',28,15),'NPCs cannot walk off the bridge into exposed stream');
assert(!context.window.NpcPathfinding.isNpcTileWalkable('farm',26,15),'Bridge metadata never makes farm water passable');

const runtime=fs.readFileSync('docs/js/town-zone-buildings.js','utf8'); // Async town spawn uses exactly the authored tile-span furniture.
const editor=fs.readFileSync('docs/tools/map-editor/index.html','utf8'); // Editor 2D and 3D reflect the in-game bridge.
assert(runtime.includes('window.AuthoredFurniture.load(key)'),'Town must load authored bridge data');
assert(runtime.includes('window.AuthoredFurniture.setTileSpan?.(group, f.tileSpanTiles)'),'Town must resize the middle at placement');
assert(runtime.includes('window.HobunjiWalkableElevation?.refreshFurniture?.()'),'Town must register new walkable bridge after asynchronous spawn');
const elevation = fs.readFileSync('docs/js/town-player-body-elevation-bridge.js','utf8'); // The same existing elevation engine handles true angled bridge bounds.
assert(elevation.includes('containsBridgeFootprint(surface, x, z)'), 'Players cannot stand on water outside the diagonally rotated deck');
assert(elevation.includes('object.userData?.townBridgeCrossing'), 'Exact support is opt-in only for bridge furniture');
assert(editor.includes("townStairBridge: { icon:'🌉'"),'Map Editor must preserve and select the mapped bridge');
assert(editor.includes('window.AuthoredFurniture.load(record.authoredFurnitureKey)'),'Map Editor 3D must render actual authored geometry');
console.log('Town stream bridge: continuous water, 8×2 rotated crossing, rigid stairs, editor, gameplay and NPC walking passed.');

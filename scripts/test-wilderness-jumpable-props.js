#!/usr/bin/env node
'use strict';
// Real runtime contracts: shared indexed landmark support, nonblocking shallow
// roots, culling-independent tree-root contact, and free-jump landing on stone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const browser = {}; // Isolated per-test browser globals, not the Node process.
const zone = 'map_northern_cliffs'; // Active zone for every root/landmark footprint assertion.
let area = zone; // Mutable to verify area-scoped providers cannot collide across maps.
let roots = []; // Mutable scene children emulate a shifted or regenerated wilderness.
let visits = 0; // Counts scene traversal reads; movement probes must never rescan trees.
const scene = { get children() { visits++; return roots; } }; // Native cover's existing single cached scene pass.
const context = vm.createContext({window:browser,console,Math,performance:{now:()=>1000}});
for(const name of ['docs/js/area-footprint-blockers.js','docs/js/nearby-volume-collision.js'])
  vm.runInContext(read(name),context,{filename:name});
const blockers = browser.AreaFootprintBlockers;
const tree = {
  name:'test-native-pine',userData:{wildernessRootSpansLocal:[
    {points:[[0,0,0],[.4,.32,0],[.8,.25,0]],radius:.17}, // A substantial exposed native spine.
    {points:[[0,0,.7],[.4,.015,.7],[.8,.005,.7]],radius:.10}, // Shallow root must remain walk-over.
  ]},
  position:{x:3.5,y:0,z:3.5},rotation:{y:0},scale:{x:1,y:1,z:1},
  visible:true,children:[],parent:scene,
};
roots = [tree];
browser.GridTileAccessors={getCurrentArea:()=>area}; // Production cover init may omit the area getter; use the shared runtime accessor instead.
let residency=0; // Authoritative chunk-stream generation increments when chunks enter or leave the unchanged Three.js scene.
browser.WildernessChunks={residencyVersion:()=>residency}; // Same lightweight getter exported by the real WildernessChunks owner.
browser.NearbyVolumeCollision.init({
  getActiveScene:()=>scene,isCombatActive:()=>false,
  worldSurfaceY:()=>0,player:{x:0,y:0},debugLog(){},
  options:{enabled:false,projectiles:false},
});
assert(blockers.providerIds().includes('wilderness-tree-roots'),'tree roots use one shared physical provider');
const support = blockers.supportAt(zone,4,3.5,.5); // Foot centre sits on the real raised root's sloping spine.
assert(support&&support.y>.35&&support.y<.5,'raised roots expose their actual physical top');
assert.equal(support.kind,'tree root');
assert.equal(blockers.blocksBox(zone,4,3.5,.08,null),true,'raised root stops walking through its body');
assert.equal(blockers.blocksBox(zone,4,3.5,.08,1),false,'jumping clears the same raised root');
assert.equal(blockers.supportAt(zone,4,3.5,.25),null,'a foot below the root crown cannot teleport to its top');
assert.equal(blockers.supportAt('town',4,3.5,1),null,'other areas never receive current-zone root support');
assert.equal(blockers.blocksBox('town',4,3.5,.08),false,'other areas never receive current-zone root collision');
assert.equal(blockers.blocksBox(zone,4,4.2,.04,null),false,'small partly buried roots are walk-over, not invisible tiny walls');
assert.equal(browser.NearbyVolumeCollision.debugSnapshot().rootRidges,2,'mobile diagnostics expose the two cached native roots');

tree.visible=false;browser.NearbyVolumeCollision.invalidate();
assert(blockers.supportAt(zone,4,3.5,.5),'render-only vegetation culling cannot remove physical support');
const detachedChunk={visible:true,children:[tree],parent:scene}; // Real streamed chunk groups contain tree children.
tree.parent=detachedChunk;
roots=[detachedChunk];browser.NearbyVolumeCollision.invalidate();
assert(blockers.supportAt(zone,4,3.5,1),'indexed roots follow the attached chunk subtree');
detachedChunk.parent=null;roots=[]; // Chunk removed from scene; tree.parent still points to the detached chunk.
assert.equal(blockers.supportAt(zone,4,3.5,1),null,'detaching a whole chunk must never leave ghost collision, even before a cache rebuild');
residency++; // A new streamed-chunk residency stamp invalidates the cached root index.
assert.equal(blockers.supportAt(zone,4,3.5,1),null,'residency invalidation detects the disappeared chunk in the unchanged scene');
assert.equal(browser.NearbyVolumeCollision.debugSnapshot().rootRidges,0,'stale roots are not retained in the spatial index');
const replacementTree={...tree,visible:true,name:'new-streamed-tree',parent:null}; // A new tree is placed without replacing the scene object.
const replacementChunk={visible:true,children:[replacementTree],parent:scene};
replacementTree.parent=replacementChunk;roots=[replacementChunk];residency++;
assert(blockers.supportAt(zone,4,3.5,1),'streaming in a new tree registers its roots without manual invalidation');
assert.equal(browser.NearbyVolumeCollision.debugSnapshot().rootResidencyVersion,residency,
  'mobile diagnostics report the chunk version used by the current spatial index');
const cachedVisits=visits; // Movement near a stable resident chunk must never rescan the scene.
for(let i=0;i<100;i++)blockers.supportAt(zone,4,3.5,1);
assert.equal(visits,cachedVisits,'steady-state root support queries perform no fresh scene traversal');
replacementChunk.parent=null;roots=[];residency++;
assert.equal(blockers.supportAt(zone,4,3.5,1),null,'unloading a resident tree removes its landing support');
tree.parent=null;
const regrowthWindow={NearbyVolumeCollision:{invalidations:0,invalidate(){this.invalidations++;}}}; // Isolated actual vegetation-refresh runtime.
vm.runInNewContext(read('docs/js/zone-regrowth.js'),{window:regrowthWindow,console,Math});
regrowthWindow.ZoneRegrowth.init({
  _zoneScenes:new Map([[zone,{}]]),removeZoneVegetationVisual:()=>true,TileType:{WEEDS:'weeds'}
});
assert.equal(regrowthWindow.ZoneRegrowth.updateClearedZoneVegetationVisual(zone,3,3,'shrub'),true);
assert.equal(regrowthWindow.NearbyVolumeCollision.invalidations,1,
  'felling clears root collision in the same tick instead of leaving a fallen trunk obstacle');
// Exercise both production vegetation-rebuild modes: chunked streaming and older full-floor replacement.
const regrowthScene={remove(){},traverse(){}}; // Reused Three.js scene identity must not preserve a stale root index.
const regrowthZone={scene:regrowthScene,grid:[],cols:8,rows:8,chunkController:{}};
const regrowthDeps={
  _zoneScenes:new Map([[zone,regrowthZone]]),_zoneFloorMeshGroups:new Map(),_zoneGrassMeshes:new Map(),
  removeZoneVegetationVisual:()=>true,TileType:{WEEDS:'weeds'},resolveTileMat:()=>null,
  _buildZoneFloorMeshes:()=>[],debugLog(){},
};
regrowthWindow.ZonePlateauMesa={rebuildZoneMesaMeshes(){}};
regrowthWindow.WildernessChunks={rebuildZone:()=>1};
regrowthWindow.WildTreasure={syncZoneInteractivity(){}};
regrowthWindow.ZoneGrassBillboards={buildZoneGrassBillboards:()=>({})};
regrowthWindow.ZoneRegrowth.init(regrowthDeps);
regrowthWindow.ZoneRegrowth.refreshZoneGroundVisuals(zone,3,3);
assert.equal(regrowthWindow.NearbyVolumeCollision.invalidations,2,
  'a chunk-edited tree root invalidates the same-scene collision cache');
regrowthZone.chunkController=null;
regrowthWindow.ZoneRegrowth.refreshZoneGroundVisuals(zone,3,3);
assert.equal(regrowthWindow.NearbyVolumeCollision.invalidations,3,
  'a replaced native forest rebuild invalidates the same-scene collision cache');

// Native free-jump movement consults the same registered footprint's top as its
// collision walls. Deliberately release input above the small cap to land there.
browser.MapBoundaryGuard={isBoundaryTile:()=>false};
browser.ZonePlateauMesa={hasTerrain:()=>false};
browser.DynamicSurfaces={pointInPit:()=>false};
browser.DevRandomRuin={getPlayerGroundSupportY:()=>null};
browser.FallSystem={land:()=>{}};
vm.runInContext(read('docs/js/player-jump.js'),context,{filename:'player-jump.js'});
const cap={minX:3.15,maxX:3.85,minZ:3.15,maxZ:3.85,maxY:.62}; // Representative jump-reachable cairn top.
const overlap=(x,z,half)=>x+half>=cap.minX&&x-half<=cap.maxX&&z+half>=cap.minZ&&z-half<=cap.maxZ;
const unregister=blockers.register('test-cairn',{
  area:zone,
  blocksBox(x,z,half,y){return overlap(x,z,half)&&(y==null||(y>=0&&y<=cap.maxY+.02));},
  supportAt(x,z,maxY){return x>=cap.minX+.06&&x<=cap.maxX-.06&&z>=cap.minZ+.06&&z<=cap.maxZ-.06&&maxY>=cap.maxY
    ?{y:cap.maxY,kind:'landmark',id:'test-cairn'}:null;},
});
const tile=64; // Player coordinates are pixels; all collision/support coordinates are world tiles.
const player={x:2.7*tile,y:3.5*tile,health:100}; // Grounded approach starts just west of the cairn.
const input={x:1,y:0}; // User releases forward movement on reaching the cap.
const grid=Array.from({length:10},()=>Array.from({length:10},()=>({type:'grass',surfaceY:0})));
browser.PlayerJump.init({player,TILE:tile,getCurrentArea:()=>area,getActiveGrid:()=>grid,
  getMovementInput:()=>input,isSolid:()=>false,_isZoneArea:()=>true,worldSurfaceY:()=>0,
  tileSurfaceYInArea:()=>0,getBaseMoveSpeedTiles:()=>3.15,
  getMountRideState:()=>null,canStartFreeJump:()=>true,
  canPlayerOccupyAtHeight:(x,z,feetY)=>!blockers.blocksBox(zone,x/tile,z/tile,.17,feetY+.225),
});
assert(browser.PlayerJump.hasJumpableSupportAhead(2.8*tile,3.5*tile,1,0,.5),
  'steering recognizes the same natural landmark top as jumpable');
assert(browser.PlayerJump.start(),'ordinary jump launches toward the cairn');
for(let i=0;i<90&&player._freeJump?.phase!=='supported';i++){
  if(player.x/tile>3.43)input.x=0;
  browser.PlayerJump.tick(1/60);
}
assert.equal(player._freeJump?.phase,'supported','descending onto the cairn retains the raised walking state');
assert(Math.abs(player.physicalFeetY-cap.maxY)<.02,'the landing is at the stone top, not on the grass below');
assert.equal(browser.PlayerJump.debug.lastEvent,'landed on landmark','mobile jump diagnostics identify the actual supported landmark');
unregister();
assert.equal(blockers.supportAt(zone,3.5,3.5,1),null,'cleared stone cannot leave an invisible collision platform');

// Representative dense forest: one traversal builds cached root buckets, then
// hundreds of movement and jump probes read only their nearby buckets.
roots=Array.from({length:200},(_,i)=>({
  ...tree,name:'root-stress-'+i,visible:true,
  position:{x:3.5+(i%20)*3,y:0,z:3.5+Math.floor(i/20)*3},
  parent:scene,
}));
visits=0;browser.NearbyVolumeCollision.invalidate();
assert(blockers.supportAt(zone,4,3.5,.6),'indexed forest keeps the nearest test root');
for(let i=0;i<600;i++){
  blockers.blocksBox(zone,4,3.5,.08,null);
  blockers.supportAt(zone,4,3.5,1);
}
assert.equal(visits,1,'cached forest geometry is never traversed again on individual movement/jump probes');
assert.equal(browser.NearbyVolumeCollision.debugSnapshot().rootRidges,400,
  'the index includes only native root spines rather than doing new mesh raycasts');
console.log('ok - wilderness landmarks and tree roots use shared jumpable physical support');

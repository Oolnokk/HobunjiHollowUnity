// Regression for the shipped ruin voxel movement and independent jump-shaft platform sides.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'); // Reads real game sources for integration tests.
const runtime=read('docs/js/dev-random-ruin-interior-map.js');
const start=runtime.indexOf('  const SHAFT_BODY_HEIGHT =');
const end=runtime.indexOf('  function shaftCreatureCanEnter(',start);
assert(start>=0&&end>start,'the runtime voxel/body and flight helpers must exist');
const collisionCode=runtime.slice(start,end); // Reuses actual functions without starting the browser-only game runtime.
const makeCollision=new Function('ruin','deps','window','MAP_ID',collisionCode+'\nreturn {shaftBodyBlocksAt,shaftVoxelBlocksAt,flightClear};');
const TILE=64; // Game pixels per world tile in these forced movement fixtures.
const blocks=new Set(['5,2,0','5,2,1','5,2,2','5,2,3','5,2,5']); // A wing border wall with one upper-story cell.
const grid={
  cols:12,rows:8,levels:8,
  xToCol:x=>Math.floor(x),zToRow:z=>Math.floor(z),yToLevel:y=>Math.floor(y),
  colToX:c=>c,rowToZ:r=>r,
  isSolid:(c,r,l)=>blocks.has(c+','+r+','+l),
}; // Mutable voxels prove gate openings immediately update both collision and flight.
const area='map_i_dev_random_ruin';
const ruin={supportY:1,shaftGrids:new Map([['wing',{grid,contains:x=>x<5}]])}; // Walkable area deliberately excludes the actual border stone.
const deps={player:{},getCurrentArea:()=>area};
const scope={DevRandomRuinTileOccupancy:{solidAt:()=>null}};
const collision=makeCollision(ruin,deps,scope,area);
assert(collision.shaftBodyBlocksAt(4.85,2.5,.2,1),'near-face wall blocks a player lunge');
assert(collision.shaftBodyBlocksAt(5.5,2.5,.2,1),'border stone outside the walkable mask still blocks');
assert(!collision.shaftBodyBlocksAt(4.3,2.5,.2,1),'adjacent clear floor stays available');
assert(!collision.shaftBodyBlocksAt(5.5,2.5,.2,7),'lower masonry cannot obstruct an upper story');
assert(collision.shaftBodyBlocksAt(5.5,2.5,.2,5),'upper masonry blocks only at its own height');
assert(!collision.flightClear(4,1.5,2.5,6,1.5,2.5),'Skeeri cannot cross a solid wall');
assert(collision.flightClear(4,7,2.5,6,7,2.5),'Skeeri can cross clear air above the wall');
blocks.clear();
assert(collision.flightClear(4,1.5,2.5,6,1.5,2.5),'opened stone permits flight immediately');
assert(!collision.shaftBodyBlocksAt(5.5,2.5,.2,1),'opened stone permits player motion immediately');
blocks.add('5,2,1');
const movementContext={window:{}};
vm.runInNewContext(read('docs/js/swept-move.js'),movementContext,{filename:'swept-move.js'});
const swept=movementContext.window.SweptMove.sweptMove(4*TILE,2.5*TILE,7*TILE,2.5*TILE,
  (x,z)=>!collision.shaftBodyBlocksAt(x/TILE,z/TILE,.2,1),true); // Full three-tile lunge through real voxel collision.
assert(swept.blockedX,'long combat lunge stops at the first stone wall');
assert(swept.x/TILE<4.81,'lunge may not emerge beyond the wall');
assert(!swept.blockedY,'straight lunge cannot invent a sideways collision');
const clear=movementContext.window.SweptMove.sweptMove(4*TILE,4*TILE,7*TILE,4*TILE,
  (x,z)=>!collision.shaftBodyBlocksAt(x/TILE,z/TILE,.2,1),true);
assert(!clear.blockedX,'clear hallways still permit a full lunge');
const jump=require('../docs/js/ruin-jump-shaft.js'); // Invokes the actual exported slab policy.
const p={x:4,z:4,w:2,d:2,y:3};
assert(jump.platformSlabBlocksAt([p],3,4,.2,2.7),'rolling into the raised slab side is blocked');
assert(jump.platformSlabBlocksAt([p],4,4,.2,2.7),'a body in slab masonry cannot pass');
assert(!jump.platformSlabBlocksAt([p],3,4,.2,3),'standing on the top does not block walking');
assert(!jump.platformSlabBlocksAt([p],4,4,.2,1),'walking below a floating slab is allowed');
assert(!jump.platformSlabBlocksAt([p],8,4,.2,2.7),'faraway slab does not block');
assert(!jump.platformSlabBlocksAt([p],4,4,.2,NaN),'undefined height never causes false collision');
const skeeri=read('docs/js/skeeri-ruins.js');
const locationStart=skeeri.indexOf('  function actorLocation(');
const locationEnd=skeeri.indexOf('  function point(',locationStart);
assert(locationStart>=0&&locationEnd>locationStart,'Skeeri real actorLocation implementation must be present');
const actorLocation=new Function('deps',skeeri.slice(locationStart,locationEnd)+'return actorLocation;')({TILE});
assert.equal(actorLocation({x:TILE,y:TILE,branchSurfaceY:0},{nest:{y:20}}).y,0,'Y=0 is valid flight height');
assert.equal(actorLocation({x:TILE,y:TILE,branchSurfaceY:null},{nest:{y:20}}).y,20,'null flight height uses nest fallback');
const fog=read('docs/js/cloud-forest-fog.js');
const rooms=read('docs/js/ruin-room-system.js');
assert(fog.includes("const mistActive = active && currentArea !== 'map_i_dev_random_ruin'"),'Kanthic no longer draws 3D mist tubes');
assert(fog.includes('syncUndergroundFog(underground && mistActive ? activeScene : null)'),
  'Kanthic keeps no moving depth fog after cylinders are suppressed');
assert(rooms.includes("room?.theme==='kanthic'||room?.theme==='tothal'"),'Kanthic no longer projects hard-edge room light frames');
console.log('ruin-forced-movement-collision: wall borders, upper stories, swept lunges, Skeeri and shaft slabs OK');

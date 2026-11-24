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
assert(collision.shaftBodyBlocksAt(5.5,2.5,.1,null),'heightless player bodies collide with stone above their feet');
assert(!collision.shaftBodyBlocksAt(5.5,2.5,.1,4.4),'a point-sized shot below the upper wall clears the stone');
assert(collision.shaftBodyBlocksAt(5.5,2.5,.1,5.05),'a shot actually inside the upper wall is stopped');
assert(!collision.flightClear(4,1.5,2.5,6,1.5,2.5),'Skeeri cannot cross a solid wall');
assert(collision.flightClear(4,7,2.5,6,7,2.5),'Skeeri can cross clear air above the wall');
blocks.clear();
assert(collision.flightClear(4,1.5,2.5,6,1.5,2.5),'opened stone permits flight immediately');
scope.RuinJumpShaft={flightBlockedAt:(x,z,radius,y)=>x>=5&&x<=5.5&&z===2.5&&y>=2.5&&y<=3}; // A solid raised slab crossed by this bird.
assert(!collision.flightClear(4,2.7,2.5,6,2.7,2.5),'Skeeri cannot fly through a jump-shaft slab');
delete scope.RuinJumpShaft;
assert(!collision.shaftBodyBlocksAt(5.5,2.5,.2,1),'opened stone permits player motion immediately');
const duplicateWall={...grid,isSolid:(c,r,l)=>c===5&&r===2&&l===1}; // An uncarved wing allocation overlaps the real open hub portal.
ruin.shaftGrids=new Map([
  ['shaft-hub',{grid,contains:()=>true}],
  ['wing-overlap',{grid:duplicateWall,contains:()=>true}],
]);
scope.RuinLayerPlayable={selectGrid:grids=>grids.get('shaft-hub').grid}; // Same hub-first ownership as the shipped layered ruin.
assert(!collision.shaftBodyBlocksAt(5.5,2.5,.2,null),
  'a correctly open shaft portal cannot become an invisible wall from the overlapping wing allocation');
assert(collision.flightClear(4,1.5,2.5,6,1.5,2.5),
  'Skeeri may cross a real open shaft/wing junction even if an unowned grid still has border stone');
scope.RuinLayerPlayable={selectGrid:()=>null};
assert(collision.shaftBodyBlocksAt(5.5,2.5,.2,null),
  'unowned border stone still blocks where no playable grid claims the aperture');
delete scope.RuinLayerPlayable;
ruin.shaftGrids=new Map([['wing',{grid,contains:x=>x<5}]]);
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
assert(!jump.platformSlabBlocksAt([p],4,4,.1,2.1,.1),'a height-aware shot clears the underside of the slab');
assert(jump.platformSlabBlocksAt([p],4,4,.1,2.7,.1),'a shot inside the slab itself is blocked');
assert(!jump.platformSlabBlocksAt([p],8,4,.2,2.7),'faraway slab does not block');
assert(!jump.platformSlabBlocksAt([p],4,4,.2,NaN),'undefined height never causes false collision');
const jumpSource=read('docs/js/ruin-jump-shaft.js');
const connector=read('docs/js/ruin-shaft-connector.js');
assert(jumpSource.includes('footprintBlockers?.register?.(slabBlockerId,'),'shaft sides are wired into shared collision');
assert.equal(typeof jump.flightBlockedAt,'function','Skeeri slab collision uses the actual mounted jump shaft');
assert(jumpSource.includes('footprintBlockers?.remove?.(slabBlockerId)'),'shaft side colliders are cleaned up on exit');
assert(connector.includes('tradition:ruin.theme,getPlayerY'),'shaft side collision receives the actual player story height');
const skeeri=read('docs/js/skeeri-ruins.js');
const locationStart=skeeri.indexOf('  function actorLocation(');
const locationEnd=skeeri.indexOf('  function point(',locationStart);
assert(locationStart>=0&&locationEnd>locationStart,'Skeeri real actorLocation implementation must be present');
const actorLocation=new Function('deps',skeeri.slice(locationStart,locationEnd)+'return actorLocation;')({TILE});
assert.equal(actorLocation({x:TILE,y:TILE,branchSurfaceY:0},{nest:{y:20}}).y,0,'Y=0 is valid flight height');
assert.equal(actorLocation({x:TILE,y:TILE,branchSurfaceY:null},{nest:{y:20}}).y,20,'null flight height uses nest fallback');
const fog=read('docs/js/cloud-forest-fog.js');
const rooms=read('docs/js/ruin-room-system.js');
assert(fog.includes('const mistActive = active;'),'Kanthic uses real Cloud Forest mist instead of suppressing its 3D layers');
assert(fog.includes('syncUndergroundFog(underground && mistActive ? activeScene : null)'),
  'restored Kanthic mist also uses the existing underground depth-fog path');
assert(rooms.includes('withLightRegion(_ctx,_project,draw)')&&rooms.includes('roomIsolated:!!active'),
  'all ruin traditions isolate light sources by room without any projected screen-space frames');
console.log('ruin-forced-movement-collision: wall borders, upper stories, swept lunges, Skeeri and shaft slabs OK');

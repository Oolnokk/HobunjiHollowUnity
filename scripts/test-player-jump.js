#!/usr/bin/env node
'use strict';

// Execute the actual free-jump runtime without WebGL. Covers launch, air
// motion, ledge/cover height rules, raised support, and the existing input hook.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
const source = read('docs/js/player-jump.js'); // Runtime under test.
const integration = read('docs/js/climb-system.js'); // Existing context input keeps its jump fallback.
const gameSource = read('docs/game.js'); // Canonical movement/render loop owns free-jump motion.
const ruinSource = read('docs/js/dev-random-ruin-interior-map.js'); // Multi-story ruin reconciliation must not snap airborne feet.
const index = read('docs/index.html'); // Confirms load order for the modular runtime.
const coverSource = read('docs/js/nearby-volume-collision.js'); // Shared furniture bounds source for jumps and projectiles.

for (const name of ['docs/js/player-jump.js', 'docs/js/climb-system.js', 'docs/js/nearby-volume-collision.js']) {
  new vm.Script(read(name), { filename: name });
}
assert(integration.includes('window.PlayerJump?.init?.(injectedDeps)'));
assert(gameSource.includes('if (window.PlayerJump?.tick?.(dt)) return;'), 'game loop must tick jump independently');
assert(gameSource.includes('sweptMove(player.x, player.y, desiredX, desiredY, canPlayerDodgeOccupy)'),
  'midair dodge must reach the native swept movement handler with real foot-height collision');
{
  const begin=gameSource.indexOf('      function canPlayerDodgeOccupy(wx, wy) {');
  const end=gameSource.indexOf('      function canPlayerOccupy(wx, wy) {',begin);
  assert(begin>0&&end>begin,'the native dodge collision bridge exists');
  const actor={_freeJump:{phase:'air'},physicalFeetY:6};
  const calls=[];
  const probe=new Function('player','canPlayerOccupyAtHeight','canPlayerOccupy',
    gameSource.slice(begin,end)+'\nreturn canPlayerDodgeOccupy;')(actor,
      (x,z,y)=>{calls.push(['raised',x,z,y]);return true;},
      (x,z)=>{calls.push(['ground',x,z]);return false;});
  assert.equal(probe(4,5),true,'airborne dodge uses the height-aware collision authority');
  assert.deepEqual(calls.pop(),['raised',4,5,6]);
  actor._freeJump={phase:'supported'};
  assert.equal(probe(6,5),true,'upper-gallery supported dodge also uses physical feet');
  actor._freeJump=null;
  assert.equal(probe(6,5),false,'ground dodges retain the ordinary movement collider');
  assert.deepEqual(calls.pop(),['ground',6,5]);
}
assert(gameSource.includes('player._freeJump ? player.physicalFeetY'), 'renderer uses physical jump height');
assert(gameSource.includes('getBaseMoveSpeedTiles: () => MOVE_SPEED / TILE'), 'ordinary player speed drives airborne travel');
assert(gameSource.includes('canPlayerOccupyAtHeight, // Jump uses native world collision'), 'jump uses the native height-aware collision authority');
assert(gameSource.includes('function furnitureBlocksMovementAt(area, x, z, worldY = null)'), 'furniture collision now understands optional height');
assert(gameSource.includes('furnitureBlocksMovementAt(currentArea, x, z, feetY + 0.05)'), 'non-cover furniture remains solid when jumping');

assert(gameSource.includes('return canOccupyAt(wx, wy, radius, footprintY); // canOccupyAt offsets by radius'), 'native tile cover tests the foot volume above the supported deck');

// Execute the real game-owned height probe in isolation, not a mock that
// accidentally skips the player's collision-radius conversion.
{
  const begin = gameSource.indexOf('      function canPlayerOccupyAtHeight(');
  const end = gameSource.indexOf('\n      function canPlayerOccupy(wx, wy)', begin);
  assert(begin >= 0 && end > begin, 'native physical-height probe is present');
  const func = gameSource.slice(begin, end); // Same source shipped in the main game loop.
  const world = {
    GridTileAccessors: { getActiveGrid: () => Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ type: 'floor' }))) },
    InteriorDoorTiles: { blocksBox: () => false },
    AreaFootprintBlockers: { blocksBox: () => false },
    FurnitureTableSystem: { blocksBox: () => false },
  };
  let tileFeetY = null; // Captures the native tile collision sample height after radius conversion.
  const radius = 16 * .72 / 64; // Expected footprint radius in tile units for this isolated probe.
  const probe = new Function('window', 'currentArea', 'TILE', 'PLAYER_RADIUS', 'furnitureBlocksMovementAt', 'canOccupyAt', 'canPlayerOccupy',
    func + '\nreturn canPlayerOccupyAtHeight;')(
      world, 'zone-test', 64, 16, () => false, (_x, _z, pxRadius, worldY) => {
        tileFeetY = worldY - pxRadius / 64;
        return tileFeetY > 1.11;
      }, () => false);
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), true, 'standing atop a rock is not blocked by a sample below its surface');
  assert(Math.abs(tileFeetY - 1.155) < .001, 'tile collision samples just above the physical feet');
  world.FurnitureTableSystem.blocksBox = () => true;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'an independent full-footprint table still blocks');
  world.FurnitureTableSystem.blocksBox = () => false;
  world.AreaFootprintBlockers.blocksBox = () => true;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'an independent full-footprint obstacle still blocks');
  world.AreaFootprintBlockers.blocksBox = () => false;
  const thinBarrier = (_area, _x, _z, half, worldY) => half >= radius - 1e-6 && worldY < 1.34;
  world.AreaFootprintBlockers.blocksBox = thinBarrier;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'thin height-limited footprint blocks the body even between corner samples');
  world.AreaFootprintBlockers.blocksBox = () => false;
  world.FurnitureTableSystem.blocksBox = thinBarrier;
  assert.equal(probe(3.5 * 64, 3.5 * 64, 1.1), false, 'thin height-limited furniture blocks the full player footprint');
  world.FurnitureTableSystem.blocksBox = () => false;
  const Jump = require('../docs/js/ruin-jump-shaft.js'); // The production slab-side volume is the source of truth for raised shaft platforms.
  const raisedSlabs = [
    {x:3.5,z:3.5,w:2,d:2,y:4},
    {x:5,z:3.5,w:1,d:1,y:4.55},
  ]; // Grounded probes must clear their own elevated slab while still hitting a higher adjacent side.
  world.AreaFootprintBlockers.blocksBox = (_area,x,z,half,worldY) =>
    Jump.platformSlabBlocksAt(raisedSlabs,x,z,half,worldY,half);
  assert.equal(probe(3.5*64,3.5*64,4),true,'standing on a raised jump slab no longer collides with its own top');
  assert.equal(probe(4.4*64,3.5*64,4),false,'a taller neighbouring slab still blocks walking through its side');
  const Hub = require('../docs/js/shaft-hub.js'); // The upper-ring regression uses real shaft voxel cells, not invented floor collision.
  const hub = Hub.compose({seed:5,floors:2,chambers:false,wall:8,shaft:23,spacing:6,
    traversal:'jumpPlatforms',entranceSide:'S',theme:'tothal',portals:[{floor:0,side:'N'}]});
  assert(hub.ok && hub.stories[1].gallery.length>0,'a real upper gallery is generated for collision verification');
  const gridLevel = hub.options.spacing; // The real upper-ring voxel layer, used to find its solid boundary and deck.
  const directions = [[1,0],[-1,0],[0,1],[0,-1]]; // Four immediate neighbours used to locate a genuine adjacent wall.
  const edge = hub.stories[1].gallery.map(cell => {
    const offset = directions.find(([dx,dz]) => hub.grid.inBounds(cell.col+dx,cell.row+dz,gridLevel)
      && hub.grid.isSolid(cell.col+dx,cell.row+dz,gridLevel));
    return offset ? {cell,wall:{col:cell.col+offset[0],row:cell.row+offset[1]}} : null;
  }).find(Boolean);
  assert(edge,'an upper gallery abuts a real shaft wall');
  const worldCell = cell => ({x:hub.grid.colToX(cell.col+.5),z:hub.grid.rowToZ(cell.row+.5)});
  const deck = worldCell(edge.cell), wall = worldCell(edge.wall); // Both are tested at their physical world X/Z.
  const deckY = hub.grid.levelToY(gridLevel); // Exact supported height above the ring's floor voxel.
  const voxelStart = ruinSource.indexOf('  function shaftVoxelBlocksAt(');
  const voxelEnd = ruinSource.indexOf('  function shaftBodyBlocksAt(',voxelStart);
  assert(voxelStart>=0 && voxelEnd>voxelStart,'the real ruin voxel collider remains available for the regression');
  const shaftVoxelBlocksAt = new Function('ruin','deps','window','MAP_ID',
    ruinSource.slice(voxelStart,voxelEnd)+'\nreturn shaftVoxelBlocksAt;')(
      {shaftGrids:new Map([['shaft-hub',{grid:hub.grid}]])},
      {getCurrentArea:()=> 'map_i_dev_random_ruin'},
      {RuinLayerPlayable:{selectGrid:()=>hub.grid}},'map_i_dev_random_ruin');
  assert(shaftVoxelBlocksAt(deck.x,deck.z,radius,deckY+.05-radius,deckY+.05+radius),
    'the old feet-centred collision probe reproduces the upper-ring floor obstruction');
  world.AreaFootprintBlockers.blocksBox = (_area,x,z,half,worldY) =>
    shaftVoxelBlocksAt(x,z,half,worldY-half,worldY+half);
  assert.equal(probe(deck.x*64,deck.z*64,deckY),true,'the corrected full movement probe clears the real upper-gallery deck');
  assert.equal(probe(wall.x*64,wall.z*64,deckY),false,'real upper-gallery masonry remains impassable');
}

assert(ruinSource.includes('const freeJump=deps.player?._freeJump;'), 'native ruin floor reconciliation must honor airborne jump state');
assert(integration.includes('return window.PlayerJump?.start?.() || false; // Empty ground'));
assert(index.indexOf('js/player-jump.js?') < index.indexOf('js/climb-system.js?'));
assert(coverSource.includes('function movementCoverNear('));
assert(coverSource.includes('movementCoverNear,'));

const TILE = 64; // Player positions use pixels, semantic colliders use world/tile units.
const groundTile = () => ({ type: 'floor', surfaceY: 0 });
function harness({ rock = null, furniture = null, wall = null, pit = null, start = { x: 2.5, z: 3.5 },
  heightBlocked = null, deepSupportY = null, geometry = null } = {}) {
  const grid = Array.from({ length: 9 }, () => Array.from({ length: 10 }, groundTile));
  if (rock) grid[rock.row][rock.col] = { type: 'rock', rockKind: 'undiggableBoulder', projectileCoverHeightTiles: rock.top, top: rock.top };
  if (wall) grid[wall.row][wall.col] = { type: 'wall' };
  if (pit) for (let col = pit.firstCol; col <= pit.lastCol; col++) grid[pit.row][col] = { type: 'void' }; // An empty floor must never become jump support.
  const player = { x: start.x * TILE, y: start.z * TILE, health: 100, climbing: false }; // ClimbSystem's player model.
  let activeArea = 'zone-test'; // Simulated scene transition for state cleanup tests.
  let canJump = true; // Simulates game activity ownership (dialogue/minigames) without a DOM.
  const input = { x: 0, y: 0 }; // Mutable analog movement vector sampled every air/ground step.
  const furnitureNode = furniture && {
    name: furniture.name || 'test_furniture',
    userData: { projectileCoverHeightTiles: furniture.top, projectileCoverRadiusTiles: furniture.radius },
    position: { x: furniture.x, y: 0, z: furniture.z },
    scale: { x: 1, y: 1, z: 1 }, visible: true, children: [],
  };
  const scene = { children: furnitureNode ? [furnitureNode] : [] }; // Minimal scene for the real semantic-cover spatial index.
  if (furnitureNode) furnitureNode.parent = scene;
  const window = {
    ZonePlateauMesa: { hasTerrain: () => !!geometry, surfaceYAt: (_area, x, z) => geometry?.(x, z) ?? null }, // Same interface as the generated triangle index.
    MapBoundaryGuard: { isBoundaryTile: () => false },
    GridTileAccessors: { isHouseFootprint: () => false, isFarmBuildingCollisionTile: () => false, isTownBuildingCollisionTile: () => false },
    InteriorDoorTiles: { blocksBox: () => false }, // Closed doors must never be treated as low cover.
    DevRandomRuin: { groundLandings: 0, acceptFreeJumpLanding(y) { this.groundLandings++; this.lastY = y; }, getPlayerGroundSupportY: () => null }, // Confirmed ground landings must be reported once.
    ProjectileTileCover: { coverTop(tile) { return tile?.type === 'rock' ? tile.top : null; } },
    AreaFootprintBlockers: { surfaceYAt: () => null, blocksBox: () => false },
    DynamicSurfaces: {
      sampleSupport: (x, z, opts = {}) => deepSupportY != null && x >= 3
        && deepSupportY >= (opts.minY ?? -Infinity) && deepSupportY <= (opts.maxY ?? Infinity)
        ? { y: deepSupportY, id: 'deep-floor' } : null,
      blockerAt: () => null,
    },
    FallSystem: { land: () => null },
  };
  const context = { window, console, performance: { now: () => 1000 } };
  vm.runInNewContext(coverSource, context, { filename: 'nearby-volume-collision.js' });
  window.NearbyVolumeCollision.init({
    getActiveScene: () => scene, isCombatActive: () => false, debugLog() {},
    player, worldSurfaceY: () => 0,
    options: { enabled: false, projectiles: false },
  }); // Even disabled projectile hit checks must not disable the shared cover-height geometry.
  vm.runInNewContext(source, context, { filename: 'player-jump.js' });
  window.PlayerJump.init({
    player, TILE,
    getCurrentArea: () => activeArea,
    getActiveGrid: () => grid,
    getMovementInput: () => input,
    isSolid: type => type === 'rock' || type === 'wall',
    _isZoneArea: () => true,
    tileSurfaceYInArea: tile => tile.surfaceY ?? 0,
    worldSurfaceY: () => 0,
    getMountRideState: () => 'none',
    canStartFreeJump: () => canJump,
    canPlayerOccupy: () => true,
    canPlayerOccupyAtHeight: (wx, wy, feetY) => !heightBlocked?.(wx / TILE, wy / TILE, feetY),
    furnitureBlocksMovementAt: () => false,
  });
  function advance(seconds) {
    const frames = Math.ceil(seconds * 60);
    for (let i = 0; i < frames; i++) window.PlayerJump.tick(1 / 60);
  }
  return { window, context, grid, player, input, advance, setArea: area => { activeArea = area; }, setCanJump: allowed => { canJump = !!allowed; } };
}

{
  // A cliff plate is a local slab over a raised structural support, not the ordinary ground.
  const h = harness({start:{x:3.5,z:3.5}});
  vm.runInNewContext(read('docs/js/dynamic-surfaces.js'), h.context);
  const ds = h.window.DynamicSurfaces;
  const shelf = {id:'mini-cliff',x:3.5,z:3.5,y:3}; // Both records belong to the same shelf.
  let slabY = 3.08; // Live plate height changes without changing the structural cap.
  ds.registerSurface({id:'cap',shelfId:shelf.id,topY:shelf.y,bounds:{minX:3,maxX:4,minZ:3,maxZ:4}});
  ds.registerSurface({id:'plate',shelfId:shelf.id,plateArea:'zone-test',topY:()=>slabY,bounds:{minX:3.25,maxX:3.75,minZ:3.25,maxZ:3.75}});
  const accepted = []; // Capture the ownership boundary using the real jump solver.
  h.window.ClimbSystem = {acceptBalconyLanding(id,y){accepted.push([id,y]);return false;}};
  h.window.PlayerJump.beginFlight({x:3.5,y:4,z:3.5,vy:-1},{source:'test cliff'});
  h.advance(.6);
  assert.equal(h.player._freeJump?.phase,'supported','landing on an elevated plate never resets to ordinary ground');
  assert.equal(h.player.physicalFeetY,3.08);
  assert.equal(h.window.DevRandomRuin.groundLandings,0);
  slabY = 3.03;
  h.advance(.1);
  assert.equal(h.player.physicalFeetY,3.03,'depression follows the live plate');
  h.input.x=1;
  h.advance(.12);
  assert.equal(h.player.physicalFeetY,3,'stepping off the plate retains the mini-cliff cap');
  assert.equal(h.player._freeJump?.phase,'supported');
  assert(accepted.every(([id])=>id===shelf.id),'both plate and bare cap retain the shelf identity');
  h.input.x=0;
  h.window.ClimbSystem.acceptBalconyLanding = (id,y)=>{h.player.onCliffBalcony=id;h.player._cliffBalconyY=shelf.y;return true;};
  h.advance(1/60);
  assert.equal(h.player._freeJump,null,'successful cliff handoff releases jump ownership');
  assert.equal(h.player.onCliffBalcony,shelf.id);
  assert.equal(h.player.physicalFeetY,3,'handoff preserves physical feet');
}
{
  // Mount real voxel-backed cliff support and a live cylinder slab, then use the real cliff handoff.
  const h=harness({start:{x:3.5,z:3.5}});
  vm.runInNewContext(read('docs/js/dynamic-surfaces.js'),h.context);
  const DS=h.window.DynamicSurfaces;
  const route=require('../docs/js/cliff-route-network.js');
  const CG=require('../docs/js/cell-grid-3d.js');
  const elevated=require('../docs/js/cliff-elevated-surfaces.js');
  const shelf={id:'real-cap',x:3.5,z:3.5,y:3,width:2,depth:1.4,
    tangent:{x:1,z:0},normal:{x:0,z:1},footprint:[2,3,4].map(c=>({c,r:3}))};
  const net={area:'zone-test',balconies:[shelf],routes:[]};
  assert(elevated.mount(net,{DynamicSurfaces:DS,CellGrid3D:CG,isActive:()=>true}).ok);
  h.window.CliffRouteNetwork={...route,forGrid:()=>net};
  h.window.CliffElevatedSurfaces=elevated;
  vm.runInNewContext(integration,h.context);
  h.window.ClimbSystem.init({player:h.player,TILE,getCurrentArea:()=>net.area,getActiveGrid:()=>h.grid,
    _isZoneArea:()=>true,isSolid:()=>false,tileSurfaceYInArea:()=>0,worldSurfaceY:()=>0,
    getMovementInput:()=>h.input,getMountRideState:()=>'none',canPlayerOccupyAtHeight:()=>true});
  const elements=[1,0,0,0,0,1,0,0,0,0,1,0,3.5,3.035,3.5,1]; // Live slab transform in world units.
  const mesh={userData:{},matrixWorld:{elements},updateWorldMatrix(){},geometry:{
    parameters:{radiusTop:.46},boundingBox:{min:{x:-.46,y:-.045,z:-.46},max:{x:.46,y:.045,z:.46}}}};
  DS.registerSurface(DS.pressurePlateSurface(mesh,{id:'real-plate',scope:'puzzle-cave-cliff-door:zone-test',plateArea:net.area,shelfId:shelf.id}));
  assert(Math.abs(DS.samplePressurePlate(net.area,3.5,3.5,3,3.25).y-3.08)<1e-8);
  assert.equal(DS.samplePressurePlate('other-zone',3.5,3.5,3,3.25),null);
  h.window.PlayerJump.beginFlight({x:3.5,y:4,z:3.5,vy:-1},{source:'real cliff plate'});
  h.advance(.6);
  assert.equal(h.player.onCliffBalcony,shelf.id,'real jump restores the existing cliff movement owner');
  assert.equal(h.player._freeJump,null);
  assert.equal(h.player._cliffBalconyY,3,'stored shelf height does not inherit the plate');
  assert(Math.abs(h.player.physicalFeetY-3.08)<1e-8);
  elements[13]-=.05;
  assert(Math.abs(DS.samplePressurePlate(net.area,3.5,3.5,3,3.25).y-3.03)<1e-8,'physical cylinder tracks depression');
  h.input.x=1;
  assert(h.window.ClimbSystem.updateBalcony(.25));
  assert.equal(h.player.onCliffBalcony,shelf.id,'normal cliff walking leaves the slab without losing its owner');
  assert.equal(DS.samplePressurePlate(net.area,h.player.x/TILE,h.player.y/TILE,3,3.25),null);
  assert.equal(elevated.supportAt(net,h.player.x/TILE,h.player.y/TILE,3).y,3);
  h.input.x=0;
  h.player.onCliffBalcony=null;
  h.player.x=3.5*TILE;h.player.y=3.5*TILE;
  h.window.PlayerJump.beginFlight({x:3.5,y:1,z:3.5,vy:-1},{source:'under cliff'});
  h.advance(.6);
  assert.equal(h.player.onCliffBalcony,null,'a lower actor is not teleported onto an overhead plate');
  assert.equal(h.player.physicalFeetY,0);
  elevated.clear(net.area);
  DS.remove('real-plate');
  assert.equal(DS.sampleSupport(3.5,3.5,{area:net.area}),null,'unloading leaves neither an invisible cliff nor a plate');
}
{
  // Execute supported walking, not just the isolated collision helper: grounded ruin platforms must permit ordinary input.
  const Jump = require('../docs/js/ruin-jump-shaft.js'); // Real slab-volume collision is shared by the runtime and this regression.
  const h = harness({start:{x:3.5,z:3.5},deepSupportY:2}); // A raised dynamic support remains available for the entire test walk.
  const platforms = [{x:3.5,z:3.5,w:3,d:3,y:2},{x:5.15,z:3.5,w:.9,d:.9,y:2.65}]; // The second slab is a genuine collision at lower walking height.
  h.window.AreaFootprintBlockers.blocksBox = (_area,x,z,half,y) => Jump.platformSlabBlocksAt(platforms,x,z,half,y,half);
  h.player._freeJump={area:'zone-test',phase:'supported',feetY:2,launchGround:2,vy:0,vx:0,vz:0};
  h.player.physicalFeetY=2;
  h.input.x=1;
  h.advance(.2);
  assert(h.player.x/TILE>3.7,'walking input moves the player across the raised shaft platform without jumping');
  h.advance(.6);
  assert(h.player.x/TILE<4.7,'the higher neighbouring platform still blocks grounded sideways penetration');
  assert(h.window.PlayerJump.debug.blockedMoves>0,'mobile-visible jump diagnostics retain the detected platform-side obstruction');
}
{
  // Real PlayerJump runtime with a roof top and interior ladder handoff: first and second jumps must retain raised support.
  const h = harness({ heightBlocked: () => true, start: { x: 2.5, z: 3.5 } }); // Simulates the native house-shell collision beneath the rooftop.
  const roofY = 1.75; // This fixture uses zero terrain elevation; live IKMC adds its town ground offset.
  h.setArea('town');
  const overRoof = (x,z) => x >= 2 && x < 3 && z >= 3 && z < 4; // Only the one-tile test roof footprint grants elevated passage.
  h.window.HobunjiWalkableElevation = {
    worldSurfaceTopAt(x,z,base,area,maxY=Infinity) {
      return area === 'town' && overRoof(x,z) && roofY <= maxY + .01 ? roofY : base;
    },
    isBalconyAt(x,z,y,area) { return area === 'town' && overRoof(x,z) && Math.abs(y-roofY) <= .25; },
    isAboveBalconyAt(x,z,y,area) { return area === 'town' && overRoof(x,z) && y >= roofY - .2; },
  }; // Shared physics API distinguishes the near-deck hatch predicate from air travel over the deck.
  h.window.GridTileAccessors.isTownBuildingCollisionTile = (col,row,area,feetY) =>
    area === 'town' && col === 2 && row === 3 &&
      !h.window.HobunjiWalkableElevation.isAboveBalconyAt(col+.5,row+.5,feetY,area);
  assert.equal(h.window.PlayerJump.enterRoofSupport({topY:roofY,col:2,row:3,balconyId:'ikmc_rooftop'}),true,
    'only the explicit ladder transition grants the initial roof height');
  assert.equal(h.player._freeJump?.phase,'supported');
  assert.equal(h.window.PlayerJump.start(),true,'roof-supported player can initiate the first free jump');
  h.input.x=.2; // Small input verifies collision while moving upward, without walking off the roof test tile.
  h.advance(.2);
  assert(h.player.physicalFeetY > roofY+.2,'jump actually lifts the player above the balcony deck');
  assert.equal(h.window.PlayerJump.debug.blockedMoves,0,'the outpost shell does not collide with the rising jumper');
  h.input.x=0;
  h.advance(1.4);
  assert.equal(h.player._freeJump?.phase,'supported','landing on rooftop retains raised-support ownership');
  assert(Math.abs(h.player.physicalFeetY-roofY)<.01,'landing returns to the actual rooftop surface');
  assert.equal(h.window.PlayerJump.start(),true,'a second jump from the same roof works');
  assert.equal(h.window.PlayerJump.debug.starts,2,'two roof jumps really launched');
  h.window.FurnitureTableSystem={blocksBox:()=>true}; // A separate table on the deck must not become intangible via the roof exception.
  assert.equal(h.window.PlayerJump.canOccupyAir(2.5,3.5,roofY+.3),false,
    'native roof-shell bypass still rejects independent furniture collisions');
}
{
  // The shipped rooftop uses a narrow rail: walking must stop, but a normal jump clears it and falls to ground.
  const roofY = 1.75, railHeight = .46; // Mirrors the authored IKMC deck and lowered rail in a one-tile fixture.
  const h = harness({ start: { x: 2.5, z: 3.5 },
    heightBlocked: (x,z,feetY) => x>=2 && x<3 && z>=3 && z<4 && feetY<roofY-.2 }); // Shell remains solid beneath the deck.
  h.setArea('town');
  const overRoof = (x,z) => x>=2 && x<3 && z>=3 && z<4; // The elevated support disappears beyond the rail.
  const railOverlaps = (x,z,half) => Math.abs(x-3)<=half+.045 && z+half>=3 && z-half<=4; // Narrow boundary face, not the entire deck tile.
  h.window.HobunjiWalkableElevation = {
    worldSurfaceTopAt(x,z,base,area,maxY=Infinity) {
      return area==='town' && overRoof(x,z) && roofY<=maxY+.01 ? roofY : base;
    },
    isBalconyAt(x,z,y,area) { return area==='town' && overRoof(x,z) && Math.abs(y-roofY)<=.25; },
    isAboveBalconyAt(x,z,y,area) { return area==='town' && overRoof(x,z) && y>=roofY-.2; },
    railBlocksBox(x,z,half,feetY=null,actorHeight=0) {
      return railOverlaps(x,z,half) && (feetY==null ||
        (feetY+actorHeight>=roofY-.05 && feetY<=roofY+railHeight+.05));
    },
  };
  h.window.GridTileAccessors.isTownBuildingCollisionTile = (col,row,area,feetY) =>
    area==='town' && col===2 && row===3 &&
      !h.window.HobunjiWalkableElevation.isAboveBalconyAt(col+.5,row+.5,feetY,area);
  h.window.AreaFootprintBlockers.blocksBox = (area,x,z,half,feetY) =>
    area==='town' && h.window.HobunjiWalkableElevation.railBlocksBox(x,z,half,feetY);
  assert(h.window.PlayerJump.enterRoofSupport({topY:roofY,col:2,row:3,balconyId:'ikmc_rooftop'}));
  h.input.x=1;
  h.advance(.4);
  assert(h.player.x/TILE<2.79,'supported walking cannot ghost through the mid-height fence beams');
  assert(h.window.PlayerJump.debug.blockedMoves>0,'a blocked balcony walk produces mobile collision diagnostics');
  assert(h.window.PlayerJump.start(),'the same railing remains traversable with an ordinary jump');
  h.advance(1.8);
  assert(h.player.x/TILE>3.2,'jumping carries the actor past the rooftop perimeter');
  assert.equal(h.player._freeJump,null,'descending past the rooftop must land on exterior ground');
  assert.equal(h.window.PlayerJump.debug.lastEvent,'landed on ground','roof-to-ground drop retains normal ground landing');
}
{
  const h = harness();
  assert.equal(h.window.PlayerJump.start(), true, 'empty ground must be jumpable');
  const { launchSpeed, gravity } = h.window.PlayerJump.config; // Validate the configured half-height apex independent of frame stepping.
  const priorApex = 6.25 ** 2 / (2 * 11.8); // Previously shipped base height, used only as a regression reference.
  assert(Math.abs(launchSpeed ** 2 / (2 * gravity) - priorApex / 2) < 0.001,
    'base jump must reach half of its former apex without changing gravity');
  assert.equal(gravity, 11.8, 'halving takeoff height must not alter gravity or falling behavior');
  assert.equal(h.player._freeJump?.takeoffY, 0, 'a fresh jump retains physical takeoff height for ruin wall-grab filtering');
  assert.equal(!!h.player.climbing, false, 'free jump must not lock the wall-climb action state');
  let apex = 0;
  for (let i = 0; i < 85; i++) {
    h.advance(1 / 60);
    apex = Math.max(apex, h.player.heightAboveGround || 0);
  }
  assert(apex > 0.72 && apex < 0.86, 'base jump apex is now approximately 0.83 world units');
  assert.equal(h.player.climbing, false, 'land on flat terrain frees ordinary movement');
  assert.equal(h.player._freeJump, null, 'flat landing clears transient state');
  assert.equal(h.window.DevRandomRuin.groundLandings, 1, 'a confirmed ground landing is reported exactly once');
}


{
  // Exercise the actual PlayerJump and ClimbSurfaces modules together, with
  // no movement input and the character facing away from the ladder.
  const h = harness({ pit: { row: 3, firstCol: 2, lastCol: 8 }, start: { x: 5.52, z: 3.5 } });
  h.context.self = h.window; // Browser UMD climb owner installs onto the same window as PlayerJump.
  vm.runInNewContext(read('docs/js/climb-surfaces.js'), h.context, { filename: 'climb-surfaces.js' });
  h.window.ClimbSurfaces.init({ player: h.player, TILE, getCurrentArea: () => 'zone-test',
    getFeetY: () => h.player._freeJump?.feetY ?? 0 });
  h.window.ClimbSurfaces.register({ id: 'shaft-ladder-contact', scope: 'shaft-hub',
    autoCatch: true, axis: 'z', plane: 5, normal: { x: 1, z: 0 },
    u0: 3, u1: 4, y0: 0, y1: 4 });
  const flight = h.window.PlayerJump.beginFlight({ x: 5.52, y: 3.7, z: 3.5,
    vx: 0, vy: -0.1, vz: 0 }, { source: 'ruin ledge fall', deliberate: false });
  assert(flight);
  h.advance(.05);
  assert(h.player.onClimbSurface, 'passive vertical contact must attach to the shaft ladder in the real jump loop');
  assert.equal(h.player._freeJump, null, 'catch transfers ownership from the real physical fall');
  assert(Math.abs(h.player.wallClimbY - 3.7) < .1, 'fall-catch keeps the airborne feet instead of resetting to ground');
  assert.equal(h.window.PlayerJump.debug.lastEvent, 'caught shaft ladder while falling');
}
{
  const h = harness({ pit: { row: 3, firstCol: 2, lastCol: 8 }, start: { x: 5.52, z: 3.5 } });
  h.context.self = h.window;
  vm.runInNewContext(read('docs/js/climb-surfaces.js'), h.context, { filename: 'climb-surfaces.js' });
  h.window.ClimbSurfaces.init({ player: h.player, TILE, getCurrentArea: () => 'zone-test' });
  h.window.ClimbSurfaces.register({ id: 'shaft-ladder-release', scope: 'shaft-hub',
    autoCatch: true, axis: 'z', plane: 5, normal: { x: 1, z: 0 },
    u0: 3, u1: 4, y0: 0, y1: 4 });
  h.window.PlayerJump.beginFlight({ x: 5.52, y: 3.7, z: 3.5,
    vx: 0, vy: -0.1, vz: 0, noGrab: true }, { source: 'wall climb release', deliberate: true });
  h.advance(.05);
  assert.equal(h.player.onClimbSurface, undefined, 'deliberate Dodge release cannot be caught immediately');
  assert(h.player._freeJump, 'the original fall remains active after Dodge');
}

{
  const h = harness({ rock: { col: 4, row: 3, top: 0.6 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE > 4.5, 'an airborne player can jump over low finite-height rock cover');
  assert.equal(h.player.climbing, false, 'clearing the rock ends in an ordinary floor landing');
}

{
  const h = harness({ rock: { col: 4, row: 3, top: 0.65 }, start: { x: 3.45, z: 3.5 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 90; i++) {
    if (h.player.x / TILE > 4.25) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'land on top of a rock instead of passing through it');
  assert(Math.abs(h.player.physicalFeetY - 0.65) < .01);
  assert(h.player.heightAboveGround > 0.6, 'height includes elevation gained from standing on cover');
  assert(h.window.PlayerJump.start(), 'a second press jumps again from the elevated support');
  h.advance(.15);
  assert(h.player.physicalFeetY > 0.65);
}

{
  const h = harness({ furniture: { x: 4.5, z: 3.5, top: 0.65, radius: .48 }, start: { x: 3.45, z: 3.5 } });
  assert.equal(h.window.NearbyVolumeCollision.movementCoverNear(4.5, 3.5, .2)[0].topY, 0.65,
    'jump uses combat cover geometry even with projectile cover switched off');
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 90; i++) {
    if (h.player.x / TILE > 4.35) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'furniture is an elevated landing target');
  assert(Math.abs(h.player.physicalFeetY - 0.65) < .01);
}

{
  const h = harness({ rock: { col: 4, row: 3, top: 1.1 }, start: { x: 3.45, z: 3.5 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.2);
  assert(h.player.x / TILE < 3.84, 'previously reachable 1.1-unit cover is now too high for a base jump');
}

{
  const h = harness({ wall: { col: 4, row: 3 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.84, 'infinite/solid walls stay impassable at any jump height');
  assert.equal(h.player.climbing, false);
}

{
  const h = harness();
  assert(h.window.PlayerJump.start());
  const before = h.window.PlayerJump.debug.starts;
  assert(h.window.PlayerJump.start(), 'pressing Jump while airborne is handled');
  assert.equal(h.window.PlayerJump.debug.starts, before, 'no unintended double jumping');
}

{
  const h = harness();
  assert(h.window.PlayerJump.start());
  h.setArea('zone-different'); // A scene transition invalidates the previous transient jump.
  const prior = h.window.PlayerJump.debug.starts;
  assert(h.window.PlayerJump.start(), 'the next press must recover from stale airborne state');
  assert.equal(h.window.PlayerJump.debug.starts, prior + 1, 'the second press must launch a new physical jump');
}

{
  const h = harness({ pit: { row: 3, firstCol: 3, lastCol: 7 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 200; i++) {
    if (h.player.x / TILE > 4.5) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player.climbing, false, 'falling into an unsupported pit must hand control back to world physics');
  assert.equal(h.window.PlayerJump.debug.lastEvent, 'unsupported fall returned to safe ground');
  assert.equal(h.window.PlayerJump.debug.active, false, 'fall must relinquish movement control');
  assert(h.player.x / TILE < 3.01, 'an unsupported ordinary-map fall restores walkable ground rather than abandoning the player over void');
}

{
  const h = harness();
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1 / 60);
  assert.equal(h.player.inputX, 1, 'airborne movement intent stays visible to targeting systems');
  assert.equal(h.player.inputStrength, 1, 'airborne input strength remains accurate');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.grid[3][4] = { type: 'floor', incline: true };
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE < 3.85, 'jump must not pass through a cliff incline ring');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.window.InteriorDoorTiles.blocksBox = (_area, x) => x >= 3.85;
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE < 3.85, 'jump must not pass through closed doors');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.window.GridTileAccessors.isTownBuildingCollisionTile = col => col === 4;
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.4);
  assert(h.player.x / TILE < 3.85, 'zone buildings retain collision during jump');
}

{
  const h = harness();
  h.setCanJump(false);
  assert.equal(h.window.PlayerJump.start(), false, 'owned cutscenes/dialogue block ordinary free jumps');
  h.setCanJump(true);
  assert(h.window.PlayerJump.start(), 'the same input works again once the movement lock ends');
}

{
  const h = harness({ furniture: { x: 4.5, z: 3.5, top: 1.1, radius: .48 },
    start: { x: 3.45, z: 3.5 } });
  h.window.AreaFootprintBlockers.blocksBox = (_area, x) => x >= 3.85;
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.85, 'overlapping independent footprint remains solid above low cover');
}
{
  const h = harness({ furniture: { x: 4.5, z: 3.5, top: 1.1, radius: .48 },
    start: { x: 3.45, z: 3.5 }, heightBlocked: x => x >= 3.85 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.85, 'an unrelated world blocker cannot be bypassed by a low table');
}
{
  const h = harness({ rock: { col: 4, row: 3, top: 1.1 },
    start: { x: 3.45, z: 3.5 }, heightBlocked: x => x >= 3.85 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.5);
  assert(h.player.x / TILE < 3.85, 'low rock cannot bypass a separate world collider');
}
{
  const h = harness({ pit: { row: 3, firstCol: 3, lastCol: 7 }, deepSupportY: -10 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 260; i++) {
    if (h.player.x / TILE > 4.5) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'fall continues past seven units to a ten-unit-deep floor');
  assert(Math.abs(h.player.physicalFeetY + 10) < .01, 'deep landing uses physical lower elevation');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, geometry: (x, z) => x >= 4 && x <= 5 && z >= 3 && z <= 4 ? 0.7 : null });
  h.grid[3][4] = { type: 'floor', incline: true }; // Reserved incline cells are finite rendered geometry, not infinite walls.
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(1.2);
  assert(h.player.x / TILE > 4.2, 'airborne feet can clear the actual cliff skin inside an incline tile');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, geometry: () => null });
  h.grid[3][4] = { type: 'floor', incline: true };
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.3);
  assert(h.player.x / TILE > 4, 'an empty part of an indexed incline has no invisible tile wall');
}
{
  const h = harness({ start: { x: 3.5, z: 3.5 }, wall: { col: 4, row: 3 } });
  h.input.x = 1; h.input.y = 0.4;
  assert(h.window.PlayerJump.start());
  h.advance(0.5);
  assert(h.player.y / TILE > 3.9, 'diagonal approach slides along an unclimbable wall');
  assert(h.window.PlayerJump.debug.slides > 0);
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 } });
  h.grid[3][4] = { type: 'floor', surfaceY: 0.65 }; // Plateau top in the adjacent tile.
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 85; i++) {
    if (h.player.x / TILE > 4.3) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert(h.player.x / TILE > 4, 'crossing the adjacent plateau height permits entry');
  assert.equal(h.player._freeJump, null, 'plateau landing returns to ordinary grounded movement');
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, deepSupportY: 0.65 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  for (let i = 0; i < 85; i++) {
    if (h.player.x / TILE > 4.3) h.input.x = 0;
    h.advance(1 / 60);
  }
  assert.equal(h.player._freeJump?.phase, 'supported', 'adjacent dynamic minicliff/platform is reachable when feet cross its elevation');
  assert(Math.abs(h.player.physicalFeetY - 0.65) < 0.01);
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, rock: { col: 4, row: 3, top: 0.65 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.5);
  assert(h.window.PlayerJump.debug.assists > 0, 'clearing a collider finds a forward landing within one tile');
  const before = h.player.x; // Releasing input cancels remaining assisted movement immediately.
  h.input.x = 0;
  h.advance(0.05);
  assert.equal(h.player.x, before);
}
{
  const h = harness({ start: { x: 3.45, z: 3.5 }, rock: { col: 4, row: 3, top: 0.65 }, heightBlocked: x => x > 4.05 });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.9);
  assert(h.player.x / TILE <= 4.05, 'landing assist cannot lerp through an independent collider');
}
{
  const h = harness();
  const ctx = { window: h.window, self: h.window, console }; // Execute the real authored wall-climb owner beside PlayerJump.
  vm.runInNewContext(read('docs/js/climb-surfaces.js'), ctx);
  h.window.ClimbSurfaces.init({ player: h.player, TILE, getFeetY: () => h.player._freeJump?.feetY ?? 0 });
  h.window.ClimbSurfaces.register({ id: 'air-wall', axis: 'z', plane: 3.1, u0: 3, u1: 4, y0: 0, y1: 6, normal: { x: -1, z: 0 } });
  h.input.x = 1;
  assert(h.window.PlayerJump.start());
  h.advance(0.3);
  assert(h.player.onClimbSurface, 'airborne contact automatically grabs a registered climbable wall');
  assert.equal(h.player._freeJump, null, 'a grab transfers ownership out of the free jump');
  assert(h.player.wallClimbY > 0, 'grab preserves airborne height instead of restarting from the floor');
}
{
  const h = harness({ geometry: x => x >= 4 && x <= 5 ? (x - 4) * 2 : null });
  h.grid[3][4] = { type: 'floor', incline: true };
  assert(h.window.PlayerJump.start());
  h.player.x = 4.45 * TILE;
  h.player._freeJump.feetY = 1.26;
  h.player._freeJump.vy = -1;
  h.advance(0.15);
  assert(h.player.x / TILE < 4.45, 'falling onto an unclimbable face slides downhill even without input');
  assert(h.player._freeJump.feetY > 0, 'slope contact never falls through the rock shell');
}
{
  const h = harness(); // Uses the real free-fall physics while replacing only the two grab callbacks.
  let regrabs = 0; // Counts wall/route auto-grab attempts that a deliberate release must suppress.
  h.window.ClimbSurfaces = { tryAirGrab() { regrabs++; return true; } };
  h.window.ClimbSystem = { tryAirGrab() { regrabs++; return true; } };
  const flight = h.window.PlayerJump.beginFlight({
    x: 2.5, y: 3, z: 3.5, vy: 0, noGrab: true,
  }, { source: 'wall climb release', deliberate: true });
  assert(flight, 'a released climb transfers to physical airborne movement');
  h.advance(0.1);
  assert.equal(regrabs, 0, 'the released grip cannot immediately reattach during falling');
  assert(h.player._freeJump?.feetY < 3, 'gravity lowers the player from the original wall height');
  h.advance(1);
  assert.equal(h.player._freeJump, null, 'the fall lands and restores ordinary movement');
}

{
  const h = harness();
  const { launchSpeed, gravity } = h.window.PlayerJump.config;
  const easyRise = h.window.PlayerJump.easyJumpRise; // Shared comfortable apex controls whether short ruin obstacles claim the climb action.
  assert(Math.abs(easyRise - (launchSpeed ** 2 / (2 * gravity) - 0.12)) < 1e-6,
    'ruin jump/climb cutoff derives from the current physical jump with room below the apex');
  assert(easyRise > 0.65 && easyRise < 0.83, 'jumpable 0.65-unit objects should not trigger climbing');

  // Execute the actual ruin ledge scan with a finite, standable dynamic support.
  const interactions = read('docs/js/dev-random-ruin-interactions.js');
  const begin = interactions.indexOf('  function nearestLedge(options = {}) {');
  const end = interactions.indexOf('\n  window.ClimbSystem?.registerWorldClimbProvider?', begin);
  assert(begin >= 0 && end > begin, 'ruin ledge scan still supplies the native climb provider');
  const scan = new Function('window', 'deps', 'playerWorldPosition', 'cfg', 'DS', 'openAt',
    'LEDGE_MAX_RISE', 'LEDGE_MIN_RISE', 'LEDGE_REACH',
    interactions.slice(begin, end) + '\nreturn nearestLedge;');
  let topY = 0.65; // Standable object height is changed below to straddle the jump-to-climb threshold.
  const nearestLedge = scan({
    PlayerJump: h.window.PlayerJump, DevRandomRuin: { getPlayerSupportY: () => 0 },
  }, { player: { angle: 0, climbing: false } },
  () => ({ x: 2.5, y: 0, z: 3.5 }),
  (_key, fallback) => fallback,
  { sampleSupport: (x, z) => x >= 3.1 && x < 5 && Math.abs(z - 3.5) < 0.7
    ? { id: 'standable-low-dais', y: topY } : null },
  () => true, 1.75, 0.44, 1.35);
  assert.equal(nearestLedge({ facingOnly: true }), null,
    'short ruin object is not converted into scripted climb');
  topY = easyRise + 0.12;
  const tall = nearestLedge({ facingOnly: true });
  assert(tall && Math.abs(tall.topY - topY) < 1e-6,
    'ledge above comfortable jump range still provides a scripted climb');
  let lavaProbeHeight = null; // Ensures the emergency lava-rim escape shares the climb scanner's physical height.
  const physicalNearest = scan({ PlayerJump: h.window.PlayerJump,
    DevRandomRuin: { getPlayerGroundSupportY: () => 0, getPlayerSupportY: () => 0.30 },
    DevRandomRuinRopeRewards: { lavaClimbRise: position => { lavaProbeHeight = position.y; return 0; } },
  }, { player: { angle: 0, climbing: false } }, () => ({ x: 2.5, y: 0.30, z: 3.5 }),
  (_key, fallback) => fallback,
  { sampleSupport: (x, z) => x >= 3.1 && x < 5 && Math.abs(z - 3.5) < 0.7
    ? { id: 'raised-dais', y: 0.90 } : null }, () => true, 1.75, 0.44, 1.35);
  assert(physicalNearest({ facingOnly: true }),
    'a visually eased player mesh cannot make a physically too-high ledge look jumpable');
  assert.equal(lavaProbeHeight, 0, 'lava-rim escape and climb selection measure from physical feet');
}

{
  const h=harness({start:{x:3.5,z:3.5},deepSupportY:2});
  assert(h.window.PlayerJump.start(),'start a real airborne jump before dodging');
  h.advance(.05);
  const flight=h.player._freeJump;
  assert(flight&&flight.phase==='air');
  h.player.dodging=true;
  assert.equal(h.window.PlayerJump.tick(1/60),false,
    'PlayerJump must not consume the real native dodge frame while gravity stays active');
  h.advance(.05);
  assert.equal(h.player._freeJump,flight,'midair dodge never cancels the ballistic jump');
  assert(h.player.physicalFeetY>0,'midair dodge retains the upper-story physical elevation');
}
{
  const h=harness({start:{x:3.5,z:3.5},deepSupportY:2});
  h.player._freeJump={area:'zone-test',phase:'supported',feetY:2,launchGround:2,
    vy:0,vx:0,vz:0,elapsed:0,source:'free jump',safeX:3.5,safeZ:3.5}; // Simulates arrival on a genuine upper gallery dynamic support.
  h.player.physicalFeetY=2;
  h.player.dodging=true;
  assert.equal(h.window.PlayerJump.tick(1/60),false,
    'supported-gallery dodge remains in the native dash handler');
  h.advance(.12);
  assert.equal(h.player._freeJump?.phase,'supported','dodging along a raised gallery does not erase supported motion');
  assert.equal(h.player.physicalFeetY,2,'the raised gallery maintains physical elevation throughout the dodge');
}

{
  // Run the actual resource compositor through the native airborne and raised-support sweeps.
  const setup = (inputX, wind, yaw = 0, rotated = false, blocked = false) => {
    const h = harness({ start: { x: 3.5, z: 3.5 }, heightBlocked: blocked ? (x => x > 3.5) : null });
    vm.runInContext(read('docs/js/combat/resource-system.js'), vm.createContext({ window: h.window, performance: { now: () => 1000 } }));
    const rs = h.window.ResourceSystem;
    Object.assign(h.player, { maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100 });
    rs.initEntity(h.player);
    h.window.GameRandom.random = () => 0;
    if (wind) rs.addAffliction(h.player, 'windblownStamina', wind);
    h.window.FeyIllusions = { movementRotationRad: () => yaw };
    h.input.x = inputX; h.input.rotationApplied = rotated;
    assert(h.window.PlayerJump.start());
    h.advance(.2);
    return { dx: h.player.x - 3.5 * TILE, dy: h.player.y - 3.5 * TILE, footing: h.player.footing, height: h.player.physicalFeetY, h, rs };
  };
  const base = setup(1, 0);
  const withWind = setup(1, 100);
  const against = setup(-1, 100);
  const idle = setup(0, 100);
  const demented = setup(1, 100, Math.PI / 2);
  const shoulder = setup(1, 100, Math.PI / 2, true);
  const blocked = setup(1, 100, 0, false, true);
  const near = (a,b) => assert(Math.abs(a-b) < 1e-6, a + ' != ' + b);
  near(withWind.dx, base.dx * 1.75); near(against.dx, -base.dx * .25);
  near(idle.dx, base.dx * .75); near(idle.footing, 100);
  near(withWind.footing, 97); near(against.footing, 100);
  near(demented.dx, idle.dx); near(demented.dy, base.dx); near(demented.footing, 100);
  near(shoulder.dx, withWind.dx); near(shoulder.dy, 0);
  near(withWind.height, base.height); // Statuses never alter jump height or gravity.
  near(blocked.dx, 0); near(blocked.footing, 100);
  const weighted = setup(0, 0);
  weighted.rs.addAffliction(weighted.h.player, 'weightlessStamina', 50);
  weighted.h.input.x = 1;
  const x = weighted.h.player.x;
  weighted.h.advance(.2);
  near(weighted.h.player.x-x, base.dx*2);
}

console.log('player-jump ok');

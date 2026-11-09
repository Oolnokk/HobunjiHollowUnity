const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Audit-hardening coverage intentionally includes sub-tile first edges, blocked-overlap escape, and the real cutscene planner seam.
const repo = path.resolve(__dirname, '..');
const pathfindingSource = fs.readFileSync(path.join(repo, 'docs/js/npc-pathfinding.js'), 'utf8');
const routeGraphSource = fs.readFileSync(path.join(repo, 'docs/js/npc-route-graph.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(repo, 'docs/game.js'), 'utf8');
const openGrid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ type: 0, crop: false })));
const logs = [];
const window = {
  __farmLog: message => logs.push(message),
  AreaFootprintBlockers: {
    blocksBox(area, x, z, half = 0) {
      if (area !== 'interior') return false;
      const overlaps = (minX, maxX, minZ, maxZ) => x + half > minX && x - half < maxX && z + half > minZ && z - half < maxZ; // Shared exact-box probe for the wall cases below.
      if (overlaps(2.0, 2.12, 0, 2.2)) return true; // Thin wall between tile centers x=1.5 and x=2.5.
      if (overlaps(4.0, 5.0, 3.0, 3.12)) return true; // Separate wall used to prove a chair escape cannot tunnel through a later blocker.
      return overlaps(1.78, 1.92, 2.78, 2.96); // Sub-tile spur crossed by an offset real start but missed by the start tile center.
    },
  },
};
const context = vm.createContext({ window, console, Math, Number, Date, Object, Array, Map, Set, WeakMap, WeakSet, Promise });
vm.runInContext(pathfindingSource, context, { filename: 'npc-pathfinding.js' });

const deps = {
  isBuildingArea: () => false,
  isZoneArea: () => false,
  npcGridForArea: () => openGrid,
  getGrid: () => openGrid,
  getInteriorGrid: () => openGrid,
  getTownGrid: () => openGrid,
  isSolid: type => type === 1,
  TileType: { TRENCH: 2, RIVER: 3, STREAM: 4 },
  worldObjects: new Map(),
  isHouseFootprint: () => false,
  isTownBuildingCollisionTile: () => false,
  furnitureBlocksMovementAt: (area, x, z) => area === 'interior' && (
    (x > 4.05 && x < 4.95 && z > 4.05 && z < 4.95) || // Chair target/starting overlap.
    (x > 3.15 && x < 3.85 && z > 4.2 && z < 4.8) // Intervening table that must remain solid even on a final seat approach.
  ),
  npcMovementConfig: () => ({ beelineSampleStepTiles: 0.25, collisionRadiusTiles: 0.22 }),
  npcTransitionPool: () => [],
  buildingScenes: new Map(),
  loadBuildingScene: () => {},
  buildingSpawnFromExit: () => ({ col: 0, row: 0 }),
};
window.NpcPathfinding.init(deps);

// Regression: the farm grid is intentionally different from the wilderness grid.
const zoneGrid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ type: 0, crop: false }))); // Active zone terrain for collision and arrival tests.
zoneGrid[2][2].type = 1; // A zone wall where the farm is clear: the historical mismatch stranded followers.
deps.isZoneArea = area => area === 'wilderness_test';
deps.npcGridForArea = area => area === 'wilderness_test' ? zoneGrid : openGrid;
assert.equal(window.NpcPathfinding.isNpcTileWalkable('wilderness_test', 2, 2), false, 'wilderness pathfinding must read the zone wall, not the farm floor');
assert.equal(window.NpcPathfinding.isNpcTileWalkable('wilderness_test', 2, 3), true, 'a walkable wilderness neighbor remains traversable');
zoneGrid[3][2].skipFloor = true; // Plateau floor is rendered by its continuous mesa lid, not by the flat grid mesh.
zoneGrid[3][3].mapBoundary = true; // Map-border escarpments are not traversable even if marked grass.
assert.equal(window.NpcPathfinding.isNpcTileWalkable('wilderness_test', 2, 3), true, 'wilderness skipFloor retains walkable plateau-lid traversal');
assert.equal(window.NpcPathfinding.isNpcTileWalkable('wilderness_test', 3, 3), false, 'wilderness mapBoundary blocks movement');
assert.match(gameSource, /w\.root\._pendingZoneAdd === mapId[\s\S]{0,600}nearestWalkableTile\?\.\(mapId, fromC, fromR\)/, 'pending wilderness followers revalidate their entry tile after their zone is built');
assert.match(gameSource, /npcRunLeanPivot\.add\(avatarGroup\)/, 'the running portrait pivots independently of its feet and tool root');
const initialFurnitureBlocks = deps.furnitureBlocksMovementAt; // Preserves the existing interior furniture fixture during wilderness spawn tests.
deps.furnitureBlocksMovementAt = (area, x, z) => area === 'wilderness_test' && Math.floor(x) === 0 && Math.floor(z) === 0 || initialFurnitureBlocks(area, x, z);
const furnishedArrival = window.NpcPathfinding.nearestWalkableTile('wilderness_test', 0, 0);
assert.notDeepEqual([furnishedArrival.c, furnishedArrival.r], [0, 0], 'wilderness spawns do not remain inside blocking outdoor furniture');
assert.equal(window.NpcPathfinding.isNpcTileWalkable('wilderness_test', furnishedArrival.c, furnishedArrival.r), true);
const zoneArrival = window.NpcPathfinding.nearestWalkableTile('wilderness_test', 2, 2);
assert.notDeepEqual([zoneArrival.c, zoneArrival.r], [2, 2], 'wilderness entry relocates a blocked arrival');
assert.equal(window.NpcPathfinding.isNpcTileWalkable('wilderness_test', zoneArrival.c, zoneArrival.r), true);
assert.equal(window.NpcPathfinding.isNpcTileWalkable('interior', 1, 1), true);
assert.equal(window.NpcPathfinding.canNpcBeeline('interior', 1.5, 1.5, 3, 1), false, 'thin wall must break a beeline');

const detour = window.NpcPathfinding.findNpcPath('interior', 1.5, 1.5, 3, 1, { padding: 3 });
assert.ok(detour && detour.length, 'pathfinder should find a detour around thin wall');
assert.ok(detour.some(p => p.row >= 2), 'detour should leave blocked direct row');
for (let i = 0; i < detour.length; i++) {
  const from = i ? detour[i - 1] : { col: 1, row: 1 };
  const to = detour[i];
  assert.equal(window.NpcPathfinding.canNpcTraverse('interior', from.col + .5, from.row + .5, to.col + .5, to.row + .5), true);
}

const offsetStartPath = window.NpcPathfinding.findNpcPath('interior', 1.5, 2.85, 2, 2, { padding: 3 });
assert.ok(offsetStartPath?.length, 'offset real start should still find a path around a sub-tile spur');
const offsetFirst = offsetStartPath[0]; // Validates the actual first swept edge instead of trusting the start tile center.
assert.equal(window.NpcPathfinding.canNpcTraverse('interior', 1.5, 2.85, offsetFirst.col + .5, offsetFirst.row + .5), true, 'first path edge must be clear from the NPC real sub-tile position');

assert.equal(window.NpcPathfinding.findNpcPath('interior', 3.5, 3.5, 4, 4, { padding: 2 }), null, 'ordinary pathing still treats chair furniture as occupied');
const seatPath = window.NpcPathfinding.findNpcPath('interior', 3.5, 3.5, 4, 4, { padding: 2, allowOccupiedTarget: true });
assert.ok(seatPath?.length, 'seat pathing may enter occupied furniture only inside its final target tile');

// game.js hands its live walker array to trackWalkerArray where it creates it.
assert.match(gameSource, /window\._npcWalkers = window\.NpcPathfinding\?\.trackWalkerArray\?\.\(npcWalkers\)/, 'game.js must register its live walker array for collision-aware movement');
window._npcWalkers = window.NpcPathfinding.trackWalkerArray([]);
const walker = {
  area: 'interior',
  rec: { id: 'live_npc' },
  root: { position: { x: 1.5, z: 1.5 } },
  moveToward(tx, tz) { this.root.position.x = tx; this.root.position.z = tz; return true; },
  _tryStartGridPath() { return false; },
};
window._npcWalkers.push(walker);
walker.moveToward(3.5, 1.5, 1);
assert.notEqual(walker.root.position.x, 3.5, 'decorated live walker may not tunnel through wall');
assert.equal(window.NpcPathfinding.isNpcPositionWalkable('interior', walker.root.position.x, walker.root.position.z), true, 'blocked move resolves to clear space');

walker.root.position.x = 1.5; walker.root.position.z = 1.5;
assert.equal(walker._tryStartGridPath({ c: 3, r: 1, routeId: 'test' }), true);
assert.ok(walker._gridPath.some(p => p.row >= 2), 'gameplay fallback path uses edge-aware detour');

// An unreachable target (occupied chair, not a seat approach) is retried every
// frame by the scheduler; a repeat from the same tile must not re-run the search.
const skippedBefore = window.NpcPathfinding.debugSnapshot().pathFailuresSkipped;
assert.equal(walker._tryStartGridPath({ c: 4, r: 4, routeId: 'test' }), false, 'occupied chair is unreachable for a non-seat target');
assert.equal(walker._tryStartGridPath({ c: 4, r: 4, routeId: 'test' }), false, 'repeat attempt still fails');
assert.equal(window.NpcPathfinding.debugSnapshot().pathFailuresSkipped, skippedBefore + 1, 'repeat failure from the same tile is skipped, not re-searched');
walker.root.position.x = 2.5; walker.root.position.z = 2.5;
assert.equal(walker._tryStartGridPath({ c: 4, r: 4, routeId: 'test' }), false);
assert.equal(window.NpcPathfinding.debugSnapshot().pathFailuresSkipped, skippedBefore + 1, 'moving to a new tile searches again');
walker.root.position.x = 1.5; walker.root.position.z = 1.5;
assert.equal(walker._tryStartGridPath({ c: 3, r: 1, routeId: 'test' }), true, 'a reachable target is not held back by an earlier failure');

const chairEscapeWalker = {
  area: 'interior',
  rec: { id: 'chair_escape_npc' },
  root: { position: { x: 4.5, z: 4.5 } },
  moveToward(tx, tz) { this.root.position.x = tx; this.root.position.z = tz; return true; },
};
window._npcWalkers.push(chairEscapeWalker);
chairEscapeWalker.moveToward(4.5, 3.5, 1);
assert.equal(chairEscapeWalker.root.position.z, 3.5, 'a seated NPC can leave its existing furniture overlap into clear space');
chairEscapeWalker.root.position.x = 4.5; chairEscapeWalker.root.position.z = 4.5;
chairEscapeWalker.moveToward(4.5, 2.5, 1);
assert.equal(chairEscapeWalker.root.position.z, 4.5, 'escaping an existing chair overlap may not tunnel through a later structural wall');

const seatApproachWalker = {
  area: 'interior',
  rec: { id: 'seat_approach_npc' },
  currentScheduleTarget: { pose: 'sit', c: 4, r: 4 },
  root: { position: { x: 2.8, z: 4.5 } },
  moveToward(tx, tz) {
    const dx = tx - this.root.position.x, dz = tz - this.root.position.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(0.4, d); // Mimics an ordinary small frame step whose temporary endpoint is still in the table tile.
    if (d > 1e-6) { this.root.position.x += dx / d * step; this.root.position.z += dz / d * step; }
    return d <= step;
  },
};
window._npcWalkers.push(seatApproachWalker);
seatApproachWalker.moveToward(4.5, 4.5, 1);
assert.equal(window.NpcPathfinding.isNpcPositionWalkable('interior', seatApproachWalker.root.position.x, seatApproachWalker.root.position.z), true, 'small final-seat steps may exempt only the chair tile, never an intervening table tile');
assert.ok(seatApproachWalker.root.position.x < 3.15 || Math.abs(seatApproachWalker.root.position.z - 4.5) > 0.25, 'blocked seat approach must stop or move around the table instead of entering it');


// A walker pressing into a blocker its stale route/grid path never accounted
// for must drop that path and re-plan on the live collision grid.
const stuckWalker = {
  area: 'interior',
  rec: { id: 'stuck_npc' },
  currentScheduleTarget: { c: 3, r: 1, routeId: 'stale_route' },
  state: 'on-route',
  routePath: [{ c: 3, r: 1 }], _routePathTargetKey: 'stale_route|3,1', routeNode: { c: 1, r: 1 },
  root: { position: { x: 1.7, z: 1.5 } },
  moveToward(tx, tz) { this.root.position.x = Math.min(tx, this.root.position.x + 0.3); this.root.position.z = tz; return false; },
  _tryStartGridPath() { return false; },
};
window._npcWalkers.push(stuckWalker);
for (let i = 0; i < 30 && stuckWalker.state === 'on-route'; i++) stuckWalker.moveToward(3.5, 1.5, 0.3);
assert.equal(stuckWalker.state, 'grid-path', 'a walker stuck on a stale route re-plans onto a live grid path');
assert.equal(stuckWalker.routePath, null, 'stale route path is dropped when stuck');
assert.ok(stuckWalker._gridPath?.some(p => p.row >= 2), 'replanned grid path detours around the blocker');
assert.ok(window.NpcPathfinding.debugSnapshot().stuckReplans >= 1);

// Execute the production path-step and cross-map exit branches, including
// many small movement frames; a successful search alone does not prove arrival.
const stepGridPathSource = gameSource.slice(gameSource.indexOf('          _stepGridPath(target, dt) {'), gameSource.indexOf('          // Station wander —')); // Extracts the real walker method without booting rendering/audio.
const stepGridPath = vm.runInContext('({' + stepGridPathSource + '})._stepGridPath', context); // Shared production stepping method used by the simulated walkers.
const exitBranchSource = gameSource.slice(gameSource.indexOf('            if (targetArea !== this.area) {'), gameSource.indexOf('\n            this._exitSpot = null;', gameSource.indexOf('            if (targetArea !== this.area) {'))); // Production map-transition navigation, before same-area scheduling.
function makeMovingWalker(id, x, z, target) {
  const moving = { // Uses continuous small steps, matching live walker movement.
    area: 'interior', rec: { id }, currentScheduleTarget: target,
    root: { position: { x, z } }, state: 'on-route',
    _stepGridPath: stepGridPath, _tryStartGridPath() { return false; },
    moveToward(tx, tz, dt) {
      const dx = tx - this.root.position.x, dz = tz - this.root.position.z; // Direction to this frame's waypoint.
      const distance = Math.hypot(dx, dz), travel = Math.min(distance, dt * 1.25); // Same speed-limited movement as production.
      if (distance > 0) { this.root.position.x += dx / distance * travel; this.root.position.z += dz / distance * travel; }
      return distance <= travel;
    },
    transferToArea(area) { this.area = area; },
  };
  return window.NpcPathfinding.decorateWalkerCollision(moving);
}
const exitWalker = makeMovingWalker('exit_detour', 1.5, 1.5, { area: 'upstairs', c: 4, r: 4 }); // Final goal is the occupied chair on another map, so planning toward it here would fail.
const exitTick = vm.runInNewContext('(function(dt) {' + exitBranchSource + '})', { // Executes exactly the exit branch run by update().
  root: exitWalker.root, targetArea: 'upstairs', target: exitWalker.currentScheduleTarget,
  findNpcAreaLink: () => ({ exit: { c: 3, r: 1 }, spawn: { c: 0, r: 0 }, toArea: 'upstairs' }),
  npcMovementConfig: deps.npcMovementConfig, canNpcBeeline: window.NpcPathfinding.canNpcBeeline,
  rec: exitWalker.rec, window, currentArea: 'interior', Math,
});
for (let frame = 0; frame < 900 && exitWalker.area === 'interior'; frame++) {
  exitTick.call(exitWalker, 1 / 60);
  if (exitWalker.area === 'interior') assert.ok(window.NpcPathfinding.isNpcPositionWalkable('interior', exitWalker.root.position.x, exitWalker.root.position.z), 'exit detour stays collision-free');
}
assert.equal(exitWalker.area, 'upstairs', 'cross-map NPC follows the detour and reaches the exit instead of pressing into the wall');

const recoveryWalker = makeMovingWalker('path_replacement', 1.7, 1.5, { c: 3, r: 1, routeId: 'test' }); // Starts with a stale path whose next hop crosses the thin wall.
recoveryWalker._gridPath = [{ col: 2, row: 1 }, { col: 3, row: 1 }];
recoveryWalker._gridPathTargetKey = 'test|3,1';
recoveryWalker.state = 'grid-path';
for (let frame = 0; frame < 900 && Math.hypot(recoveryWalker.root.position.x - 3.5, recoveryWalker.root.position.z - 1.5) > 0.01; frame++) recoveryWalker._stepGridPath(recoveryWalker.currentScheduleTarget, 1 / 60);
assert.ok(Math.hypot(recoveryWalker.root.position.x - 3.5, recoveryWalker.root.position.z - 1.5) < 0.01, 'stale path is replaced during stepping and followed all the way to its goal');

const failedRecoveryWalker = makeMovingWalker('failed_replan', 1.7, 1.5, { c: 4, r: 4, routeId: 'unreachable' }); // An occupied destination must fail safely while a path is being stepped.
failedRecoveryWalker._gridPath = [{ col: 2, row: 1 }];
failedRecoveryWalker._gridPathTargetKey = 'unreachable|4,4';
failedRecoveryWalker.state = 'grid-path';
for (let frame = 0; frame < 180 && failedRecoveryWalker.state === 'grid-path'; frame++) failedRecoveryWalker._stepGridPath(failedRecoveryWalker.currentScheduleTarget, 1 / 60);
assert.equal(failedRecoveryWalker.state, 'idle', 'failed replanning during a path step does not dereference a cleared path');

const wanderingRecovery = makeMovingWalker('wander_recovery', 1.7, 1.5, { c: 4, r: 4 }); // The occupied station is deliberately different from the reachable wander goal.
wanderingRecovery.state = 'station-wander';
wanderingRecovery._wanderTarget = { c: 3, r: 1 };
for (let frame = 0; frame < 180 && !wanderingRecovery._wanderGridPath; frame++) wanderingRecovery.moveToward(3.5, 1.5, 1 / 60);
assert.equal(wanderingRecovery.state, 'station-wander', 'blocked wander recovery preserves station wandering');
assert.ok(wanderingRecovery._wanderGridPath?.some(hop => hop.row >= 2), 'wander recovery searches toward its local wander goal instead of the station');

const wanderWalker = {
  area: 'interior',
  rec: { id: 'wander_npc' },
  root: { position: { x: 1.5, z: 1.5 } },
  _wanderTarget: { c: 3, r: 1 },
  _wanderGridPath: null,
  moveToward() { return false; },
  _updateStationWander() { this._wanderGridPath = [{ col: 2, row: 1 }, { col: 3, row: 1 }]; },
};
window._npcWalkers.push(wanderWalker);
wanderWalker._updateStationWander({}, 1 / 60);
assert.ok(wanderWalker._wanderGridPath.some(p => p.row >= 2), 'station wandering replaces a tile-only route with an edge-aware detour before the next movement tick');

// Cutscene move stages navigate by default; explicit collision opt-out survives.
const upgraded = window.NpcPathfinding.upgradeCutscenePayload({ stages: [
  { id: 'a', type: 'move', targetWorld: { c: 2, r: 2 } },
  { id: 'b', type: 'move', collisionAware: false, targetWorld: { c: 3, r: 3 } },
]});
assert.equal(upgraded.stages[0].navigate, true);
assert.equal(upgraded.stages[1].navigate, undefined);
assert.match(gameSource, /async function runCutscenePreview\(payload, runtimeOptions = \{\}\) \{\s*payload = window\.NpcPathfinding\?\.upgradeCutscenePayload\?\.\(payload\)/, 'live cutscenes and Director previews both pass through the navigation upgrade');
assert.equal(Object.getOwnPropertyDescriptor(window, 'AuthoredCutsceneRuntime'), undefined, 'no assignment hooks are installed on window globals');

assert.match(gameSource, /if \(entity\.walker\) window\.NpcPathfinding\?\.decorateWalkerCollision\?\.\(entity\.walker\)/, 'real cutscene NPC walkers must get the collision guard where they are attached');
assert.match(gameSource, /entity\?\.kind === 'npc'[\s\S]*window\.NpcPathfinding\?\.findNpcPath[\s\S]*window\.NpcPathfinding\.findNpcPath/, 'real cutscene NPC movement must use the swept-edge NPC planner instead of only tile-center pathfinding');
assert.match(gameSource, /seatMove[\s\S]*allowOccupiedTarget: seatMove/, 'a cutscene move onto the actor\'s own seat tile must plan with allowOccupiedTarget and the seat-overlap exemption, or the scene stalls at the chair');
assert.match(gameSource, /could not reach[\s\S]*snapping to target so the scene can continue/, 'a blocking cutscene move must have a stall watchdog so a blocked NPC can never freeze the scene');

// Cutscene walkers are decorated directly (see the game.js assertion above).
const cutWalker = {
  area: 'interior',
  rec: { id: 'cutscene_npc' },
  root: { position: { x: 1.5, z: 1.5 } },
  moveToward(tx, tz) { this.root.position.x = tx; this.root.position.z = tz; return true; },
};
(async () => {
  window.NpcPathfinding.decorateWalkerCollision(cutWalker);
  cutWalker.moveToward(3.5, 1.5, 1);
  assert.notEqual(cutWalker.root.position.x, 3.5, 'cutscene walker receives same collision guard');

  vm.runInContext(routeGraphSource, context, { filename: 'npc-route-graph.js' });
  const graph = window.NpcRouteGraph.buildRouteGraph(
    [{ id: 'wall-cross', area: 'interior', nodes: [[1, 1], [3, 1]] }],
    window.NpcPathfinding.isNpcTileWalkable
  );
  assert.equal(graph.nodes.get('interior:1,1').edges.size, 0, 'authored route edge through exact wall is rejected');

  const debug = window.NpcPathfinding.debugSnapshot();
  assert.ok(debug.decoratedWalkers >= 5);
  assert.ok(debug.blockedMoves >= 2);
  assert.ok(debug.pathReplans >= 2);
  console.log('npc collision-aware pathing tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });

// A sleeper may need several hops through its existing multi-tile bed before reaching clear floor.
{
 const bedGrid=Array.from({length:4},(_,r)=>Array.from({length:9},(_,c)=>({type:r===1&&c>=1&&c<=7?0:1}))); // A wall-side bed with its only exit at the foot end.
 const bedWindow={}; // Fresh pathfinding owner keeps this regression independent of the live-walker fixtures above.
 vm.runInNewContext(pathfindingSource,{window:bedWindow,console,Math,Number,Date,Object,Array,Map,Set,WeakMap,WeakSet,Promise});
 bedWindow.NpcPathfinding.init({...deps,npcGridForArea:()=>bedGrid,getGrid:()=>bedGrid,getInteriorGrid:()=>bedGrid,
   furnitureBlocksMovementAt:(area,x,z)=>x>=1&&x<4&&z>=1&&z<2});
 const path=bedWindow.NpcPathfinding.findNpcPath('interior',1.5,1.5,7,1); // Festival, work and other schedule changes all use this same path owner.
 assert(path?.length,'a sleeper can plan from the head of a multi-tile bed through its foot end');
 assert(path.some(p=>p.col===2)&&path.some(p=>p.col===3),'route preserves physical bed-exit steps');
 assert(path.every(p=>p.row===1),'bed escape never enters the wall');
 assert.equal(bedWindow.NpcPathfinding.findNpcPath('interior',7.5,1.5,2,1),null,'an awake NPC cannot use the escape rule to enter another occupied bed');
}

// Authored bedrooms must be escapable through their real floor and furniture layout.
{
 const defsAt=gameSource.indexOf('const DECORATIVE_FURNITURE_DEFS =');
 const defs=vm.runInNewContext(gameSource.slice(defsAt,gameSource.indexOf('\n      };',defsAt)+9)+';DECORATIVE_FURNITURE_DEFS'); // Same dimensions used by runtime placement.
 for(const [name,stationId] of [['map_i_general_store_F2_R1','station_v4n8x'],['map_i_general_store_F2_R2','station_r3p5w'],['map_i_kunjis_potions_F2','station_di22s']]) {
  const map=JSON.parse(fs.readFileSync(path.join(repo,'docs/config/maps',name+'.json'),'utf8'));
  const floor=new Set(map.floor.map(p=>p.join(','))),walls=new Set(map.colliders.map(p=>p.join(','))); // Authored structural cells stay impassable.
  const grid=Array.from({length:map.rows},(_,r)=>Array.from({length:map.cols},(_,c)=>({type:floor.has(c+','+r)&&!walls.has(c+','+r)?0:1})));
  // Mirror game.js: authoring a transition immediately outside the floor
  // keeps that one logical destination traversable without rendering floor.
  const inward={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]};
  for(const exit of map.exits||[])for(const [col,row] of exit.tiles||[]){
   const d=inward[exit.direction];
   if(!d||floor.has(col+','+row)||!floor.has((col+d[0])+','+(row+d[1]))||walls.has(col+','+row))continue;
   if(grid[row]?.[col])grid[row][col].type=0;
  }
  const owner={};
  const env={window:owner,console,Math,Number,Date,Object,Array,Map,Set,WeakMap,WeakSet,Promise};
  vm.runInNewContext(fs.readFileSync(path.join(repo,'docs/js/furniture-table-system.js'),'utf8'),env);
  for(const record of map.furniture) {
   const pair=Object.entries(defs).find(([,def])=>def.itemKey===record.itemKey);if(!pair)continue;
   const [key,def]=pair;
   owner.FurnitureTableSystem.registerPlacement(name,{...record,key,rotY:record.gridRot??record.rotY},{parent:{},position:{x:record.col+(record.gridW||def.fw)/2+(record.postX||0),y:0,z:record.row+(record.gridD||def.fd)/2+(record.postZ||0)},scale:{x:record.postSX||1,y:1,z:record.postSZ||1}},def);
  }
  vm.runInNewContext(pathfindingSource,env);
  owner.NpcPathfinding.init({...deps,isBuildingArea:()=>true,npcGridForArea:()=>grid,getGrid:()=>grid,getInteriorGrid:()=>grid,furnitureBlocksMovementAt:(area,x,z)=>owner.FurnitureTableSystem.blocksBox(area,x,z)});
  const station=map.npcStations.find(s=>s.id===stationId),[c,r]=map.exits[0].tiles[0];
  const target={c,r},walker={area:name,rec:{id:name},currentScheduleTarget:target,root:{position:{x:station.col+.5,z:station.row+.5}},state:'idle',_tryStartGridPath(){return false;},_stepGridPath:vm.runInNewContext('({'+stepGridPathSource+'})._stepGridPath',env),moveToward(tx,tz,dt){const p=this.root.position,dx=tx-p.x,dz=tz-p.z,d=Math.hypot(dx,dz),travel=Math.min(d,dt*1.25);if(d){p.x+=dx/d*travel;p.z+=dz/d*travel;}return d<=travel;}}; // Exercise production waypoint stepping, not just search success.
  owner.NpcPathfinding.decorateWalkerCollision(walker);
  assert(owner.NpcPathfinding.findNpcPath(name,walker.root.position.x,walker.root.position.z,c,r)?.length,name+' can plan from its bed to its stairs');
  assert(walker._tryStartGridPath(target));
  for(let frame=0;frame<2400&&Math.hypot(walker.root.position.x-c-.5,walker.root.position.z-r-.5)>.01;frame++)walker._stepGridPath(target,1/60);
  assert(Math.hypot(walker.root.position.x-c-.5,walker.root.position.z-r-.5)<.01,name+' walks out of bed and reaches its stairs');
 }
}

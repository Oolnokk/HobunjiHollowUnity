const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

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

// Existing live-walker seam is patched when game.js assigns/pushes walkers.
window._npcWalkers = [];
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
let received = null;
window.AuthoredCutsceneRuntime = Object.freeze({
  run(payload) { received = payload; return Promise.resolve(payload); },
  debugSnapshot() { return {}; },
});
window.AuthoredCutsceneRuntime.run({ stages: [
  { id: 'a', type: 'move', targetWorld: { c: 2, r: 2 } },
  { id: 'b', type: 'move', collisionAware: false, targetWorld: { c: 3, r: 3 } },
]});
assert.equal(received.stages[0].navigate, true);
assert.equal(received.stages[1].navigate, undefined);

window.__hobunjiCutscenePreview = { stages: [{ id: 'preview', type: 'move', targetWorld: { c: 2, r: 2 } }] };
assert.equal(window.__hobunjiCutscenePreview.stages[0].navigate, true, 'Director preview receives same navigation default');

assert.match(gameSource, /if \(entity\.walker\) await window\.NpcHeldEquipment\?\.attachCutsceneWalker\?\.\(entity\.walker\)/, 'real cutscene NPC walkers must pass through the decorated attachment seam');
assert.match(gameSource, /entity\?\.kind === 'npc'[\s\S]*window\.NpcPathfinding\?\.findNpcPath[\s\S]*window\.NpcPathfinding\.findNpcPath/, 'real cutscene NPC movement must use the swept-edge NPC planner instead of only tile-center pathfinding');

// NpcHeldEquipment is the existing cutscene-walker attachment seam.
let attached = false;
window.NpcHeldEquipment = {
  async attachCutsceneWalker(w) { attached = w === cutWalker; },
};
const cutWalker = {
  area: 'interior',
  rec: { id: 'cutscene_npc' },
  root: { position: { x: 1.5, z: 1.5 } },
  moveToward(tx, tz) { this.root.position.x = tx; this.root.position.z = tz; return true; },
};
(async () => {
  await window.NpcHeldEquipment.attachCutsceneWalker(cutWalker);
  assert.equal(attached, true);
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

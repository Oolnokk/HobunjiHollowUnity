const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const pathfindingSource = fs.readFileSync(path.join(repo, 'docs/js/npc-pathfinding.js'), 'utf8');
const routeGraphSource = fs.readFileSync(path.join(repo, 'docs/js/npc-route-graph.js'), 'utf8');
const openGrid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ type: 0, crop: false })));
const logs = [];
const window = {
  __farmLog: message => logs.push(message),
  AreaFootprintBlockers: {
    blocksBox(area, x, z, half = 0) {
      if (area !== 'interior') return false;
      // Thin wall between tile centers x=1.5 and x=2.5, ending before row 2 center.
      return x + half > 2.0 && x - half < 2.12 && z + half > 0 && z - half < 2.2;
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
  furnitureBlocksMovementAt: () => false,
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
assert.ok(detour.some(point => point.row >= 2), 'detour should leave blocked direct row');
for (let i = 0; i < detour.length; i++) {
  const from = i ? detour[i - 1] : { col: 1, row: 1 };
  const to = detour[i];
  assert.equal(window.NpcPathfinding.canNpcTraverse('interior', from.col + 0.5, from.row + 0.5, to.col + 0.5, to.row + 0.5), true);
}

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

walker.root.position.x = 1.5;
walker.root.position.z = 1.5;
assert.equal(walker._tryStartGridPath({ c: 3, r: 1, routeId: 'test' }), true);
assert.ok(walker._gridPath.some(point => point.row >= 2), 'gameplay fallback path uses edge-aware detour');

// Cutscene move stages navigate by default; explicit collision opt-out survives.
let received = null;
window.AuthoredCutsceneRuntime = Object.freeze({
  run(payload) { received = payload; return Promise.resolve(payload); },
  debugSnapshot() { return {}; },
});
window.AuthoredCutsceneRuntime.run({ stages: [
  { id: 'a', type: 'move', targetWorld: { c: 2, r: 2 } },
  { id: 'b', type: 'move', collisionAware: false, targetWorld: { c: 3, r: 3 } },
] });
assert.equal(received.stages[0].navigate, true);
assert.equal(received.stages[1].navigate, undefined);

window.__hobunjiCutscenePreview = { stages: [{ id: 'preview', type: 'move', targetWorld: { c: 2, r: 2 } }] };
assert.equal(window.__hobunjiCutscenePreview.stages[0].navigate, true, 'Director preview receives same navigation default');

// NpcHeldEquipment is the existing cutscene-walker attachment seam.
let attached = false;
let cutWalker = null;
window.NpcHeldEquipment = {
  async attachCutsceneWalker(walkerToAttach) { attached = walkerToAttach === cutWalker; },
};
cutWalker = {
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
    window.NpcPathfinding.isNpcTileWalkable,
  );
  assert.equal(graph.nodes.get('interior:1,1').edges.size, 0, 'authored route edge through exact wall is rejected');

  const debug = window.NpcPathfinding.debugSnapshot();
  assert.ok(debug.decoratedWalkers >= 2);
  assert.ok(debug.blockedMoves >= 2);
  assert.ok(debug.pathReplans >= 1);
  console.log('npc collision-aware pathing tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

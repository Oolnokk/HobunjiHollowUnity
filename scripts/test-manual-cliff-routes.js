#!/usr/bin/env node
'use strict';

// npm-free deterministic regression tests for shared cliff route planning.
// Run: node scripts/test-manual-cliff-routes.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../docs/js/cliff-route-network.js');

const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const cliffClimb = fs.readFileSync(path.join(__dirname, '../docs/js/climb-system.js'), 'utf8');
const wildlife = fs.readFileSync(path.join(__dirname, '../docs/js/creature-cliff-climb.js'), 'utf8');
const npcPath = fs.readFileSync(path.join(__dirname, '../docs/js/npc-pathfinding.js'), 'utf8');
const wildlifeThreat = fs.readFileSync(path.join(__dirname, '../docs/js/wildlife-threat-response.js'), 'utf8'); // Panic AI must reach the cliff planner despite its preliminary ground clearance check.

function gridWithCliffs(rows = 28, thirdTier = false) {
  return Array.from({ length: rows }, () => Array.from({ length: thirdTier ? 19 : 14 }, (_, col) => ({
    type: col === 6 || (thirdTier && col === 12) ? 'rock' : 'grass',
    incline: col === 6 || (thirdTier && col === 12),
    elevTier: col < 6 ? 0 : col < 12 ? 1 : 2,
  })));
}
function build(g) {
  return routes.build(g, {
    area: 'western-slope',
    tileY: tile => (tile.elevTier || 0) * 9, // Taller test tiers accommodate doubled mini-cliff undersides.
    blocked: tile => !tile || tile.incline || tile.type === 'rock',
  });
}

const baseGrid = gridWithCliffs();
const network = build(baseGrid);
assert.equal(network.components.length, 3, 'an unpainted extra tier still becomes a separate reachable plateau');
assert(network.routes.length > 0, 'some cliff faces receive carved climbing routes');
assert(network.routes.length < network.candidateCount, 'not every cliff candidate is climbable');
assert.equal(network.unconnectedComponents, 0, 'plateau has at least one actual climbing route');
assert(network.verification.ok, 'every reachable plateau and balcony must pass shaft-style path validation');
assert.equal(network.verification.invalidHops.length, 0, 'no overlong or unreciprocated handhold links');
assert(routes.toward(network, 2, 10, 8, 10), 'wildlife can navigate toward the route');
assert(routes.toward(network, 8, 10, 2, 10), 'wildlife can traverse down by the same route');

const route = network.routes[0];
assert.equal(routes.crossing(network, route.a.c, route.a.r, route.b.c, route.b.r)?.entry, 0, 'chosen lower face is climbable');
assert.equal(routes.crossing(network, route.b.c, route.b.r, route.a.c, route.a.r)?.entry, route.upperNode, 'chosen upper face is climbable');
assert.equal(routes.nextHop(route, 0, { x: 0, z: 0 }), null, 'releasing input pauses climb');
assert.equal(routes.nextHop(route, 0, { x: route.dir.x, z: route.dir.z })?.id, 1, 'uphill input makes exactly one upward hop');
assert.equal(routes.nextHop(route, route.upperNode, { x: -route.dir.x, z: -route.dir.z })?.id, route.upperNode - 1, 'downhill input can hop back to ground');
const branch = route.nodes.find(n => n.id > route.upperNode && !n.balconyId);
assert(branch, 'route has a true sideways / diagonal branch');
const at = route.nodes[branch.links[0]];
const sideways = { x: Math.sign((branch.x - at.x) * route.tangent.x + (branch.z - at.z) * route.tangent.z) * route.tangent.x,
  z: Math.sign((branch.x - at.x) * route.tangent.x + (branch.z - at.z) * route.tangent.z) * route.tangent.z };
assert.equal(routes.nextHop(route, at.id, sideways)?.id, branch.id, 'sideways input selects branch, not automatic vertical motion');

// Normal routing may take a nearby safe downhill shortcut; climbs and hazard crossings may not.
const dropOptions = { isSolid: type => type === 'rock', isBoundary: tile => !!tile.mapBoundary };
const findDrop = (x, z, gx, gz, options = {}) =>
  routes.findIntentionalDrop(network, baseGrid, x, z, gx, gz, { ...dropOptions, ...options });
assert.equal(findDrop(7.5, 10.5, 2.5, 10.5)?.landCol, 5, 'a lower connected shelf is a valid intentional landing');
assert.equal(findDrop(2.5, 10.5, 8.5, 10.5), null, 'drop shortcuts cannot climb uphill');
assert.equal(findDrop(7.5, 10.5, 9.5, 10.5), null, 'normal same-tier movement does not step off a cliff');
assert.equal(findDrop(9.5, 10.5, 2.5, 10.5), null, 'a jump cannot launch across several intact upper tiles');
assert.equal(findDrop(7.5, 10.5, 6.5, 10.5), null, 'ordinary movement toward the cliff face is not enough to jump');
assert(findDrop(7.5, 10.5, 6.5, 10.5, { escape: true }), 'fleeing may jump in its escape direction without a lower target');
assert.equal(findDrop(7.5, 10.5, 9.5, 10.5, { escape: true }), null, 'escape cannot jump in the opposite direction');
assert.equal(findDrop(7.5, 10.5, 2.5, 10.5, { canLand: () => false }), null, 'a blocked actor-sized landing is rejected');
baseGrid[10][5].type = 'river';
assert.equal(findDrop(7.5, 10.5, 2.5, 10.5), null, 'a flooded landing is unsafe');
baseGrid[10][5].type = 'grass';
baseGrid[10][5].mapBoundary = true;
assert.equal(findDrop(7.5, 10.5, 2.5, 10.5), null, 'map-boundary escarpments cannot be used as shortcuts');
delete baseGrid[10][5].mapBoundary;

const balconies = network.balconies;
assert(balconies.length, 'intermediate miniature cliffs generate on tall walls');
const shelf = balconies[0];
assert(shelf.footprint.length >= 2, 'balcony owns a multi-tile footprint');
assert(shelf.footprint.every(t => t.elevation === shelf.y), 'every balcony tile carries its own world elevation');
const shelfRoute = network.routes[shelf.routeId];
assert(shelf.id.includes([shelfRoute.a.c, shelfRoute.a.r, shelfRoute.b.c, shelfRoute.b.r].join('-')),
  'shelf save identity comes from stable map coordinates, not an incidental route-list index');
assert.equal(routes.highestBelow(network, shelf.x, shelf.z, shelf.y + 2, shelf.y - 3)?.id, shelf.id, 'fall lands on intermediate balcony before ground');
const stacked = {
  balconies: [
    { x: 4.5, z: 4.5, y: 3, width: 2, depth: 1, tangent: { x: 1, z: 0 }, normal: { x: 0, z: 1 }, id: 'lower' },
    { x: 4.5, z: 4.5, y: 7, width: 2, depth: 1, tangent: { x: 1, z: 0 }, normal: { x: 0, z: 1 }, id: 'upper' },
  ],
};
assert.equal(routes.highestBelow(stacked, 4.5, 4.5, 10, 0)?.id, 'upper', 'upper overlapping balcony catches falling character first');
assert.equal(routes.highestBelow(stacked, 4.5, 4.5, 6, 0)?.id, 'lower', 'lower overlapping balcony catches shorter falls');

routes.setRewardStage(network.area, shelf.id, 'revealed');
assert(routes.getRewardState(network.area, shelf.id).revealed, 'digging reveals a chest independently of terrain');
routes.setRewardStage(network.area, shelf.id, 'claimed');
const saved = routes.serializeRewards();
routes.restoreRewards(saved);
assert(routes.getRewardState(network.area, shelf.id).claimed, 'mined/looted balcony state persists after save reload');

const third = build(gridWithCliffs(28, true));
assert.equal(third.components.length, 3, 'nested plateaus are distinct graph components');
assert.equal(third.unconnectedComponents, 0, 'both plateau levels have generated connecting paths');
assert(third.verification.ok, 'independent multi-height plateau routes pass traversal proof');
assert(routes.toward(third, 2, 10, 16, 10), 'NPCs can path through two sequential cliff crossings');
assert(!routes.toward(build(Array.from({ length: 4 }, () => [
  { type: 'grass' }, { type: 'wall' }, { type: 'grass', elevTier: 1 },
])), 0, 0, 2, 0), 'walls without any cliff route do not permit teleporting up');

const cached = routes.forGrid(baseGrid, { area: 'western-slope' });
assert.equal(routes.forGrid(baseGrid), cached, 'unchanged grid reuses topology');
assert.notEqual(routes.forGrid(baseGrid, { area: 'western-slope', rebuild: true }), cached, 'terrain rebuild invalidates old topology');

// Run the live mesa builder, including its displaced stone triangles,
// cave exclusions and actual decal geometry, without a WebGL dependency.
const vm = require('node:vm');

{
  const actorWin = { CliffRouteNetwork: routes, MapBoundaryGuard: { isBoundaryTile: tile => !!tile.mapBoundary } };
  let landings = 0; // The creature descent calls the same fall policy used by player ledge jumps.
  actorWin.FallSystem = { land(_actor, landing) { landings++; assert(landing.deliberate); assert(landing.dropWorld > 0); } };
  const fixture = {
    TILE: 55, getActiveGrid: () => baseGrid, getActiveCols: () => 14, getActiveRows: () => 28,
    getCurrentArea: () => 'slope', isZoneArea: area => area === 'slope',
    isSolid: type => type === 'rock', tileSurfaceYInArea: tile => (tile.elevTier || 0) * 9,
    creatureCanEnterTile: () => true, npcGridForArea: () => baseGrid,
    isBuildingArea: () => false, isTownBuildingCollisionTile: () => false,
    TileType: { RIVER: 'river', STREAM: 'stream', TRENCH: 'trench', RAMP: 'ramp' },
    npcMovementConfig: () => ({}), furnitureOnlyBlocksMovementAt: () => false,
  }; // Minimal adapters to exercise actual production wrappers without game.js/WebGL.
  vm.runInNewContext(wildlife, { window: actorWin, performance: { now: () => 1000 } });
  actorWin.CreatureCliffClimb.init(fixture);
  const fleeing = { x: 7.5 * 55, y: 10.5 * 55, areaId: 'slope', health: 10,
    def: { moveSpeed: 110 }, state: 'fleeing-low-health' }; // Reuses the established retreat state.
  assert(actorWin.CreatureCliffClimb.navigate(fleeing, 2.5 * 55, 10.5 * 55, 110, .03));
  assert(fleeing._cliffClimb, 'fleeing wildlife begins an airborne descent');
  assert.equal(fleeing.state, 'fleeing-low-health', 'jumping does not turn a fleeing animal hostile');
  for (let i = 0; i < 30; i++) if (fleeing._cliffClimb) actorWin.CreatureCliffClimb.update(fleeing, .03, null);
  assert.equal(fleeing._cliffClimb, null, 'the jump lands without leaving movement ownership behind');
  assert(Math.abs(fleeing.x / 55 - 5.5) < 0.01, 'the creature lands on the lower real tile');
  assert.equal(landings, 1, 'the deliberate fall costs Footing exactly once');
  assert.equal(actorWin.CreatureCliffClimb.debug.intentionalDrops, 1);

  vm.runInNewContext(wildlifeThreat, { window: actorWin, Date, performance: { now: () => 1000 } });
  const panic = { x: 7.5 * 55, y: 10.5 * 55, areaId: 'slope', health: 10,
    def: { moveSpeed: 110 }, creatureKey: 'moot', state: 'herd-panic',
    _herdThreat: { predatorX: 10.5 * 55, predatorY: 10.5 * 55 },
  }; // Predator east of the upper ledge: flee west over the cliff.
  let blockedPanicMoves = 0; // A blocked ground probe must not start ordinary walking through the wall.
  const panicResult = actorWin.WildlifeThreatResponse.tickPanic(panic, .03, {
    tile: 55, canOccupyAt: () => false,
    moveCreatureToward: () => { blockedPanicMoves++; return false; },
  });
  assert(panicResult.handled && panicResult.moving, 'panic AI deliberately chooses a downhill escape over an impassable cliff face');
  assert(panic._cliffClimb?.intentionalDrop, 'panic jump uses existing creature animation');
  assert.equal(blockedPanicMoves, 0, 'blocked ground walking is not attempted through the cliff');
  assert.equal(actorWin.CreatureCliffClimb.tryIntentionalLedgeDrop(panic, 4.5 * 55, 10.5 * 55), false,
    'a second panic tick cannot restart the existing airborne jump');
  for (let i = 0; i < 30; i++) if (panic._cliffClimb) actorWin.CreatureCliffClimb.update(panic, .03, null);
  assert.equal(panic.state, 'herd-panic', 'landing preserves the herd escape rather than starting an attack');
  assert.equal(panic._cliffClimb, null, 'panic cliff jump completes on the lower shelf');
  assert.equal(landings, 2, 'both deliberate creature falls invoke the common landing policy once each');

  let proneImpacts = 0; // Verifies main's newer midair-prone fall owner wins over deliberate-landing Footing.
  actorWin.HobunjiCliffFallImpact = { resolve(_actor, fall) {
    proneImpacts++;
    assert(fall.dropWorld > 0, 'knockdown impact uses the real remaining fall height');
    assert.equal(fall.popupCredit,true,'prone cliff landing preserves initiating hit credit');
    return { lethal: false };
  } };
  const interrupted = { ...fleeing, x: 7.5 * 55, y: 10.5 * 55, prone: false,
    _cliffClimb: null, _cliffClimbCooldownT: 0 }; // Second deliberate jumper, knocked prone before reaching the landing.
  assert(actorWin.CreatureCliffClimb.navigate(interrupted, 2.5 * 55, 10.5 * 55, 110, .03));
  actorWin.CreatureCliffClimb.update(interrupted, .12, null);
  interrupted.prone = true;
  assert(actorWin.CreatureCliffClimb.knockOff(interrupted, 'knocked prone while descending', true),
    'a midair knockdown interrupts the voluntary downhill hop');
  for (let i = 0; i < 30; i++) if (interrupted._cliffClimb) actorWin.CreatureCliffClimb.update(interrupted, .03, null);
  assert.equal(interrupted._cliffClimb, null, 'the interrupted descent lands and clears movement ownership');
  assert.equal(proneImpacts, 1, 'only one height-scaled cliff impact is applied');
  assert.equal(landings, 2, 'the prone impact does not also charge a deliberate landing');

  vm.runInNewContext(npcPath, { window: actorWin, Date });
  actorWin.NpcPathfinding.init(fixture);
  const walker = { area: 'slope', state: 'moving',
    root: { position: { x: 7.5, z: 10.5, y: 9, set(x,y,z) { this.x=x; this.y=y; this.z=z; } } },
    moveToward(x,z) { this.root.position.x=x; this.root.position.z=z; return true; },
    _tryStartGridPath() { return false; }, // Scheduler path requests must not interrupt committed airborne motion.
  }; // Actual collision decorator keeps a committed jump separate from ordinary path movement.
  actorWin.NpcPathfinding.decorateWalkerCollision(walker);
  walker.moveToward(2.5, 10.5, .03);
  assert(walker._npcCliffClimb?.drop, 'NPC chooses the same safe descent rather than walking into the wall');
  const inFlight = walker._npcCliffClimb; // Scheduler cannot discard or restart this active jump.
  assert.equal(walker._tryStartGridPath({ c: 2, r: 10 }), false, 'schedule replans pause until landing');
  assert.equal(walker._npcCliffClimb, inFlight, 'a replan preserves the current jump ownership');
  for (let i = 0; i < 30; i++) if (walker._npcCliffClimb) actorWin.NpcPathfinding.updateCliffClimb(walker, .03);
  assert.equal(walker._npcCliffClimb, null, 'NPC jump has released path ownership on landing');
  assert(Math.abs(walker.root.position.x - 5.5) < 0.01, 'NPC lands on a real lower-shelf tile');
  assert.equal(actorWin.NpcPathfinding.debugSnapshot().cliffRoutes.intentionalDrops, 1);
  assert(actorWin.NpcPathfinding.canNpcReachByDrop('slope', 7.5, 10.5, 4, 10),
    'retreat selectors can prove a landing and a footpath to lower-shelf cover');
}


// Drive both production movement entry points with a deterministic clock and
// a goal tile that becomes walkable after the first failed approach.
for (const kind of ['creature', 'npc']) {
  let now = 0; // Wall clock for the retry deadline.
  let blocked = true; // Simulates a temporary obstacle at the entry.
  let searches = 0; // Records each actual approach search.
  let edge = { route: { id: 0, nodes: [{ x: 4.5, z: 1.5 }] }, entry: 0 }; // Replaceable topology with stable numeric route IDs.
  const g = Array.from({ length: 5 }, () => Array.from({ length: 9 }, () => ({ type: 'grass' }))); // Approach from tile 1,1.
  const deps = {
    TILE: 1, TileType: {}, getActiveGrid: () => g, npcGridForArea: () => g,
    getCurrentArea: () => 'slope', isZoneArea: () => true, isBuildingArea: () => false,
    tileSurfaceYInArea: () => 0, isTownBuildingCollisionTile: () => false,
    isSolid(tileType) { if (tileType === 'entry') searches++; return tileType === 'entry' && blocked; },
    creatureCanEnterTile: () => true, furnitureOnlyBlocksMovementAt: () => false, npcMovementConfig: () => ({}),
  }; // Shared terrain fixture with no other structural or dynamic blockers.
  const win = {
    CliffRouteNetwork: { forGrid: () => ({}), toward: () => edge, componentAt: () => 0 },
    TilePathfinding: {
      boxAround() {},
      findPath() { searches++; return blocked ? null : [{ col: 3, row: 1 }]; },
    },
  }; // The NPC case uses its real swept A* with a mutable tile.
  g[1][4].type = 'entry';
  vm.runInNewContext(kind === 'creature' ? wildlife : npcPath, {
    window: win, performance: { now: () => now }, Date: { now: () => now },
  });
  const creature = { x: 1.5, y: 1.5, areaId: 'slope', health: 10 }; // Wildlife movement state.
  const walker = { area: 'slope', root: { position: { x: 1.5, z: 1.5 } }, moveToward(x, z) { this.root.position.x = x; this.root.position.z = z; return true; } }; // Scheduled walker movement state.
  const runtime = kind === 'creature' ? win.CreatureCliffClimb : win.NpcPathfinding; // Runtime being exercised.
  runtime.init(deps);
  if (kind === 'npc') runtime.decorateWalkerCollision(walker);
  const attempt = kind === 'creature'
    ? () => runtime.navigate(creature, 7.5, 1.5, 1, 0.1)
    : () => walker.moveToward(7.5, 1.5, 0.1); // Normal gameplay entry points.
  const retryMs = kind === 'creature' ? 1200 : 750; // Each actor type keeps its own delay.

  assert.equal(attempt(), false, kind + ' waits when the first search fails');
  now = 100;
  assert.equal(attempt(), false, kind + ' skips an identical retry');
  assert.equal(searches, 1);
  if (kind === 'creature') creature.x = 2.5;
  else walker.root.position.x = 2.5;
  assert.equal(attempt(), false, kind + ' searches immediately from a different tile');
  assert.equal(searches, 2);
  edge = { ...edge, route: { ...edge.route } };
  assert.equal(attempt(), false, kind + ' searches immediately after a topology rebuild');
  assert.equal(searches, 3);
  blocked = false;
  now += retryMs - 1;
  assert.equal(attempt(), false, kind + ' can briefly wait after the obstacle clears');
  assert.equal(searches, 3);
  now++;
  assert.equal(attempt(), true, kind + ' resumes as soon as its retry becomes due');
  const debug = kind === 'creature' ? runtime.debug : runtime.debugSnapshot().cliffRoutes; // Exposed in navigation diagnostics.
  assert.equal(debug.retriesSkipped, 2);
}

class Attribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}
class Geometry {
  constructor() { this.attributes = {}; this.groups = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(index) { this.index = index; }
  addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }); }
  computeVertexNormals() {}
  computeBoundingSphere() {}
}
class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; }
}
class InstancedMesh extends Mesh {
  constructor(...args) { super(...args); this.instanceMatrix = { setUsage() {} }; }
  setMatrixAt() {}
}
const THREE = {
  BufferGeometry: Geometry, BufferAttribute: Attribute, Float32BufferAttribute: Attribute, Mesh, InstancedMesh,
  TextureLoader: class { load() { return {}; } }, MeshBasicMaterial: class {}, MeshStandardMaterial: class {},
  Matrix4: class { makeScale() { return this; } clone() { return this; } },
  Object3D: class {
    position = { set() {} }; scale = { set() {} }; rotation = {}; matrix = new THREE.Matrix4();
    updateMatrix() {}
  },
  DodecahedronGeometry: Geometry, BoxGeometry: Geometry,
};
const runtimeGrid = Array.from({ length: 28 }, (_, r) => Array.from({ length: 14 }, (_, c) => ({
  type: 'grass', incline: c === 6, elevTier: c >= 7 && r > 3 && r < 24 && c < 13 ? 1 : 0,
})));
const den = { x: 5, y: 10, w: 3, h: 4, mouthAnchor: { x: 5, y: 14 } };
const windowShim = { CliffRouteNetwork: routes };
const material = { kind: 'cliff rock' };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/js/zone-plateau-mesa.js'), 'utf8'), {
  window: windowShim, THREE, console: { log() {} },
});
windowShim.ZonePlateauMesa.init({
  NORMAL_TOP: 0, PLATEAU_UNIT: 3, TileType: { GRASS: 'grass', ROCK: 'rock' },
  CARVED_TILE_TYPES: new Set(), isSolid: () => false, tileSurfaceYInArea: tile => tile.elevTier * 3,
  resolveTileMat: () => material, _zoneLayouts: new Map([['mesh-test', { dens: [den] }]]),
  displaceZoneGeometry(geometry) {
    const vertices = geometry.getAttribute('position').array;
    for (let i = 0; i < vertices.length; i += 3) vertices[i] += 0.025 * Math.sin(vertices[i + 2]);
  },
});
const meshScene = { add() {} };
const rendered = windowShim.ZonePlateauMesa.buildZoneMesaMeshes(meshScene, 'mesh-test', [
  { minC: 6, maxC: 13, minR: 3, maxR: 24, fromTier: 0, toTier: 1,
    maskWorldKeys: new Set(Array.from({ length: 22 * 8 }, (_, i) => `${6 + i % 8},${3 + Math.floor(i / 8)}`)) },
], runtimeGrid);
const actual = routes.forArea('mesh-test');
assert(actual.routes.length && actual.verification.ok, 'meshed terrain still has a reachable plateau around its den');
assert(!routes.overlapsClimb(actual, den), 'the selected route network clears the den footprint');
const crossingHold = actual.routes[0].nodes[1]; // A den proposed at a live hold must be refused on relocation.
assert(routes.overlapsClimb(actual, { x: crossingHold.x - 0.5, y: crossingHold.z - 0.5, w: 1, h: 1 }));
const decals = rendered.find(mesh => mesh.userData.cliffRoutes)?.geometry.attributes.position.array;
assert(decals?.length, 'the live scene builder emits nine-slice cliff decals');
const sideRoute = actual.routes.find(route => route.dir.x === 1);
assert(sideRoute, 'the western cliff face remains climbable outside the den footprint');
const lip = sideRoute.nodes[sideRoute.upperNode - 1], topNode = sideRoute.nodes[sideRoute.upperNode];
assert(lip.transfer && lip.y > topNode.y && lip.x < topNode.x, 'climb reaches the outside of the lip before the top step');
assert.equal(routes.nextHop(sideRoute, lip.id, sideRoute.dir), topNode, 'inward input steps onto the plateau from the lip');
const sideDecalCount = Array.from({ length: decals.length / 3 }, (_, i) => i * 3)
  .filter(i => decals[i + 2] > 4.5 && decals[i + 2] < 22.5 && decals[i] > 5.8 && decals[i] < 7.1)
  .filter(i => Math.abs(decals[i] - (6 + decals[i + 1] / 3 + 0.025 * Math.sin(decals[i + 2]) - 0.012)) < 0.02).length;
assert(sideDecalCount > 30, 'decal vertices follow the displaced stone slope');

assert(/cliff-route-network\.js\?v=/.test(html), 'runtime loads shared cliff graph');
assert(html.includes('cliff-elevated-surfaces.js'), 'game loads the shared dungeon support adapter');
assert(cliffClimb.includes('_cliffRouteSession') && cliffClimb.includes('jumpFromBalcony'), 'player controlled hops and balcony descents are wired');
assert(wildlife.includes('function navigate(') && game.includes('CreatureCliffClimb?.navigate?.('), 'creature travel uses the route planner');
assert(npcPath.includes('updateCliffClimb') && game.includes('NpcPathfinding?.updateCliffClimb?.('), 'scheduled NPCs use elevation-aware paths');
assert(game.includes('cliffBalconyRewards') && game.includes('getCliffBalconyResourceAt'), 'balcony resources have dedicated saved interaction state');
assert(cliffClimb.includes('getBranchClimbTarget') && html.includes('climb-surfaces.js'), 'ruin-wall and tree climbing are preserved');
console.log('PASS controlled cliff routes, stacked balconies, NPC/wildlife wiring, and rewards');

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

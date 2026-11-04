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
    tileY: tile => (tile.elevTier || 0) * 3,
    blocked: tile => !tile || tile.incline || tile.type === 'rock',
  });
}

const baseGrid = gridWithCliffs();
const network = build(baseGrid);
assert.equal(network.components.length, 2, 'ground and upper plateau are separate walkable components');
assert(network.routes.length > 0, 'some cliff faces receive carved climbing routes');
assert(network.routes.length < network.candidateCount, 'not every cliff candidate is climbable');
assert.equal(network.unconnectedComponents, 0, 'plateau has at least one actual climbing route');
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
assert(routes.toward(third, 2, 10, 16, 10), 'NPCs can path through two sequential cliff crossings');
assert(!routes.toward(build(Array.from({ length: 4 }, () => [
  { type: 'grass' }, { type: 'wall' }, { type: 'grass', elevTier: 1 },
])), 0, 0, 2, 0), 'walls without any cliff route do not permit teleporting up');

const cached = routes.forGrid(baseGrid, { area: 'western-slope' });
assert.equal(routes.forGrid(baseGrid), cached, 'unchanged grid reuses topology');
assert.notEqual(routes.forGrid(baseGrid, { area: 'western-slope', rebuild: true }), cached, 'terrain rebuild invalidates old topology');

assert(/cliff-route-network\.js\?v=/.test(html), 'runtime loads shared cliff graph');
assert(cliffClimb.includes('_cliffRouteSession') && cliffClimb.includes('jumpFromBalcony'), 'player controlled hops and balcony descents are wired');
assert(wildlife.includes('function navigate(') && game.includes('CreatureCliffClimb?.navigate?.('), 'creature travel uses the route planner');
assert(npcPath.includes('updateCliffClimb') && game.includes('NpcPathfinding?.updateCliffClimb?.('), 'scheduled NPCs use elevation-aware paths');
assert(game.includes('cliffBalconyRewards') && game.includes('getCliffBalconyResourceAt'), 'balcony resources have dedicated saved interaction state');
assert(cliffClimb.includes('getBranchClimbTarget') && html.includes('climb-surfaces.js'), 'ruin-wall and tree climbing are preserved');
console.log('PASS controlled cliff routes, stacked balconies, NPC/wildlife wiring, and rewards');

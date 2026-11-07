#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Production follower movement and climb integration.
const responseSource = fs.readFileSync('docs/js/companion-combat-response.js', 'utf8'); // Existing mobile diagnostics surface.
const helperStart = source.indexOf('function companionFollowGoal(c, master) {'); // Extracts the production helper without running the full browser game.
const helperEnd = source.indexOf('\n\n      // Shared ground truth', helperStart); // The following comment delimits this helper in game.js.
assert(helperStart >= 0 && helperEnd > helperStart, 'ground-follow helper is present');
const helperSource = source.slice(helperStart, helperEnd); // Executes the actual implementation, not a copied test approximation.
const TILE = 64; // Pixel-space tile size used by the companion's movement.
const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ elevTier: 0, incline: false }))); // Tiered wilderness fixture.
grid[1][4].elevTier = 2;
const context = { TILE, currentArea: 'wilderness', _isZoneArea: area => area === 'wilderness',
  window: { GridTileAccessors: { getActiveGrid: () => grid } }, Number, Math }; // Game dependencies needed by the pure helper.
const followGoal = vm.runInNewContext('(' + helperSource + ')', context, { filename: 'game-companion-follow-helper.js' });

const companion = { x: 1.5 * TILE, y: 1.5 * TILE, areaGrid: grid }; // Ground companion waiting below the climb.
const climbingMaster = { x: 2.5 * TILE, y: 1.5 * TILE, climbing: true,
  climbEndX: 4.5 * TILE, climbEndY: 1.5 * TILE }; // Owner's midair location differs from their upper landing.
const climbingGoal = followGoal(companion, climbingMaster);
assert.equal(climbingGoal.x, climbingMaster.climbEndX, 'companion heads to the real landing, not the moving master position');
assert.equal(climbingGoal.y, climbingMaster.climbEndY);
assert.equal(climbingGoal.routeRequired, true, 'different elevations select the shared creature cliff route');
const nearbyLower = { ...companion, x: 3.6 * TILE }; // Within ordinary follow radius, but still below the upper platform.
assert.equal(followGoal(nearbyLower, climbingMaster).routeRequired, true,
  'being physically near the owner cannot suppress needed vertical navigation');

const routeNetwork = { cols: 6, rows: 6, component: Array(36).fill(0) }; // Cached exterior navigation graph distinguishes isolated walkable regions.
routeNetwork.component[2 * 6 + 4] = 2; // Same-height upper shelf is disconnected despite identical elevTier values.
context.window.CliffRouteNetwork = {
  forArea: area => area === 'wilderness' ? routeNetwork : null,
  componentAt: (network, col, row) => network.component[row * network.cols + col] ?? -1,
}; // The production graph's read-only component query, not a second pathfinder.
const nearbySameHeight = { ...companion, x: 3.5 * TILE, y: 2.5 * TILE }; // One tile from the owner, separated by a cliff.
const sameHeightMaster = { x: 4.5 * TILE, y: 2.5 * TILE, climbing: false };
assert.equal(grid[2][3].elevTier, grid[2][4].elevTier, 'fixture checks two locations at identical elevation');
assert.equal(followGoal(nearbySameHeight, sameHeightMaster).routeRequired, true,
  'nearby disconnected walkable regions still request the existing cliff route');
assert.equal(followGoal(companion, { x: 2.5 * TILE, y: 1.5 * TILE }).routeRequired, false,
  'ordinary nearby companions on the same walkable component never request cliff navigation');

const landedMaster = { x: 4.5 * TILE, y: 1.5 * TILE, climbing: false }; // Once the owner lands, the ordinary moving target resumes.
const arrivedPet = { ...companion, x: 4.25 * TILE };
assert.equal(followGoal(arrivedPet, landedMaster).routeRequired, false, 'same-level companion stops requesting a cliff route');
assert.equal(followGoal(arrivedPet, landedMaster).x, landedMaster.x, 'ordinary following targets the actual owner');
const midRoutePet = { ...arrivedPet, _cliffRouteTravel: { route: true } }; // Existing scripted crossings own movement until finished.
assert.equal(followGoal(midRoutePet, landedMaster).routeRequired, true, 'an in-progress route completes inside follow distance');
const midHopPet = { ...arrivedPet, _cliffClimb: { phase: 'climb' } };
assert.equal(followGoal(midHopPet, landedMaster).routeRequired, true, 'an in-progress cliff hop is not interrupted by close range');

const unknownLanding = { ...climbingMaster, climbEndX: NaN, climbEndY: NaN }; // Transitional climbs may not yet have a valid endpoint.
assert.equal(followGoal(companion, unknownLanding).x, unknownLanding.x, 'invalid climb endpoints fall back safely');
context.currentArea = 'farm';
assert.equal(followGoal(companion, climbingMaster).routeRequired, false, 'flat non-wilderness scenes do not invent cliff routes');

const companionLoop = source.slice(source.indexOf('function updateCompanions(dt)'), source.indexOf('// Second pass for the real player'));
assert.doesNotMatch(companionLoop, /Teleport-and-stick|c\.avatarRef\.group\.position\.y = playerMesh\.position\.y \+ c\.halfHeight \* 0\.5/,
  'legacy owner-back climb snapping is absent');
assert.match(companionLoop, /if \(c\.stableRole === 'mount'\) continue/, 'mounted animals remain under mount control');
assert.match(companionLoop, /if \(c\.stableRole === 'shoulderPet'\)/, 'deliberate shoulder pets retain their attachment');
assert.match(companionLoop, /master\.climbing \|\| followGoal\.routeRequired \|\| distToMaster > FOLLOW_FAR_PX/,
  'owner climbing and elevation mismatch both enter the ordinary follow navigation');
assert.match(companionLoop, /travelCreatureToward\(c, followGoal\.x, followGoal\.y, def\.chaseSpeed, dt\)/,
  'cliff following reuses the existing pathfinding and movement speed');
assert.match(companionLoop, /else if \(rescueActive\)/, 'swarm rescue retains its movement priority');
const routePriority = companionLoop.indexOf('} else if (c._cliffClimb || c._cliffRouteTravel) {'); // Checks the actual AI branch ordering.
const combatPriority = companionLoop.indexOf('} else if (target) {'); // An attack must not interrupt an already-committed cliff hop.
assert(routePriority > 0 && combatPriority > routePriority, 'active cliff traversal has priority over newly acquired melee targets');
assert.match(companionLoop.slice(routePriority, combatPriority), /travelCreatureToward\(c, followGoal\.x, followGoal\.y, def\.chaseSpeed, dt\)/,
  'active cliff routes keep advancing through the shared navigator');
assert.match(responseSource, /groundFollow: companion\?\._companionGroundFollow \|\| null/,
  'the existing mobile debug snapshot reports the current ground-follow destination');


// Drive the real creature cliff module through one route; structural tests alone
// cannot catch a one-frame hop that never resumes after the first waypoint.
const cliffSource = fs.readFileSync('docs/js/creature-cliff-climb.js', 'utf8'); // Existing production creature traversal, not a test-specific reimplementation.
const routeNodes = [
  { id: 0, x: 1.5, z: 1.5, y: 0, links: [1] },
  { id: 1, x: 4.5, z: 1.5, y: 2, links: [0] },
]; // Handhold endpoints used by the scripted terrain traversal.
const realRoute = { id: 'test-route', nodes: routeNodes, upperNode: 1 }; // Two-node minimal route with a real elevation transition.
const climbWindow = {
  CliffRouteNetwork: {
    forGrid: () => routeNetwork,
    componentAt: (net, col, row) => net.component[row * net.cols + col] ?? -1,
    toward: (_net, fromCol, fromRow, toCol, toRow) => fromCol === toCol && fromRow === toRow
      ? null : ({ route: realRoute, entry: 0 }),
  },
  MapBoundaryGuard: { isBoundaryTile: () => false },
}; // Existing shared network contract is injected so the production climb module can advance deterministically.
const climbContext = { window: climbWindow, Number, Math }; // Browser-style module scope for actual creature traversal.
vm.runInNewContext(cliffSource, climbContext, { filename: 'creature-cliff-climb.js' });
const climbApi = climbWindow.CreatureCliffClimb; // The same public API called by game.js's moveCreatureToward.
climbApi.init({
  TILE, getCurrentArea: () => 'wilderness', isZoneArea: () => true, getActiveGrid: () => grid,
  getActiveCols: () => 6, getActiveRows: () => 6,
  tileSurfaceYInArea: tile => tile.elevTier || 0,
  isSolid: () => false, creatureCanEnterTile: () => true,
});
const routedPet = { id: 'route-pet', creatureKey: 'test-animal', x: routeNodes[0].x * TILE,
  y: routeNodes[0].z * TILE, areaId: 'wilderness', health: 100, def: { moveSpeed: TILE * 3 } }; // Live entity shape required by the creature climb runtime.
assert.equal(climbApi.navigate(routedPet, routeNodes[1].x * TILE, routeNodes[1].z * TILE, TILE * 3, 0.05), true,
  'the ordinary creature navigation entry accepts the companion approach');
assert(routedPet._cliffRouteTravel, 'the route navigator acquires the cliff path before movement');
for (let i = 0; i < 35; i++) climbApi.navigate(routedPet, routeNodes[1].x * TILE, routeNodes[1].z * TILE, TILE * 3, 0.05);
assert(Math.abs(routedPet.x - routeNodes[1].x * TILE) < 0.5,
  'the actual creature cliff animation reaches the destination without a back-attachment');
assert.equal(routedPet._cliffClimb, null, 'the scripted climb releases movement ownership when it lands');

console.log('companion ground-follow and cliff-route regressions passed');

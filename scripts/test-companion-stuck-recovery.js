#!/usr/bin/env node
'use strict';

// Executes the real follower module, including ruin support/floor, screen, path and timing guards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Ensures the single live companion frame loop calls this module.
const source = fs.readFileSync('docs/js/companion-follow-navigation.js', 'utf8'); // Actual runtime implementation, not a copied helper.
const TILE = 64; // Pixels per tile in this controlled ruin fixture.
const AREA = 'map_i_dev_random_ruin'; // Same map identifier as the real procedural ruin runtime.
const grid = Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => ({
  type: 'floor', elevTier: 0, incline: false,
}))); // Exposes wide rooms without treating an upstairs shaft floor as valid ground.
const owner = { x: 18.5 * TILE, y: 18.5 * TILE, health: 100 }; // Physically located on lower floor y=2.
const camera = { projectPoint: p => ({ x: (p.x - owner.x / TILE) / 4, y: (p.z - owner.y / TILE) / 4, z: 0 }) }; // Near owners are visibly onscreen; distant rooms are not.
const state = { floor: 2, pathExists: true, blocked: false, companionVisible: false };
let candidateFloorChecks = 0, routedChecks = 0, attackCancels = 0; // Verifies the real recovery uses authoritative collision/path APIs.
const windowMock = {
  __farmLog() {},
  GridTileAccessors: { getActiveGrid: () => grid },
  MapBoundaryGuard: { isBoundaryTile: () => false },
  CliffRouteNetwork: { forArea: () => null },
  DynamicSurfaces: {
    sampleSupport: () => { candidateFloorChecks++; return { y: state.floor }; }, // Simulate stacked support sampling within a Y band.
    blockerAt: () => state.blocked ? { id: 'locked-gate' } : null,
    pointInPit: () => null,
  },
  DevRandomRuin: {
    getPlayerGroundSupportY: () => 2,
    shaftCreatureCanEnter: actor => actor.shaftSupportY === 2, // Validates the probe is anchored to owner's story.
    shaftBodyBlocksAtFeet: () => false,
  },
  TilePathfinding: {
    boxAround: () => ({ minCol: 0, maxCol: 40, minRow: 0, maxRow: 40 }),
    findPath: () => { routedChecks++; return state.pathExists ? [{ col: 18, row: 18 }] : null; },
  },
  Combat: { animalAttacks: { cancel: () => attackCancels++ }, telegraph: { cancel() {}, isBusy: () => false },
    cancelStagedForAttacker() {} },
};
const context = { window: windowMock, Number, Math, Set }; // Browser-style sandbox with authoritative simulated services.
vm.runInNewContext(source, context, { filename: 'companion-follow-navigation.js' });
const Navigation = windowMock.CompanionFollowNavigation;
assert(Navigation, 'production navigation module registered');
Navigation.init({
  TILE, player: owner, getCurrentArea: () => AREA, isZoneArea: () => false,
  getActiveGrid: () => grid, getCamera: () => camera,
  surfaceYForTile: () => 0, creatureCanEnter: () => true,
});
function makePet(x = 3.5 * TILE) {
  return { id: 'test-hound', isCompanion: true, stableRole: 'companion', areaId: AREA,
    master: owner, x, y: owner.y, health: 100, halfHeight: .4, groundLift: .4,
    shaftSupportY: 5, def: {}, avatarRef: { group: { position: { x: x / TILE, z: owner.y / TILE, y: 5.4 } } } };
}
function simulate(pet, count = 95) {
  let recovered = false;
  for (let i = 0; i < count; i++) recovered = Navigation.tickRecovery(pet, owner, Navigation.goal(pet, owner), .1) || recovered;
  return recovered;
}

const first = makePet(); // A pet stuck on a higher floor, completely out of the player's view.
assert.equal(simulate(first, 65), false, 'a stuck pet cannot teleport before the patience threshold');
assert.equal(simulate(first, 30), true, 'stuck animal relocates after enough time without progress');
assert.equal(first.shaftSupportY, 2, 'recovered pet is placed on player actual floor, not a higher story');
assert.equal(first.avatarRef.group.position.y, 2.4, 'sprite snaps to the same floor rather than gliding across the dungeon');
assert(routedChecks > 0 && candidateFloorChecks > 0, 'real terrain and reachability checks are exercised');
assert.equal(Navigation.debugSnapshot().teleports, 1, 'mobile diagnostics report successful recovery');
assert(attackCancels > 0, 'combat animation cleanup runs on recovery');
assert.equal(simulate(first, 25), false, 'recovery cooldown prevents an immediate second jump');

const visible = makePet(13.5 * TILE); // Outside ordinary follow radius but still on camera.
assert.equal(simulate(visible), false, 'never make an animal vanish when the player can see it');
const mounted = makePet();
mounted.stableRole = 'mount';
assert.equal(simulate(mounted), false, 'mounted animals are owned by the riding system');
const otherOwner = makePet();
otherOwner.master = { x: owner.x, y: owner.y };
assert.equal(simulate(otherOwner), false, 'NPC-owned animals cannot teleport via the player-specific recovery');
const fighting = makePet();
fighting._companionCombatTarget = { health: 100 };
assert.equal(simulate(fighting), false, 'active combat cannot use the follow teleport');
const prone = makePet();
prone.prone = true;
assert.equal(simulate(prone), false, 'downed or prone animal cannot be yanked across a room');

state.floor = 7; // The only available support is an overhead story, not the owner's floor.
const wrongFloor = makePet();
assert.equal(simulate(wrongFloor), false, 'never snap to the floor above the player');
state.floor = 2;
state.pathExists = false; // The destination is separated from the owner by a locked room.
const disconnected = makePet();
assert.equal(simulate(disconnected), false, 'landing must have a real same-story route back to its owner');
state.pathExists = true;
state.blocked = true;
const blocked = makePet();
assert.equal(simulate(blocked), false, 'registered blocker geometry prevents unsafe recovery');
state.blocked = false;

const acrossArea = makePet();
acrossArea.areaId = 'town';
assert.equal(simulate(acrossArea), false, 'no cross-area teleport');
assert.match(game, /CompanionFollowNavigation\.tickRecovery\(c, master, followGoal, dt\)/,
  'game.js runs recovery from the one existing companion update loop');
assert.doesNotMatch(game, /function companionFollowGoal\(c, master\)/,
  'follow destination calculations have been extracted from game.js');
console.log('Companion off-screen stuck recovery and ruin-floor safety passed');

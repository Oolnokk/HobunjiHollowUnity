#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/tzatzul-live-visuals.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const bridge = fs.readFileSync('docs/js/player-body-attachment-bridge.js', 'utf8');
const context = { window: {}, Math, Number, Date, Map, Set };
vm.runInNewContext(source, context);
const update = context.window.TzatzulLiveVisuals.updateCompanionLocomotion;
const bird = { def: { isFlyingSpecies: true }, stableRole: 'companion' }; // Same role and species flags as the game loop.
for (let i = 0; i < 20; i++) update(bird, .05, 5, true);
assert.equal(bird._companionBirdMotion.mode, 'flight');
assert.equal(bird._companionBirdMotion.lift, .65);
assert.equal(update(bird, .05, 5, false).mode, 'hop');
assert(bird._companionBirdMotion.lift <= .13, 'blocked flight uses short folded-wing hops');
assert.equal(update(bird, .05, 0, false).mode, 'perched');
update(bird, .05, 5, true);
assert.equal(update(bird, .05, 0, true, true).lift, 0, 'combat/knockback/recovery cancel locomotion height');
assert.equal(update({ def: { isFlyingSpecies: false }, stableRole: 'companion' }, .05, 5, true), undefined);
assert.equal(update({ def: { isFlyingSpecies: true }, stableRole: 'shoulderPet' }, .05, 5, true), undefined);
assert.match(source, /actor\.isCompanion && actor\.def\?\.isFlyingSpecies\) rig\.setPerchSpline\?\.\(null\)/);
assert.match(bridge, /if \(companion\?\.def\?\.isFlyingSpecies\) return false;/);
const stepFlight = context.window.TzatzulLiveVisuals.tryCompanionFlightStep;
const flyer = { ...bird, x: 0, y: 0, _travelPath: [{}] };
assert.equal(stepFlight(flyer, 100, 0, 50, .1, 1, () => false), false);
assert.equal(flyer.x, 0, 'blocked flight leaves position untouched for normal routing');
assert.equal(stepFlight(flyer, 100, 0, 50, .1, 1, () => true), true);
assert.equal(flyer.x, 5, 'clear flight advances real coordinates without a ground detour');
assert.equal(flyer._travelPath, null);
assert.equal(stepFlight(flyer, NaN, 0, 50, .1, 1, () => true), false);
const windFlyer = { ...flyer, x: 0, y: 0 }; // Composed displacement must be swept before the flight owner writes coordinates.
const composeWind = (dx, dy, dt) => { assert.equal(dt, .1); return { x: dx, y: dy + 3 }; };
assert.equal(stepFlight(windFlyer, 100, 0, 50, .2, 1, (_x, _y, nx, ny) => nx === 5 && ny === 3, composeWind), true);
assert.equal(windFlyer.x, 5);
assert.equal(windFlyer.y, 3);
assert.equal(stepFlight(windFlyer, 100, 3, 50, .1, 1, () => false, composeWind), false);
assert.equal(windFlyer.y, 3, 'rejected wind displacement never writes coordinates');
assert.equal(stepFlight(windFlyer, 100, 3, 50, .1, 1, () => true, () => ({x: NaN, y: 0})), false);
assert.match(game, /composeMovement\?\.\(c, dx, dy, \{ mode: 'walk', scalarApplied: true, reference: speed \* stepDt, dt: stepDt, airborne: true, wind: windActive \}\)/, 'direct bird flight composes airborne movement rather than bypassing afflictions');
assert.match(game, /if \(moved && motion\?\.wind\) commitComposedMovement\(c, motion,/, 'only accepted flight pays its wind Footing cost');
assert.match(game, /updateCompanionLocomotion\?\.\(c, dt, movedPx, flightClear, interrupted\)/);
assert.match(game, /DevRandomRuin\?\.flightClear/);
assert.match(game, /birdLift/);
// Execute the actual game clearance function with a minimal tile/ceiling/voxel fixture.
const clearStart = game.indexOf('function companionBirdFlightClear(');
const clearEnd = game.indexOf('function tryBirdFollowFlight(', clearStart);
assert(clearStart >= 0 && clearEnd > clearStart);
const walkable = { type: 'grass' }; // Actual same-story support fixture; switch tile to solid for the negative case.
const grid = [[walkable, walkable], [walkable, walkable]];
let blocked = false, floorY = 0, wallHeight = 2, voxelClear = true;
const world = {
  currentArea: 'farm', TILE: 64, INTERIOR_WALL_HEIGHT: 1.75,
  window: {
    GridTileAccessors: { getActiveGrid: () => grid },
    InteriorEnvironmentRuntime: { normalizeEnvironment: () => ({ wallHeight }) },
    DevRandomRuin: { getState: () => ({}), flightClear: () => voxelClear },
  },
  _isZoneArea: () => false, _isBuildingArea: area => area.startsWith('map_i_'),
  _isCavernBuildingArea: area => area === 'map_i_cave',
  _rawMapDataByMapId: new Map([['map_i_room', {}]]),
  activeSurfaceYAtWorld: () => floorY,
  isSolid: type => type === 'rock',
  creatureCanEnterTile: () => true,
  canOccupyAt: () => !blocked,
};
vm.runInNewContext(game.slice(clearStart, clearEnd) + '\nthis.clear = companionBirdFlightClear;', world);
const subject = { def: { isFlyingSpecies: true, modelWidth: .4 }, halfHeight: .2, areaGrid: grid };
assert.equal(world.clear(subject, 32, 32, 35, 32), true);
blocked = true;
assert.equal(world.clear(subject, 32, 32, 35, 32), false);
blocked = false;
grid[0][0] = { type: 'rock' };
assert.equal(world.clear(subject, 32, 32, 35, 32), false);
grid[0][0] = walkable;
world.currentArea = 'map_i_room'; wallHeight = .8;
assert.equal(world.clear(subject, 32, 32, 35, 32), false);
wallHeight = 2;
assert.equal(world.clear(subject, 32, 32, 35, 32), true);
world.currentArea = 'interior';
assert.equal(world.clear(subject, 32, 32, 35, 32), true);
world.currentArea = 'map_i_cave';
assert.equal(world.clear(subject, 32, 32, 35, 32), false);
world.currentArea = 'map_i_dev_random_ruin'; voxelClear = false;
assert.equal(world.clear(subject, 32, 32, 35, 32), false);
voxelClear = true;
assert.equal(world.clear(subject, 32, 32, 35, 32), true);
console.log('flying companion locomotion and undeformed-perch tests passed');

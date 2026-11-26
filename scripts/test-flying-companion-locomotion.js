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
assert.match(game, /updateCompanionLocomotion\?\.\(c, dt, movedPx, flightClear, interrupted\)/);
assert.match(game, /DevRandomRuin\?\.flightClear/);
assert.match(game, /birdLift/);
console.log('flying companion locomotion and undeformed-perch tests passed');

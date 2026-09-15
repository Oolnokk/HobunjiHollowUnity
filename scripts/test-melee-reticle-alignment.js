#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
assert.match(core, /function playerReticleAlignmentSolution\(/, 'player alignment has a screen-reticle solution');
assert.match(core, /reticleOverTarget \? 0 : screenCorrectionRad/, 'reticle overlap produces exactly zero corrective turn');
assert.match(game, /bestAimError/, 'melee target selection prioritizes reticle error before distance');
assert.match(game, /attackAlignmentStep\?\.\(player, c, 0, \{ facing: aimAngle \}\)/, 'candidate ranking uses the same alignment math as the actual turn');

const THREE = { MathUtils: {
  degToRad: d => d * Math.PI / 180,
  radToDeg: r => r * 180 / Math.PI,
  clamp: (v,a,b) => Math.min(b, Math.max(a,v)),
  lerp: (a,b,t) => a + (b-a)*t,
} };
const player = { x: 0, y: 0, health: 100 };
const target = { x: 640, y: 0, health: 100 };
const hitbox = {
  center: { x: 10, y: 1, z: 0 },
  box: { min: { x: 9.5, y: 0, z: -0.5 }, max: { x: 10.5, y: 2, z: 0.5 } },
};
const runtime = { THREE, performance: { now: () => 0 }, window: {
  RangedWeapons: { actorHitbox: actor => actor === target ? hitbox : null },
} };
vm.runInNewContext(core, runtime, { filename: 'combat-core.js' });
runtime.window.Combat.init({
  player,
  TILE: 64,
  getPlayerPerspectiveTarget: () => ({ cameraRay: { origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 } } }),
});
let step = runtime.window.Combat.attackAlignmentStep(player, target, 0, { facing: 0 });
assert.equal(step.alignmentSource, 'screen-reticle');
assert.equal(step.reticleOverTarget, true, 'reticle already on target is recognized');
assert.equal(step.deltaRad, 0, 'reticle already on target must never kick sideways');
assert.equal(step.desiredFacing, 0, 'already-correct shoulder aim keeps its current heading');

hitbox.center.z = 2;
hitbox.box.min.z = 1.5;
hitbox.box.max.z = 2.5;
step = runtime.window.Combat.attackAlignmentStep(player, target, 0, { facing: 0 });
assert.equal(step.reticleOverTarget, false, 'off-reticle target still receives assist');
assert(step.deltaRad > 0, 'assist correction follows the target screen-side instead of actor-root bearing');

const enemy = { x: 0, y: 0, health: 100, facing: 0 };
const victim = { x: 100, y: 10, health: 100 };
step = runtime.window.Combat.attackAlignmentStep(enemy, victim, 0, { facing: 0 });
assert.equal(step.alignmentSource, 'actor-bearing', 'enemy alignment keeps its existing actor-bearing behavior');
console.log('melee reticle alignment regression passed');

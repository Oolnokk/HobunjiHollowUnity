#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

global.THREE = { MathUtils: { degToRad: degrees => degrees * Math.PI / 180 } };
global.window = { SCRATCHBONES_CONFIG: { game: { movement: { creaturePerpRotDeadzoneDeg: 27.5 } } } };
require('../docs/js/perp-rotation.js');

function angleDiff(target, current) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

window.PerpRotation.init({ angleDiff });
const api = window.PerpRotation;
const deg = value => value * Math.PI / 180;
const approx = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`);

const base = deg(27.5);
const extra = deg(30);
const expanded = api.expandOneSidedDeadzone([0, Math.PI], base, [1, -1], extra);
approx(expanded.deadRad, deg(42.5), 'symmetric representation widens by half the one-sided expansion');
approx(expanded.perps[0], deg(15), 'positive-side deadzone center shifts toward its expanded edge');
approx(expanded.perps[1], Math.PI - deg(15), 'negative-side deadzone center shifts toward its expanded edge');
approx(expanded.perps[0] - expanded.deadRad, -base, 'positive-side expansion leaves the opposite edge unchanged');
approx(expanded.perps[0] + expanded.deadRad, base + extra, 'positive-side expansion grows only the selected edge');
approx(expanded.perps[1] - expanded.deadRad, Math.PI - base - extra, 'negative-side expansion grows only the selected edge');
approx(expanded.perps[1] + expanded.deadRad, Math.PI + base, 'negative-side expansion leaves the opposite edge unchanged');

const capped = api.expandOneSidedDeadzone([0], base, [1], deg(90));
approx(capped.expandedEdgeRad, deg(85), 'head clearance caps before opposing camera-perp deadzones can overlap');

const game = fs.readFileSync('docs/game.js', 'utf8');
assert.match(game,
  /const headLeftTurnRad = Math\.max\(0, Number\(playerNeckJoint\?\.rotation\?\.y\) \|\| 0\)/,
  'only character-left player head yaw enlarges shoulder-pet clearance');
assert.match(game,
  /function shoulderPetHeadClearanceDeadzone[\s\S]{0,1800}expandOneSidedDeadzone/,
  'head-clearance wrapper owns the one-sided deadzone expansion');
assert.match(game,
  /c\.stableRole === 'shoulderPet'[\s\S]{0,500}shoulderPetHeadClearanceDeadzone/,
  'head-assisted deadzone wrapper is scoped to shoulder pets');
assert.match(game,
  /const composerYawDelta = window\.PlayerBodyTransformComposer\?\.resolvedYawDeltaRad\?\.\(\) \|\| 0;[\s\S]{0,260}const characterLeftYaw = renderedBodyYaw \+ Math\.PI \/ 2;/,
  'protected side follows the visibly composed torso, including stance body-yaw');
assert.doesNotMatch(game, /behaviorYawOffset/, 'player/companion head yaw is never added to final shoulder-pet billboard yaw');
assert.doesNotMatch(game, /currentFacingYawDeg|targetFacingYawDeg|SHOULDER_PET_REVERSE_SPEED_DEG/, 'PR #268 turn-state behavior is absent from the clean rebuild');
assert.match(game,
  /const billboardWorldYaw = Number\.isFinite\(c\.pngRot\) \? c\.pngRot : \(Number\.isFinite\(c\.groupRot\) \? c\.groupRot : finalGroupRotY\)/,
  'final shoulder-pet rotation remains derived from the normal camera-relative pngRot selection');

console.log('Shoulder-pet head-clearance deadzone checks passed.');

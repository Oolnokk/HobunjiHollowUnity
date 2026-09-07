#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const ambientSource = fs.readFileSync('docs/js/ambient-dialogue.js', 'utf8'); // Checked below for the greeting-only runtime handoff and live player target.
const indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Checked below so browsers cannot retain either stale runtime half.

assert.match(ambientSource, /if \(event\.greeting\) \{[\s\S]{0,100}trackGreetingTarget\(event, dt\)/,
  'active greetings continuously run the shared head/body tracker');
assert.match(ambientSource, /targetId === 'player'[\s\S]{0,100}\{ id: 'player' \}/,
  'player greetings keep a live player identity instead of freezing greeting-start coordinates');
assert.doesNotMatch(ambientSource.slice(ambientSource.indexOf('function tryGreeting'), ambientSource.indexOf('function updateGreetings')),
  /walker\.applyFacingDeadzone/,
  'starting a greeting no longer immediately turns the NPC body');
assert.match(ambientSource, /GREETING_HEAD_MAX_YAW_RAD = Math\.PI \* 65 \/ 180/,
  'greeting neck yaw uses the same 65-degree physical limit as player head aim');
assert.match(ambientSource, /GREETING_BODY_FREE_LOOK_RAD = Math\.PI \/ 3/,
  'greeting bodies stay still throughout the same 60-degree free-look cone as stationary player look');
assert.match(ambientSource, /Math\.abs\(residual\) > GREETING_BODY_FREE_LOOK_RAD[\s\S]{0,260}requestedBodyRot = targetRot - Math\.max/,
  'the body turns only enough to return an out-of-range target to the neck cone edge');
assert.match(ambientSource, /!walker\.neckJoint\?\.parent[\s\S]{0,120}requestedBodyRot = targetRot/,
  'rigid fallback avatars turn their body fully because they have no head joint to track with');
assert.match(ambientSource, /mode: 'ambient-greeting'[\s\S]{0,260}headYawDeg:[\s\S]{0,180}bodyTurnNeeded:/,
  'existing mobile-visible look-ray diagnostics report greeting head/body decisions');
assert.match(indexSource, /ambient-dialogue\.js\?v=20260907greetinglook1/,
  'ambient greeting runtime cache key is bumped');

console.log('ambient greeting head-tracking tests passed');

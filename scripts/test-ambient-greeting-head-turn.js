#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const ambient = fs.readFileSync('docs/js/ambient-dialogue.js', 'utf8'); // Verifies player- and NPC-directed ambient greetings own only NPC neck yaw.
const composer = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8'); // Verifies NPC greeting yaw reads the player's physical head-turn cap.
const pixelProbe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Verifies mobile diagnostics expose the rendered greeting yaw.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Verifies the changed composer is cache-busted.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Verifies changed ambient/probe assets are cache-busted.

assert.match(
  ambient,
  /function applyGreetingHeadTurn\(walker, targetPosition\)[\s\S]{0,2200}neckJoint\.rotation\.y = renderedYaw/,
  'ambient player greetings must steer the existing NPC neck joint instead of rotating the body',
);
assert.match(
  ambient,
  /getHeadMaxYawDeg\?\.\(\)[\s\S]{0,350}65/,
  'ambient greeting head turns must read the player head limit with the current 65 degree fallback',
);
assert.match(
  composer,
  /getHeadMaxYawDeg:\s*\(\) => PLAYER_HEAD_MAX_YAW_DEG/,
  'the player body composer must expose its authoritative physical head yaw cap',
);
assert.match(
  ambient,
  /applyGreetingHeadTurn\(walker, target\); \/\/ Every ambient greeting preserves locomotion\/seat heading/,
  'player and NPC-friend greetings must both start with head-only facing',
);
assert.match(
  ambient,
  /faceMode: 'head', \/\/ Walking and seated greetings to either the player or another NPC/,
  'every active greeting must keep head-only tracking for its full lifetime',
);
assert.match(
  ambient,
  /if \(event\.faceMode === 'head'\) \{\s*applyGreetingHeadTurn\(event\.faceWalker, targetPosition\);/,
  'per-frame ambient facing must refresh the neck turn without turning a walking or seated NPC body',
);
assert.doesNotMatch(
  ambient,
  /function tryGreeting\(walker, target[\s\S]{0,5000}applyFacingDeadzone/,
  'ambient greeting startup must never rotate either a walking or seated NPC body',
);
assert.match(
  ambient,
  /seated:\s*!!walker\._seatedStationKey[\s\S]{0,180}currentScheduleTarget\?\.pose/,
  'greeting facing diagnostics must identify seated walkers while using the same neck-only code path',
);
assert.match(
  ambient,
  /function releaseGreetingHeadTurn\(event\)[\s\S]{0,320}neckJoint\.rotation\.y = 0/,
  'ambient greeting disposal must release the neck yaw it owns',
);
assert.match(
  pixelProbe,
  /Ambient greeting facing: mode=\$\{ambientFacing\.mode[\s\S]{0,500}renderedYaw=/,
  'Pixel Probe must report head-only greeting yaw on tapped NPCs for mobile debugging',
);
assert.match(loader, /player-body-transform-composer\.js\?v=20260927greetinghead1/, 'composer cache bust must ship');
assert.match(index, /ambient-dialogue\.js\?v=20260927greetinghead2/, 'ambient greeting cache bust must ship');
assert.match(index, /pixel-probe\.js\?v=20260927lichgreeting1/, 'combined greeting + lich Pixel Probe cache bust must ship');

console.log('Ambient greeting head-turn checks passed.');

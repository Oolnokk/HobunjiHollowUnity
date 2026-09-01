#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

assert.match(
  game,
  /function cursorlessMouseAimRequested\(\) \{[\s\S]{0,220}characterViewMode\.enabled[\s\S]{0,220}s_shoulderSurf[\s\S]{0,220}activeCameraMode === SHOULDER_SURF_MODE/,
  'Character View and Shoulder Cam share the cursor-less mouse-aim request predicate',
);
assert.match(
  game,
  /function shoulderSurfPointerLockActive\(\) \{\s*return document\.pointerLockElement === threeContainer;\s*\}/,
  'relative mouse input remains driven by the existing generic canvas pointer-lock state',
);
assert.match(
  game,
  /function requestShoulderSurfPointerLock\(\) \{\s*if \(!cursorlessMouseAimRequested\(\) \|\| !isDesktop \|\| shoulderSurfPointerLockActive\(\)\) return;/,
  'pointer-lock requests are gated by cursor-less aim rather than Shoulder Cam alone',
);
assert.match(
  game,
  /characterViewMode\.enabled = nextEnabled;\s*if \(nextEnabled\) \{\s*requestShoulderSurfPointerLock\(\);\s*\} else if \(!cursorlessMouseAimRequested\(\)\) \{\s*releaseShoulderSurfPointerLock\(\);\s*\}/,
  'Character View explicitly enters and exits cursor-less mouse aim',
);
assert.match(
  game,
  /if \(!cursorlessMouseAimRequested\(\)\) releaseShoulderSurfPointerLock\(\);/,
  'frame safety retains pointer lock while Character View is active',
);
assert.equal(
  (game.match(/if \(cursorlessMouseAimRequested\(\)\) requestShoulderSurfPointerLock\(\);/g) || []).length,
  3,
  'menu-close, gameplay-click, and configurable utility-release paths honor Character View',
);
assert.match(
  game,
  /actionId === 'utilitySelect'[\s\S]{0,500}if \(cursorlessMouseAimRequested\(\)\) requestShoulderSurfPointerLock\(\)/,
  'releasing the configurable utility selector restores cursor-less aim when Character View remains active',
);
assert.match(index, /game\.js\?v=20260901input2/, 'the Character View cursor-lock fix is cache-invalidated');

console.log('Character View cursor-less mouse aim checks passed.');

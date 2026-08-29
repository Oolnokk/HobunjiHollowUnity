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
  2,
  'menu-close and gameplay-click reacquire paths both honor Character View',
);
assert.match(
  game,
  /function finishDesktopHoldKey\(key\) \{[\s\S]{0,1200}if \(wasHeld && state\.arc === 'utilities' && cursorlessMouseAimRequested\(\)\) \{\s*requestShoulderSurfPointerLock\(\);\s*\}[\s\S]{0,120}return wasHeld;/,
  'closing the utility wheel restores cursor-less aim when Character View remains active',
);
assert.match(index, /game\.js\?v=20260829charviewcursor1/, 'the Character View cursor-lock fix is cache-invalidated');

console.log('Character View cursor-less mouse aim checks passed.');

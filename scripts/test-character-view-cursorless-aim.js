#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

// The pointer-lock predicate/request/release cluster lives in js/shoulder-cam-pointer-lock.js;
// game.js hands it the live state through init() and keeps thin same-named wrappers.
const pointerLock = fs.readFileSync('docs/js/shoulder-cam-pointer-lock.js', 'utf8');
assert.match(
  game,
  /ShoulderCamPointerLock\.init\(\{[\s\S]{0,400}isCharacterViewEnabled: \(\) => characterViewMode\.enabled,[\s\S]{0,200}isShoulderSurfEnabled: \(\) => s_shoulderSurf,[\s\S]{0,200}getActiveCameraMode: \(\) => activeCameraMode,[\s\S]{0,200}shoulderSurfMode: SHOULDER_SURF_MODE/,
  'game.js wires Character View, Shoulder Cam, and the live camera mode into the pointer-lock module',
);
assert.match(
  pointerLock,
  /function cursorlessMouseAimRequested\(\) \{[\s\S]{0,220}isCharacterViewEnabled\(\)[\s\S]{0,220}isShoulderSurfEnabled\(\)[\s\S]{0,120}getActiveCameraMode\(\) === deps\.shoulderSurfMode/,
  'Character View and Shoulder Cam share the cursor-less mouse-aim request predicate',
);
assert.match(
  pointerLock,
  /function isActive\(\) \{\s*return !!deps\?\.threeContainer && document\.pointerLockElement === deps\.threeContainer;\s*\}/,
  'relative mouse input remains driven by the existing generic canvas pointer-lock state',
);
assert.match(
  pointerLock,
  /function request\(\) \{\s*if \(!cursorlessMouseAimRequested\(\) \|\| !deps\.isDesktop \|\| isActive\(\)\) return;/,
  'pointer-lock requests are gated by cursor-less aim rather than Shoulder Cam alone',
);
assert.match(game, /function requestShoulderSurfPointerLock\(\) \{ window\.ShoulderCamPointerLock\.request\(\); \}/,
  'existing game.js call sites delegate requests to the module');
assert.match(game, /function releaseShoulderSurfPointerLock\(\) \{ window\.ShoulderCamPointerLock\.release\(\); \}/,
  'existing game.js call sites delegate releases to the module');
assert(index.indexOf('js/shoulder-cam-pointer-lock.js?v=') > -1 && index.indexOf('js/shoulder-cam-pointer-lock.js?v=') < index.indexOf('"game.js?v='),
  'pointer-lock module loads before game.js calls its init()');
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
assert.match(index, /game\.js\?v=\d+\w*/, 'the Character View cursor-lock fix is cache-invalidated');

console.log('Character View cursor-less mouse aim checks passed.');

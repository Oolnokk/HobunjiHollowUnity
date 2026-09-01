#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const config = source('docs/config/scratchbones-config.js');
const game = source('docs/game.js');
const panel = source('docs/js/input-settings-panel.js');
const index = source('docs/index.html');

assert.match(config, /"storageKey": "scratchbones\.inputBindings\.v2"/,
  'two-slot bindings use their own storage schema');
assert.match(config, /"legacyStorageKeys": \["scratchbones\.inputBindings\.v1"\]/,
  'existing one-slot player mappings are migrated');
assert.match(config, /"bindingSlotsPerAction": 2/,
  'the number of slots is authored outside game.js');
assert.match(config, /"id": "action1"[^\n]+"desktop": \["Mouse0", "Space"\]/,
  'Action 1 defaults to left mouse and Space in configuration');
assert.match(config, /"id": "action2"[^\n]+"desktop": \["Mouse2", null\]/,
  'Action 2 defaults to right mouse in configuration');
assert.match(config, /"id": "moveUp"[^\n]+\["KeyW", "ArrowUp"\]/,
  'desktop movement defaults are configurable');

assert.match(panel, /currentSlots\(device, action\.id\)\.forEach\(\(binding, slotIndex\)/,
  'settings renders every configured binding slot');
assert.match(panel, /window\.addEventListener\('keydown', onKeyDown, true\); window\.addEventListener\('pointerdown', onPointerDown, true\)/,
  'the desktop listener races keyboard and mouse and accepts the first input');
assert.match(panel, /commit\(`Mouse\$\{event\.button\}`\)/,
  'mouse buttons are stored as ordinary bindings');
assert.match(panel, /Binding conflicts \(all listed actions will trigger\)/,
  'overlaps are summarized as warnings instead of rejected');
assert.match(panel, /resetInputBindingsBtn[\s\S]*?deps\.resetInputBindings\(\)/,
  'the controls panel exposes reset-to-defaults');

assert.match(game, /function getActionsForButton[\s\S]*?\.filter\(actionId => \(bindings\[actionId\] \|\| \[\]\)\.includes\(button\)\)/,
  'runtime lookup returns every overlapping action');
assert.match(game, /for \(const actionId of configuredActions\) dispatchInputAction\(actionId, 'press'\)/,
  'keyboard presses dispatch every overlapping action');
assert.match(game, /getActionsForButton\('desktop', `Mouse\$\{e\.button\}`\)/,
  'mouse presses resolve through the same configured desktop table');
assert.match(game, /activeInputActionCounts/,
  'two simultaneous physical inputs keep shared action hold ownership balanced');
assert.doesNotMatch(game, /e\.button === 0\s*\?\s*'action1'|e\.button === 2\s*\?\s*'action2'/,
  'mouse actions are not hardcoded to physical buttons');
assert.doesNotMatch(game, /const DESK_KEYS =|\['E', 'Q', 'F3', 'F4'\]/,
  'desktop prompt badges are not hardcoded in game.js');

assert.match(index, /id="controlsConflictWarning"/,
  'controls section has a top-level conflict warning');
assert.match(index, /id="resetInputBindingsBtn"/,
  'controls section has a reset button');
assert.match(index, /game\.js\?v=20260901input2/,
  'game cache version includes the input refactor');
assert.match(index, /style\.css\?v=20260901input2/,
  'controls layout styles are cache-invalidated');

console.log('configurable two-slot input binding tests passed');

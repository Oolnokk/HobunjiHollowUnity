#!/usr/bin/env node
'use strict';
// P2: regression guard for one world-button provider invocation per HUD refresh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const game = fs.readFileSync('docs/game.js','utf8');
const refreshStart = game.indexOf('function refreshActionBar(stacks = getInventoryStackItems())');
assert(refreshStart >= 0, 'canonical refreshActionBar still exists');
const refreshEnd = game.indexOf('\n      function ', refreshStart + 1);
const refresh = game.slice(refreshStart, refreshEnd >= 0 ? refreshEnd : refreshStart + 12000);
assert.match(refresh,/const actionContext = \{ reticle, aimedObject: obj, objectActionIds: new Set\(\) \}/,
  'one refresh context carries aimed object and resolved IDs');
assert.match(refresh,/const btns = computeActionButtons\(actionContext\)/,
  'context is reused by the action-bar provider pass');
assert.match(refresh,/const objectActionIds = actionContext\.objectActionIds/,
  'interaction identity derives from the first resolved provider response');
assert.doesNotMatch(refresh,/new Set\(\(obj\?\.getButtons/,
  'a second getButtons call may not be used just to classify actions');
assert.match(game,/function buttonsForWorldObject\(object, reticle, context\)/,
  'one centralized provider adapter owns button resolution');
console.log('PASS runtime audit P2: per-refresh world button provider is resolved once');

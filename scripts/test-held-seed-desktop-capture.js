#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const badges = source('docs/js/held-seed-desktop-capture.js');
const loader = source('docs/js/combat/combat-config-loader.js');
const game = source('docs/game.js');

assert.match(badges, /function normalizedCodes\(value\)/,
  'action badges normalize legacy scalar and current array bindings');
assert.match(badges, /window\.__hobunjiInputBindings\?\.desktop/,
  'action badges prefer the live in-memory binding table');
assert.match(badges, /desktopCodesForAction\(`action\$\{index \+ 1\}`\)\.map\(keyBadgeLabel\)\.join\(' \/ '\)/,
  'action badges display both configured input slots');
assert.doesNotMatch(badges, /addEventListener\('keydown'|addEventListener\('keyup'|addEventListener\('wheel'/,
  'the compatibility badge module no longer intercepts gameplay input');
assert.match(badges, /window\.addEventListener\('hobunji-input-bindings-changed'/,
  'binding changes update action badges immediately');
assert.match(badges, /window\.HobunjiDesktopActionSlotRouter = api;[\s\S]*?window\.HobunjiHeldSeedDesktopCapture = api/,
  'historical loader and diagnostic namespaces remain available');

assert.doesNotMatch(game, /const DESK_KEYS =/,
  'game.js no longer authors hardcoded action-button key badges');
assert.match(game, /desktopHudInputLabel\(`action\$\{idx \+ 1\}`\)/,
  'desktop HUD prompts resolve configured action bindings');
assert.match(loader, /held-seed-desktop-capture\.js\?v=20260901input2/,
  'loader cache version points at the badge-only compatibility module');

console.log('configurable action-button badge tests passed');

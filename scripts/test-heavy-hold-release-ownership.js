#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for the heavy-hold release regression contracts below.
const fs = require('node:fs'); // Used to inspect the browser-only input modules without constructing the full game DOM.

const game = fs.readFileSync('docs/game.js', 'utf8'); // Desktop mouse routing under test.
const combatInput = fs.readFileSync('docs/js/combat/combat-input.js', 'utf8'); // Shared tap/hold state machine under test.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Browser bootstrap under test.

assert.match(
  game,
  /const desktopWeaponPointerSlots = new Map\(\)[\s\S]*?desktopWeaponPointerSlots\.set\(e\.button, 2\)/,
  'desktop weapon presses retain ownership of their original combat slot',
);
assert.match(
  game,
  /const ownedSlot = desktopWeaponPointerSlots\.get\(e\.button\)[\s\S]*?Combat\?\.input\?\.pressEnd\(ownedSlot\)/,
  'release ends the originally pressed slot without consulting the current tool state',
);
assert.match(
  game,
  /window\.addEventListener\('pointerup', finishDesktopMouseAction\)[\s\S]*?window\.addEventListener\('mouseup', finishDesktopMouseAction\)/,
  'Pointer Events and Pointer Lock mouse releases share the same release path',
);
assert.match(
  combatInput,
  /function abortPress\(slotIndex\)[\s\S]*?if \(s\.holding\) endHold\(slotIndex\)[\s\S]*?emitState\(slotIndex, 'press-abort'\)/,
  'cancellation lowers a started heavy hold without firing a pending tap',
);
assert.match(
  combatInput,
  /window\.addEventListener\('blur', abortAllPresses\)[\s\S]*?if \(document\.hidden\) abortAllPresses\(\)/,
  'focus loss and tab hiding cannot strand a held heavy ability',
);
assert.match(
  index,
  /combat-input\.js\?v=20260831heavyhold1[\s\S]*?game\.js\?v=20260831heavyhold1/,
  'both changed browser modules are cache-invalidated together',
);

console.log('heavy-hold release ownership contracts: 6 checks passed');

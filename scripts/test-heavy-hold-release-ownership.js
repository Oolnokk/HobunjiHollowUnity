#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for the heavy-hold release regression contracts below.
const fs = require('node:fs'); // Used to inspect the browser-only input modules without constructing the full game DOM.

const game = fs.readFileSync('docs/game.js', 'utf8'); // Desktop mouse routing under test.
const combatInput = fs.readFileSync('docs/js/combat/combat-input.js', 'utf8'); // Shared tap/hold state machine under test.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Browser bootstrap under test.

assert.match(
  game,
  /const ownedWeaponInputSlots = new Map\(\)[\s\S]*?ownedWeaponInputSlots\.set\(actionId, weaponSlot\)/,
  'configured weapon presses retain ownership of their original combat slot',
);
assert.match(
  game,
  /const releaseSlot = ownedWeaponInputSlots\.get\(actionId\) \|\| weaponActionSlot\(actionId\)[\s\S]*?Combat\.input\.pressEnd\(releaseSlot\)/,
  'release ends the originally pressed slot without consulting the current tool state',
);
assert.match(
  game,
  /window\.addEventListener\('pointerup', finishDesktopMouseAction, true\)[\s\S]*?window\.addEventListener\('mouseup', finishDesktopMouseAction, true\)/,
  'Pointer Events and Pointer Lock mouse releases are captured before UI handlers can swallow them',
);
assert.match(
  game,
  /window\.addEventListener\('contextmenu',[\s\S]*?desktopMousePressActions\.has\(e\.button\)[\s\S]*?finishDesktopMouseAction\(e\)/,
  'a completed right-click context gesture also releases its owned combat hold',
);
assert.match(
  game,
  /for \(const button of \[\.\.\.desktopMousePressActions\.keys\(\)\]\)[\s\S]*?mouseButtonMask\(button\)[\s\S]*?finishDesktopMouseAction\(\{ button, pointerType: 'mouse' \}\)/,
  'the live mouse button bitmask repairs any missing configured mouse release event',
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
  /combat-input\.js\?v=20260831heavyhold2[\s\S]*?game\.js\?v=20260901input2/,
  'the unchanged combat state machine and changed game router have explicit cache versions',
);

console.log('heavy-hold release ownership contracts: 8 checks passed');

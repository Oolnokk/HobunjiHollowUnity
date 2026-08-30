#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for the Sleep/Wait input-routing regression contracts below.
const fs = require('node:fs'); // Used to inspect the browser-only calendar module without constructing the full game DOM.

const calendar = fs.readFileSync('docs/js/calendar-system.js', 'utf8'); // Source under test; time passage is installed inside the browser game closure.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Bootstrap under test; mobile browsers must receive the corrected input module immediately.

assert.match(
  calendar,
  /if \(event\.type === 'pointerup'\) openTimePassage\(wantsSleep \? 'sleep' : 'wait'\)/,
  'Sleep and Wait action-arch taps must trigger on pointer release',
);
assert.doesNotMatch(
  calendar,
  /if \(event\.type === 'pointerdown'\) openTimePassage\(wantsSleep \? 'sleep' : 'wait'\)/,
  'Sleep and Wait action-arch taps must not trigger on pointer press',
);
assert.match(
  calendar,
  /_seatedWaitPointerId = event\.pointerId;[\s\S]*?window\.addEventListener\('pointerup',[\s\S]*?openTimePassage\('wait'\)/,
  'seated right-click must arm on press and open Wait on the matching release',
);
assert.match(
  calendar,
  /window\.addEventListener\('contextmenu',[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopImmediatePropagation\(\);/,
  'the complete seated right-click gesture must suppress the native browser context menu',
);
assert.match(
  calendar,
  /window\.addEventListener\('pointercancel',[\s\S]*?_seatedWaitPointerId = null/,
  'a canceled right-click must disarm seated Wait',
);
assert.match(
  calendar,
  /function cancelInterceptedDesktopHolds\(\)[\s\S]*?_seatedWaitPointerId = null;/,
  'losing window focus must disarm seated Wait',
);
assert.match(
  index,
  /calendar-system\.js\?v=20260830release1/,
  'the corrected calendar input module must be cache-invalidated',
);

console.log('time-passage release-input contracts: 7 checks passed');

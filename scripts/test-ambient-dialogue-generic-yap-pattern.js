#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const ambient = read('docs/js/ambient-dialogue.js');
const frontHat = read('docs/js/front-hat-head-facing.js');
const portraitBreathing = read('docs/js/portrait-breathing.js');
const normalDialogue = read('docs/js/dialogue-content.js');

assert.match(frontHat, /const AMBIENT_TALK_MIN_YAPS = 3/, 'ambient talking has a hard minimum of three yaps');
assert.match(frontHat, /const AMBIENT_TALK_AVERAGE_YAPS = 5/, 'ambient talking documents five yaps as the ordinary target');
assert.match(frontHat, /const AMBIENT_TALK_MAX_YAPS = 8/, 'ambient talking has a hard maximum of eight yaps');
assert.match(frontHat, /const AMBIENT_TALK_OPEN_MIN_MS = 210/, 'ambient yaps hold open long enough to avoid flicker');
assert.match(frontHat, /const AMBIENT_TALK_OPEN_MAX_MS = 280/, 'ambient yap holds remain bounded');

const countPoolMatch = frontHat.match(/AMBIENT_TALK_COUNT_POOL = Object\.freeze\(\[([^\]]+)\]\)/);
assert.ok(countPoolMatch, 'ambient talking exposes a weighted finite yap-count pool');
const countPool = countPoolMatch[1].split(',').map(value => Number(value.trim()));
assert.equal(Math.min(...countPool), 3, 'weighted yap counts never fall below three');
assert.equal(Math.max(...countPool), 8, 'weighted yap counts never exceed eight');
const averageYaps = countPool.reduce((sum, value) => sum + value, 0) / countPool.length;
assert.ok(Math.abs(averageYaps - 5) <= 0.15, `weighted ambient yap average stays near five (got ${averageYaps})`);

assert.match(frontHat, /startsWith\('ambient:'\)/, 'generic talking is restricted to ambient chathead seats');
assert.match(frontHat, /function ambientYapCount\(seatId\)/, 'each ambient line chooses one finite yap count');
assert.match(frontHat, /function ambientTalkExpression\(seatId\)/, 'ambient mouth state is sampled from finite yap windows at render time');
assert.match(frontHat, /pulseStartMs[\s\S]*openMs[\s\S]*return 'yap'/, 'ambient yaps use longer finite mouth-open windows');
assert.doesNotMatch(frontHat, /AMBIENT_TALK_FRAME_MS|AMBIENT_TALK_PATTERNS/, 'the prior rapid looping frame pattern is removed');
assert.match(frontHat, /if \(isAmbientSeatId\(seatId\)\) \{[\s\S]*ambientTimedYapsSuppressed \+= 1;[\s\S]*return;/, 'ambient syllable-timed triggerYap calls are ignored');
assert.doesNotMatch(ambient, /buildAmbientYapQueue|nextAmbientYapFrame|ambientFrameComposer/, 'ambient dialogue does not own text-derived yap queues');
assert.match(ambient, /portraitBreathingComposer\?\.triggerYap\(event\.seatId\)/, 'legacy ambient pulse calls may remain at the call site but are intercepted before changing the mouth');

assert.match(normalDialogue, /portraitBreathingComposer\?\.triggerYap/, 'normal dialogue still uses the existing precise timed yap behavior');
assert.match(portraitBreathing, /scheduleYapSequence\(seatId, text, opts = \{\}\)/, 'normal/shared syllable yap scheduling remains intact');

console.log(`Ambient generic yap pacing test passed (average ${averageYaps.toFixed(2)}, range ${Math.min(...countPool)}-${Math.max(...countPool)})`);

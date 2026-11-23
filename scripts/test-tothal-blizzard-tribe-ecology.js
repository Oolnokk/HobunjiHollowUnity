#!/usr/bin/env node
'use strict';
// Exercise the actual tribe ecology owner under a blizzard, including a
// same-sized hostile swap (the former count-only guard could miss this).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = 'docs/js/porakaneki-camps-runtime.js'; // Real production owner, not a copied storm helper.
let now = 0; // Fake existing monotonic scheduler clock; no new tick owner.
let storm = 1; // Current blizzard severity for wilderness actor suppression.
let scans = 0; // Count full hostile-roster enumerations to enforce dormant CPU behavior.
let actors = new Set(); // Live hostile identities; mutable without changing their count.
let roster = { get size() { return actors.size; }, *[Symbol.iterator]() { scans++; yield* actors; } }; // Stable actor collection with a measurable iterator.
const win = { TothalBlizzard: { currentState: () => ({ storm }) } };
const source = fs.readFileSync(path, 'utf8');
const seam = '  window.TribeCamps = TribeCamps;';
assert(source.includes(seam), 'stable test-only hook follows both real tribe registrations');
vm.runInNewContext(source.replace(seam,
  '  window.__tothalEcologyRegression = { bind(deps) { combatDeps = deps; }, update: updateChunkEcology };\n' + seam),
  {window: win, console, performance: {now: () => now}}, {filename:path});
const audit = win.__tothalEcologyRegression;
assert(audit?.update, 'test accesses the actual runtime ecology pass');
audit.bind({hostileObjects:roster});
const target = {id:'pre-storm foe'};
const first = {health:10, state:'chase', _chunkCombatTarget:target};
actors.add(first);
audit.update();
assert.equal(first._chunkCombatTarget, null, 'storm entry releases preexisting duels');
assert.equal(first.state, 'return', 'a stopped duel also releases the combat chase state');
assert.equal(scans, 1, 'initial storm checks the roster exactly once');
now=150;
audit.update();
assert.equal(scans,1,'storm ecology avoids repeated full actor scans on every 200ms tick');
actors.delete(first);
const replacement = {health:10, state:'chase', _chunkCombatTarget:{id:'new foe'}};
actors.add(replacement);
now=500;
audit.update();
assert.equal(scans,1,'same-count replacements use a bounded two-second lease');
now=2005;
audit.update();
assert.equal(replacement._chunkCombatTarget,null,'same-size actor replacement is cleared during the next lease');
assert.equal(scans,2,'one refresh catches the replacement without a new animation loop');
const predatorTarget={id:'prey'};
replacement._chunkFactionEcologyTarget=predatorTarget;
replacement.targetCreature=predatorTarget;
replacement.state='patrol-chase';
now=4030;
audit.update();
assert.equal(replacement._chunkFactionEcologyTarget,null,'predator ecology targets cannot restart fights indefinitely in storms');
assert.equal(replacement.targetCreature,null,'predator pursuit target is cleared together with the ecology owner');
assert.equal(replacement.state,'idle','a cancelled wildlife pursuit returns to idle');
const swapped={health:10,state:'chase',_chunkCombatTarget:{id:'third foe'}};
roster={size:1, *[Symbol.iterator]() {scans++; yield swapped; }};
audit.bind({hostileObjects:roster});
now=4100;
audit.update();
assert.equal(swapped._chunkCombatTarget,null,'roster reference replacement invalidates the lease immediately');
storm=0;
audit.update(); // Normal mode resets the event lease even in an area without player ecology.
storm=1;
swapped._chunkCombatTarget={id:'new event'};
now=4200;
audit.update();
assert.equal(swapped._chunkCombatTarget,null,'a new blizzard always performs its own first scan');
console.log('Tothal tribe ecology same-sized swaps, target cleanup and bounded storm scans passed.');

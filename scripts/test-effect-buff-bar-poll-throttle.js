#!/usr/bin/env node
'use strict';
// Executes the real EffectBuffBar: polled refresh(false) calls are limited to 10 Hz, forced rebuilds are immediate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = 1000;
const bar = { style: {}, innerHTML: '', querySelectorAll: () => [] };
const window = {};
vm.runInNewContext(fs.readFileSync('docs/js/effect-buff-bar.js', 'utf8'), {
  window, console, performance: { now: () => now }, document: { getElementById: id => (id === 'buffBar' ? bar : null) },
});
const B = window.EffectBuffBar;
let lastRefreshes = () => B.getDebug().refreshes;
for (let i = 0; i < 60; i++) { now += 16; B.refresh(false); } // ~1 s of per-frame polling
assert.ok(lastRefreshes() >= 8 && lastRefreshes() <= 11, 'about 10 refreshes per second, not 60: ' + lastRefreshes());
const before = lastRefreshes();
B.refresh(true); B.refresh(true);
assert.equal(lastRefreshes(), before + 2, 'forced rebuilds are never throttled');
let live = true;
B.registerProvider('t', () => (live ? [{ key: 'a', label: 'A', icon: 'x', kind: 'buff', remainingS: 5, durationS: 10 }] : []));
now += 150; B.refresh(false);
assert.ok(bar.innerHTML.includes('t:a'), 'a new effect appears on the next polled refresh within ~100 ms');
console.log('effect buff bar poll throttle passed');

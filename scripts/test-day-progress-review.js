'use strict';

const assert = require('node:assert/strict'); // Used for deterministic regression assertions below.
const fs = require('node:fs'); // Used to read the shipped module source under test.
const path = require('node:path'); // Used to resolve the repository-relative review module path.
const vm = require('node:vm'); // Used to execute the browser module in a minimal window-shaped sandbox.

const reviewPath = path.join(__dirname, '..', 'docs', 'js', 'day-progress-review.js'); // Shipped review module parsed and exercised below.
const source = fs.readFileSync(reviewPath, 'utf8'); // Current review module source parsed and exercised below.
const storage = new Map(); // In-memory localStorage replacement used by the module's boot path.
const windowStub = { // Minimal browser-like global required for the module's pure helper surface.
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
  },
  addEventListener() {},
  __hobunjiPlayerProfile: { worldId: 'test-world' },
};
const documentStub = { // DOM lookups return no UI because these tests cover the pure classification/math seams.
  getElementById() { return null; },
  querySelector() { return null; },
  documentElement: {},
};
const context = { // VM globals matching browser primitives referenced during module initialization.
  window: windowStub,
  document: documentStub,
  console,
  setTimeout,
  clearTimeout,
  Object,
  Math,
  Number,
  String,
  JSON,
  Set,
  WeakSet,
  Promise,
};

new vm.Script(source, { filename: 'day-progress-review.js' });
vm.runInNewContext(source, context, { filename: 'day-progress-review.js' });
const test = windowStub.DayProgressReview?._test; // Public test-only pure helpers exported by the module.
assert(test, 'DayProgressReview exposes its pure regression helpers');

assert.equal(test.rewardBucket('currency', '+24g'), 'money', 'gold-style currency is classified as Money');
assert.equal(test.rewardBucket('currency', '+3 Motes of Prowess'), 'motes', 'Motes of Prowess remain a distinct currency row');
assert.equal(test.rewardBucket('masteryXp', '+2 Hatchet Mastery'), 'masteryXp', 'mastery XP uses its own review bucket');
assert.equal(test.rewardBucket('skillXp', '+5 Farming XP'), 'skillXp', 'ordinary skill XP stays in the skill bucket');
assert.equal(test.rewardBucket('skillXp', '+5 Brindle Mount XP'), 'petXp', 'mount XP is split into the pet-XP review bucket');
assert.equal(test.rewardBucket('skillXp', '+4 Miri Shoulder Pet XP'), 'petXp', 'shoulder-pet XP is split into the pet-XP review bucket');
assert.equal(test.rewardBucket('skillXp', '+6 Kzubu Companion XP'), 'petXp', 'animal-companion XP is split into the pet-XP review bucket');
assert.equal(test.rewardBucket('loot', '+2 Pine Log'), 'items', 'positive loot is classified as received items');

assert.deepEqual(
  JSON.parse(JSON.stringify(test.parseRewardText('+1,250 Farming XP'))),
  { positive: true, amount: 1250, label: 'Farming XP', text: '+1,250 Farming XP' },
  'reward parser preserves labels while accepting comma-separated amounts',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(test.parseRewardText('Pine Log x12'))),
  { positive: true, amount: 12, label: 'Pine Log', text: 'Pine Log x12' },
  'reward parser accepts trailing item counts',
);
assert.equal(test.parseRewardText('-2 Pine Log').positive, false, 'losses are not misreported as received-item gains');

assert.equal(test.representedHour(0), 6, 'continuous review clock begins at the 06:00 raw-day rollover');
assert.equal(test.representedHour(0.75), 24, 'time01 0.75 is continuous hour 24 even though the public full-day clock displays 00:00');
assert.equal(test.representedHour(0.875), 27, 'post-midnight hours stay continuous through the raw 06:00 rollover boundary');
assert.equal(test.crossesCivilMidnight(23.99, 24.01), true, 'continuous natural drift crossing represented midnight opens the review');
assert.equal(test.crossesCivilMidnight(23, 24), true, 'one-hour sleep/wait step from 23:00 to midnight opens the review');
assert.equal(test.crossesCivilMidnight(22, 23), false, 'ordinary pre-midnight clock movement does not open the review');
assert.equal(test.crossesCivilMidnight(24, 25), false, 'post-midnight clock movement does not re-open the same review');
assert.equal(test.rapportConversion(37, 0.10), 4, 'Rapport conversion uses the same Math.round behavior as NpcRapport.settle');
assert.equal(test.rapportConversion(4, 0.10), 0, 'sub-half Favor conversion rounds to zero exactly like the social bridge');

assert(source.includes('const fromHour = representedHour(before)'), 'natural midnight gate derives an unwrapped hour directly from time01');
assert(source.includes('const fromHour = representedHour(startTime)'), 'sleep/wait midnight gate derives an unwrapped hour directly from time01');
assert(!source.includes('const fromHour = calendarApi.getHour(startTime)'), 'sleep/wait gate must not use the wrapped public 0-23 display clock');
assert(source.includes("confirm.addEventListener('click', runReviewAwarePassage, true)"), 'sleep/wait Confirm is intercepted in capture phase before CalendarSystem private listener');
assert(source.includes("await requestMidnightReview({ source: kind"), 'sleep/wait hourly passage explicitly awaits the midnight review');
assert(source.includes("requestMidnightReview({ source: 'natural'"), 'natural clock gate opens the same shared midnight review');
assert(source.includes("if (cancel) cancel.click()"), 'custom sleep/wait path reuses CalendarSystem Cancel cleanup for private timer/lock release');

console.log('day-progress-review regression tests passed');

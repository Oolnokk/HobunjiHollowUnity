#!/usr/bin/env node
'use strict';

// One gameplay-clock authority, two saved rest tiers, and the real player movement integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // All assertions evaluate the shipped scripts, not duplicate rest rules.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Source loader for isolated browser VMs.
const coreSource = read('docs/js/temple-prayer-rest-blessings.js'); // Existing saved buff and time-passage event authority.
const movementSource = read('docs/js/devotion-rest-buffs.js'); // Existing native combat-speed multiplier wrapper.
const legacySource = read('docs/js/bed-lie-pose.js'); // The older animated bed path also reports actual sleep hours.
assert.match(legacySource, /beforeSleepHour[\s\S]*?deps\.sleep\(\)[\s\S]*?afterSleepHour[\s\S]*?source: 'legacy-bed'/,
  'legacy bed uses actual elapsed hours and dispatches the same sleep-completed event');

let hour = 100; // Continuous represented game hour; test all deadlines and expirations with this clock.
let walkingYawn = 1; // Simulates the player yawn runtime's native movement multiplier.
let seated = false; // Only a real seated Wait can grant Rested.
let restProvider = null; // The game HUD must show separate Rested and Well Rested effects.
const handlers = new Map(); // Registered window handlers used to send actual passage events.
const storage = new Map([['hobunjiSaveMeta', JSON.stringify({ characters: [
  { id: 'farmer-a', templePrayerRestBlessings: {} },
  { id: 'farmer-b', templePrayerRestBlessings: {} },
] })]]); // Character-scoped save records; old saves may omit the new Rested field.
const window = {
  __hobunjiPlayerProfile: { characterId: 'farmer-a' },
  __hobunjiFurnitureDebug: { get sitState() { return seated ? { phase: 'active', furnitureKey: 'chairSimple' } : null; } },
  CalendarSystem: {
    isInitialized: () => true,
    timeDebugSnapshot: () => ({ rawDay: Math.floor(hour / 24), time01: (hour % 24) / 24 }),
    currentWeekdayName: () => 'Uung',
  },
  EffectBuffBar: {
    registerProvider: (_id, provider) => { restProvider = provider; },
    refresh() {},
  },
  Combat: { getMovementSpeedMul: () => .8 },
  NpcYawnRest: { playerMovementMultiplier: () => walkingYawn },
  addEventListener: (name, handler) => handlers.set(name, handler),
  setInterval() { return 1; },
};
const context = {
  window,
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  document: { addEventListener() {}, getElementById: () => null },
};
vm.runInNewContext(coreSource, context, { filename: 'temple-prayer-rest-blessings.js' });
const rest = window.TemplePrayerRestBlessings;
assert.equal(rest.version, 4);
const send = (kind, hours, extra = {}) => {
  const handler = handlers.get('hobunji-time-passage'); // Production CalendarSystem and legacy BedLiePose both emit this event.
  assert.equal(typeof handler, 'function');
  handler({ detail: { kind, hours, ...extra } });
};
const entries = () => restProvider?.() || []; // Reads the game buff provider rather than hand-built test badges.
const buff = name => entries().find(item => item.id === name); // Looks up a named effect without relying on HUD ordering.

assert.equal(rest.isRested(), false, 'new or legacy saves begin without either rest tier');
assert.equal(rest.isWellRested(), false);
assert.equal(typeof restProvider, 'function', 'Rested is exposed to the existing EffectBuffBar across Node VM realms');
send('wait', 1);
assert.equal(rest.isRested(), false, 'waiting without a chair provides no rest buff');
send('dev', 10);
assert.equal(rest.isRested(), false, 'developer time skips are not a substitute for sleeping');
seated = true;
send('wait', 0);
assert.equal(rest.isRested(), false, 'cancelled seated Wait cannot grant a buff');
send('wait', 1);
assert.equal(rest.isRested(), true, 'one hour of seated Wait grants Rested');
assert.equal(rest.isWellRested(), false, 'a chair never grants Well Rested');
assert.equal(buff('rested')?.label, 'Rested', 'the weaker buff has its own label and icon');
assert.equal(buff('rested')?.durationS, 3 * 3600, 'Rested occupies a real three-hour HUD countdown');
assert.equal(buff('well-rested'), undefined);
assert.equal(rest.movementSpeedMultiplier(), 1, 'Rested does not copy Well Rested speed bonuses');
assert.equal(JSON.parse(storage.get('hobunjiSaveMeta')).characters[0].templePrayerRestBlessings.rested.expiresAtGameHour, 103);
hour = 102.95;
assert.equal(rest.isRested(), true);
hour = 103.01;
assert.equal(rest.isRested(), false, 'Rested expires after exactly three represented hours');

seated = false;
send('sleep', 1);
assert.equal(rest.isRested(), true, 'any positive amount of sleep, even without a bed-owned token, grants Rested');
assert.equal(rest.isWellRested(), false, 'one hour is not enough for Well Rested');
hour = 108;
window.__hobunjiOwnedBedSleepPending = { source: 'player-bed' };
send('sleep', 7);
assert.equal(window.__hobunjiOwnedBedSleepPending, null, 'a real bed sleep token is consumed exactly once');
assert.equal(rest.isWellRested(), false, 'seven hours of bed sleep remains too short for Well Rested');
send('sleep', 8); // This generic unowned sleep cannot exploit the previous consumed bed token.
assert.equal(rest.isWellRested(), false, 'generic eight-hour sleep does not counterfeit a player-owned bed');
window.__hobunjiOwnedBedSleepPending = { source: 'player-bed' };
send('sleep', 7.999);
assert.equal(rest.isWellRested(), false, 'genuinely short sleep must not cross the eight-hour threshold');
window.__hobunjiOwnedBedSleepPending = { source: 'player-bed' };
send('sleep', 8 - 1e-10); // Exactly eight hours may round slightly below 8 when raw time01 crosses the dawn boundary.
assert.equal(rest.isWellRested(), true, 'calendar floating-point error must not deprive an exact eight-hour sleeper');
hour += .01;
window.__hobunjiOwnedBedSleepPending = { source: 'player-bed' };
send('sleep', 8);
assert.equal(rest.isWellRested(), true, 'eight completed hours from the real bed grants Well Rested');
assert.equal(rest.isRested(), true);
assert.equal(rest.movementSpeedMultiplier(), 1.08, 'existing Well Rested speed bonus is preserved');
assert.equal(buff('rested')?.durationS, 3 * 3600);
assert.equal(buff('well-rested')?.durationS, 16 * 3600);
assert.equal(buff('well-rested')?.label, 'Well Rested');
assert.equal(buff('well-rested')?.remainingS, 16 * 3600);

vm.runInNewContext(movementSource, context, { filename: 'devotion-rest-buffs.js' });
assert.equal(window.DevotionRestBuffs.version, 6);
walkingYawn = .25;
assert.ok(Math.abs(window.Combat.getMovementSpeedMul() - .8 * 1.08 * .25) < 1e-9,
  'the actual player movement hook composes 75% yawn slowdown and Well Rested speed without doubling or overwriting either');
walkingYawn = 1;
assert.ok(Math.abs(window.Combat.getMovementSpeedMul() - .8 * 1.08) < 1e-9);

hour = 111.1;
assert.equal(buff('rested'), undefined, 'three-hour Rested badge expires independently');
assert.equal(rest.isRested(), true, 'active Well Rested still blocks yawning after Rested expires');
hour = 124.1;
assert.equal(rest.isWellRested(), false, 'Well Rested expires after 16 actual game hours');
assert.equal(rest.isRested(), false);
assert.ok(Math.abs(window.Combat.getMovementSpeedMul() - .8) < 1e-9, 'full movement speed returns after yawning and Well Rested expire');

send('sleep', 0, { source: 'legacy-bed' });
assert.equal(rest.isRested(), false, 'zero-hour legacy sleep never grants Rested');
send('sleep', 2, { source: 'legacy-bed' });
assert.equal(rest.isRested(), true, 'legacy animated beds also grant three-hour Rested');
assert.equal(rest.isWellRested(), false);
hour = 127.5;
send('sleep', 8, { source: 'legacy-bed' });
assert.equal(rest.isWellRested(), true, 'legacy beds require the same eight hours for Well Rested');
assert.equal(rest.isRested(), true);

window.__hobunjiPlayerProfile.characterId = 'farmer-b';
assert.equal(rest.isRested(), false, 'Rested does not leak to another selected character');
assert.equal(rest.isWellRested(), false, 'Well Rested does not leak to another selected character');
window.__hobunjiPlayerProfile.characterId = 'farmer-a';
assert.equal(rest.isWellRested(), true, 'Well Rested restores from the original character save');
assert.equal(rest.isRested(), true, 'Rested restores from the original character save');

console.log('Rested/Well Rested: any Sleep, seated Wait, 8h bed threshold, HUD, save, legacy and native player slowdown OK');

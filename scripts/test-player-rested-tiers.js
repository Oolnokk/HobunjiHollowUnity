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

assert.equal(rest.previewTimePassageRest('wait', 1)?.label, 'Rested', 'one-hour Wait previews Rested');
assert.equal(rest.previewTimePassageRest('wait', 16)?.durationHours, 3, 'seated Wait always previews three hours of Rested');
assert.match(rest.previewTimePassageRest('sleep', 1)?.description || '', /yawns/, 'short Sleep describes Rested');
assert.equal(rest.previewTimePassageRest('sleep', 8)?.label, 'Rested', 'unowned Sleep never promises bed-exclusive Well Rested');
window.__hobunjiOwnedBedSleepPending = { source: 'player-bed' };
assert.equal(rest.previewTimePassageRest('sleep', 7)?.label, 'Rested', 'seven hours in bed still previews Rested');
assert.equal(rest.previewTimePassageRest('sleep', 8)?.label, 'Well Rested', 'eight hours in bed previews Well Rested');
assert.equal(rest.previewTimePassageRest('sleep', 16)?.durationHours, 24, 'longer sleep does not extend the Well Rested duration');
assert.match(rest.previewTimePassageRest('sleep', 8)?.previewDescription || '', /\+8% movement speed.*\+30% stamina recovery/, 'compact preview explains actual stat bonuses');
assert.equal(rest.previewTimePassageRest('wait', 16)?.label, 'Rested', 'seated Wait never upgrades to Well Rested');
assert.equal(window.__hobunjiOwnedBedSleepPending?.source, 'player-bed', 'preview must not consume the pending bed token');
window.__hobunjiOwnedBedSleepPending = null;
assert.equal(rest.previewTimePassageRest('sleep', 0), null, 'zero-hour sleep grants no preview');
assert.equal(rest.previewTimePassageRest('dev', 8), null, 'dev time skip grants no rest preview');

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
// Modern gameplay takes the same clock origin directly. No calendar debug
// formatting should happen for stat reads, buffs or expiration checks.
window.CalendarSystem.getRawClock = () => ({rawDay:Math.floor(hour/24),time01:(hour%24)/24});
window.CalendarSystem.timeDebugSnapshot = () => ({seatedWaitReady:false});
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
assert.equal(buff('well-rested')?.durationS, 24 * 3600);
assert.equal(buff('well-rested')?.label, 'Well Rested');
assert.ok(Math.abs(buff('well-rested')?.remainingS - 24 * 3600) < 1e-6,
  'Well Rested HUD shows a full 24h countdown, within game-clock floating-point precision');

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
const wellRestedExpiresAt = JSON.parse(storage.get('hobunjiSaveMeta')).characters[0].templePrayerRestBlessings.wellRested.expiresAtGameHour; // Checks exact expiry against the persisted continuous game-hour deadline.
assert.ok(Math.abs(wellRestedExpiresAt - (108.01 + 24)) < 1e-9, 'Well Rested persists for a full game day after waking');
hour = wellRestedExpiresAt - .01;
assert.equal(rest.isWellRested(), true, 'Well Rested remains active immediately before the 24-hour boundary');
hour = wellRestedExpiresAt;
assert.equal(rest.isWellRested(), false, 'Well Rested expires at exactly 24 elapsed game hours');
assert.equal(rest.isRested(), false);
assert.ok(Math.abs(window.Combat.getMovementSpeedMul() - .8) < 1e-9, 'full movement speed returns after yawning and Well Rested expire');

send('sleep', 0, { source: 'legacy-bed' });
assert.equal(rest.isRested(), false, 'zero-hour legacy sleep never grants Rested');
send('sleep', 2, { source: 'legacy-bed' });
assert.equal(rest.isRested(), true, 'legacy animated beds also grant three-hour Rested');
assert.equal(rest.isWellRested(), false);
hour = wellRestedExpiresAt + 3.5;
send('sleep', 8, { source: 'legacy-bed' });
assert.equal(rest.isWellRested(), true, 'legacy beds require the same eight hours for Well Rested');
assert.equal(rest.isRested(), true);

window.__hobunjiPlayerProfile.characterId = 'farmer-b';
assert.equal(rest.isRested(), false, 'Rested does not leak to another selected character');
assert.equal(rest.isWellRested(), false, 'Well Rested does not leak to another selected character');
window.__hobunjiPlayerProfile.characterId = 'farmer-a';
assert.equal(rest.isWellRested(), true, 'Well Rested restores from the original character save');
assert.equal(rest.isRested(), true, 'Rested restores from the original character save');

const calendarSource = read('docs/js/calendar-system.js'); // Verifies the real calendar selector uses the new compact buff preview in the requested position.
const hoursMarkupIndex = calendarSource.indexOf('id="timePassageHours"'); // Checks visual order of hours, benefits and slider in the actual modal markup.
const benefitMarkupIndex = calendarSource.indexOf('id="timePassageBenefit"'); // Checks the shared modal contains one benefits group.
const sliderMarkupIndex = calendarSource.indexOf('id="timePassageSlider"'); // Ensures the benefit group precedes the selector.
assert(hoursMarkupIndex > 0 && hoursMarkupIndex < benefitMarkupIndex && benefitMarkupIndex < sliderMarkupIndex, 'benefit appears directly after hours and before the slider');
assert.match(calendarSource, /transitioning \.time-passage-benefit\{display:none\}/, 'rest benefit disappears during the darkened passage countdown');
function selectorFunction(name) {
  const start = calendarSource.indexOf(`  function ${name}(`); // Extracts the actual shipped selector code for a VM behavior test.
  const end = calendarSource.indexOf('\n  function ', start + 1); // The following function closes the current top-level calendar helper.
  assert(start >= 0 && end > start, `calendar selector helper ${name} is present`);
  return calendarSource.slice(start, end);
}
const display = { hours: { textContent: '' }, benefitName: { textContent: '' }, benefitDescription: { textContent: '' }, slider: { value: '' }, confirm: { textContent: '' } }; // Minimal DOM-like nodes updated by the calendar helper without opening a real game window.
const selectorContext = { window, _selectedPassageHours: 1, _timePassageKind: 'wait', _timePassageUi: display, MAX_PASSAGE_HOURS: 16, refreshTimePassagePreview() {} }; // The selector's real update path is exercised against the genuine rest authority.
vm.runInNewContext(`${selectorFunction('updateTimePassageBenefitPreview')}\n${selectorFunction('setSelectedPassageHours')}\nglobalThis.chooseHours = setSelectedPassageHours;`, selectorContext);
selectorContext.chooseHours(16);
assert.match(display.benefitName.textContent, /^Rested · Lasts 3 in-game hours$/, 'Wait stays Rested even at maximum hours');
assert.equal(display.benefitDescription.textContent, rest.previewTimePassageRest('wait', 16).previewDescription, 'selector uses the authoritative compact description');
window.__hobunjiOwnedBedSleepPending = { source: 'player-bed' };
selectorContext._timePassageKind = 'sleep';
selectorContext.chooseHours(7);
assert.match(display.benefitName.textContent, /^Rested/, 'seven bed-sleep hours still select Rested');
selectorContext.chooseHours(8);
assert.match(display.benefitName.textContent, /^Well Rested · Lasts 24 in-game hours$/, 'eight bed-sleep hours update the visible tier and duration');
assert.match(display.benefitDescription.textContent, /\+8% movement speed/, 'the on-screen description includes the real movement bonus');
selectorContext._timePassageKind = 'wait';
selectorContext.chooseHours(8);
assert.match(display.benefitName.textContent, /^Rested/, 'switching back to a seat removes the full-rest preview');
window.__hobunjiOwnedBedSleepPending = null;

console.log('Rested/Well Rested: time passage UI order, compact descriptions, hour selection, seated Wait, 8h bed threshold, HUD, save and movement OK');
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/npc-social-inhibition-runtime.js', 'utf8');
let drunkFraction = 0;

const windowObject = {
  SCRATCHBONES_CONFIG: { game: { socialActions: {} } },
  NpcAgenda: { dailySeed: () => 0.8 },
  HobunjiDrunkGameplayBridge: {
    npcDrunkFraction: () => drunkFraction,
    isNpcBlackedOut: () => false,
  },
  CalendarSystem: { getHour: () => 12 },
  NpcSocialStimuli: { getActive: () => [] },
  setInterval: () => 0,
  performance: { now: () => 0 },
};
windowObject.window = windowObject;

vm.runInNewContext(source, windowObject, { filename: 'npc-social-inhibition-runtime.js' });
const api = windowObject.NpcSocialInhibition;
assert(api?.installed, 'social inhibition runtime must install');

// Balance is authored per character. There must be no runtime gender shortcut.
assert(!/rec\?\.(?:gender|sex)|rec\.(?:gender|sex)/.test(source), 'dance inhibition must not be gated by NPC gender');
assert.strictEqual(api.baseOverrides.pahu, 12, 'Pahu remains exceptionally uninhibited');
assert.strictEqual(api.baseOverrides.foroji_funji, 68, 'Foroji is no longer nearly guaranteed to dance sober');
assert.strictEqual(api.baseOverrides.furunji_funji, 74, 'Furunji has a restrained adult baseline');
assert.strictEqual(api.baseOverrides.oddclaw_unumanuk, 66, 'Oddclaw stays playful without being an automatic sober dancer');

// The high-inhibition curve applies only to dance acceptance, not to the raw
// inhibition value reused by drink offers and other social systems.
assert.strictEqual(api.danceThresholdFor(12), 12);
assert.strictEqual(api.danceThresholdFor(30), 30);
assert.strictEqual(api.danceThresholdFor(40), 50);
assert.strictEqual(api.danceThresholdFor(50), 70);
assert.strictEqual(api.danceThresholdFor(60), 90);
assert.strictEqual(api.danceThresholdFor(80), 99);

const walker = {
  area: 'map_hobunji_town',
  root: { position: { x: 0, z: 0 } },
  currentScheduleTarget: null,
};
const leisure = { activity: 'rest', obligation: 'leisure' };
const danceContext = id => ({
  stimulus: { id, type: 'dance', sourceIsPlayer: false, x: 0, z: 0 },
  distance: 1,
  proximity: 1,
});

const foroji = {
  id: 'foroji_funji',
  name: 'Foroji Funji',
  personality: { musicalInterest: 0.5, sociability: 0.5, shyness: 0.3 },
};
drunkFraction = 0;
const soberForoji = api.evaluate(foroji, walker, danceContext('foroji-sober'), leisure);
assert.strictEqual(soberForoji.dance, false, 'Foroji should refuse the deterministic sober dance case');
assert.strictEqual(soberForoji.effectiveInhibition, 65, 'raw inhibition stays moderate enough for non-dance social checks');
assert.strictEqual(soberForoji.danceThreshold, 99, 'dance-only threshold makes the same sober state extremely reluctant');

// Alcohol uses the pre-existing smooth inhibition interpolation: no hard-coded
// drunk requirement, but enough drunkenness naturally crosses the dance curve.
drunkFraction = 0.5;
const drunkForoji = api.evaluate(foroji, walker, danceContext('foroji-drunk'), leisure);
assert.strictEqual(drunkForoji.dance, true, 'Foroji should join this deterministic dance once sufficiently drunk');
assert.strictEqual(drunkForoji.effectiveInhibition, 31.5);
assert.strictEqual(drunkForoji.danceThreshold, 33);
assert(drunkForoji.danceThreshold < soberForoji.danceThreshold, 'drunkenness must substantially lower dance reluctance');

const pahu = {
  id: 'pahu',
  name: 'Pahu',
  personality: { musicalInterest: 0.5, sociability: 0.5, shyness: 0.3 },
};
drunkFraction = 0;
const soberPahu = api.evaluate(pahu, walker, danceContext('pahu-sober'), leisure);
assert.strictEqual(soberPahu.dance, true, 'Pahu should remain an easy sober dancer');
assert.strictEqual(soberPahu.danceThreshold, 9);

// Crowd enthusiasm still helps, but the source must not restore the old
// runaway -8-per-dancer / -24 cap cascade.
assert(source.includes('Math.min(9, counts.dancers * 3)'), 'other-dancer bonus must use the rebalanced small cascade');
assert(!source.includes('Math.min(24, counts.dancers * 8)'), 'old dance cascade must stay removed');
assert(source.includes("const pull = -8 * clamp01(stimulus.strength ?? 0.8)"), 'music pull must use the reduced value');
assert(source.includes("modifiers.push({ key: 'someone-else-dancing', amount: -3 })"), 'direct dance stimulus must use the reduced pull');

windowObject.SCRATCHBONES_CONFIG.game.socialActions.danceHighInhibitionPivot = 50;
windowObject.SCRATCHBONES_CONFIG.game.socialActions.danceHighInhibitionMultiplier = 1.5;
assert.strictEqual(api.danceThresholdFor(60), 65, 'dance threshold curve remains centrally tunable');

console.log('npc social inhibition balance tests passed');

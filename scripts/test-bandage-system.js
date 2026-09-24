#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/bandage-system.js'), 'utf8');
let now = 0; // Drives both the scheduler timestamp and performance.now() for deterministic curve checks.
let lastLock = null; // Captures the active action lock so completion/cancellation release can be asserted.
const listeners = new Map(); // Minimal window event bus for resource-change cancellation.
const player = {
  health:1,
  maxHealth:100,
  lastAttackReceivedAt:-1,
  afflictions:{ windedStamina:10, bleedingHealth:10, drunkenHealth:10, drunkenFooting:10 },
}; // Player fixture used by all curve/cancel/cleanse checks.
const timers = new Map(); // Deterministic timeout queue for start-to-loop and loop-to-loop overlap checks.
let nextTimerId = 1; // Generates stable timeout handles for clearTimeout assertions.
const sfxCalls = []; // Records semantic combat-SFX keys requested by BandageSystem.
const sfxVoices = []; // Retains fake voices so completion/cancellation can be checked for immediate stop.
function fakeSetTimeout(callback, delay) {
  const id = nextTimerId++;
  timers.set(id, { callback, delay });
  return id;
}
function fakeClearTimeout(id) { timers.delete(id); }
function runNextTimer() {
  const entry = [...timers.entries()].sort((a, b) => a[0] - b[0])[0];
  assert(entry, 'expected a pending bandage-audio timer');
  const [id, timer] = entry;
  timers.delete(id);
  now += timer.delay;
  timer.callback();
  return timer.delay;
}
class FakeAudioVoice {
  constructor(key, duration) {
    this.key = key;
    this.duration = duration;
    this.playbackRate = 1;
    this.currentTime = 0;
    this.paused = false;
  }
  pause() { this.paused = true; }
  addEventListener() {}
}

const window = {
  Combat:{ deps:{ player } },
  ResourceSystem:{
    AFFLICTIONS:{
      windedStamina:{ priority:95, resource:'stamina' },
      bleedingHealth:{ priority:70, resource:'health' },
      drunkenHealth:{ priority:40, resource:'health', tags:['alcohol'] },
      drunkenFooting:{ priority:100, resource:'footing', tags:['alcohol'] },
    },
    getEffectiveMax:entity => entity.maxHealth,
    getAffliction(entity, id) { return Number(entity.afflictions?.[id]) || 0; },
    removeAffliction(entity, id, amount) {
      const before = Number(entity.afflictions?.[id]) || 0;
      const after = Math.round(Math.max(0, before - Math.max(0, Number(amount) || 0)) * 10) / 10;
      entity.afflictions[id] = after;
      return Math.round((before - after) * 10) / 10;
    },
    enforceCaps(entity) { entity.health = Math.max(0, Math.min(entity.maxHealth, entity.health)); },
  },
  AudioSystem:{
    combatSfxConfig() {
      return {
        bandageStart:{ volume:1, gainBoost:2 },
        bandageLoop:{ volume:1, overlapMs:120 },
      };
    },
    playCombatSfxKey(key) {
      sfxCalls.push(key);
      const voice = new FakeAudioVoice(key, key === 'bandageStart' ? 0.8 : 1.0);
      sfxVoices.push(voice);
      return voice;
    },
  },
  CharacterActionLocks:{
    acquire(options) {
      let released = false;
      lastLock = { options, get released() { return released; } };
      return { release() { released = true; } };
    },
  },
  RuntimeFrameScheduler:{
    register() { assert.fail('Healing must be owned by gameLoop, not a browser-frame subscriber'); },
    frameId:() => Math.floor(now / 16),
  },
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  },
  dispatchEvent(event) {
    for (const listener of listeners.get(event.type) || []) listener(event);
  },
};
class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}
const context = { window, performance:{ now:() => now }, CustomEvent, Math, Number, String, Date, console, setTimeout:fakeSetTimeout, clearTimeout:fakeClearTimeout, Set };
vm.createContext(context);
vm.runInContext(source, context, { filename:'bandage-system.js' });

const bandage = window.BandageSystem;
assert(bandage?.installed, 'bandage system installs');
assert.equal(typeof bandage.update, 'function', 'gameLoop owns the healing update');
assert(Math.abs(bandage.sampleCurve(4000, 0.01) - 0.20) < 1e-9,
  '1% health must reach exactly 20% at four seconds');
assert(Math.abs(bandage.sampleCurve(8000, 0.01) - 1) < 1e-9,
  '1% health must reach exactly 100% at eight seconds');

assert.strictEqual(bandage.start({ source:'test' }), true, 'bandaging starts below full health');
assert.strictEqual(Array.from(lastLock.options.participants[0].channels).join(','), 'tools,actions',
  'bandaging blocks attacks/tools while leaving movement available');
assert.deepStrictEqual(sfxCalls, ['bandageStart'], 'bandaging begins with the authored start cue');
assert.strictEqual(window.BandageSystem.debugSnapshot().audio.overlapMs, 120, 'bandage loop overlap is exposed as the authored 120 ms lead');
assert.strictEqual(runNextTimer(), 680, 'first loop starts 120 ms before the 0.8 s start cue ends');
assert.deepStrictEqual(sfxCalls, ['bandageStart', 'bandageLoop'], 'start cue hands off into the looping cue');
assert.strictEqual(runNextTimer(), 880, 'subsequent 1.0 s loop passes overlap by 120 ms');
assert.deepStrictEqual(sfxCalls, ['bandageStart', 'bandageLoop', 'bandageLoop'], 'loop cue retriggers as an overlapping one-shot rather than a hard HTML loop');

now = 4000;
bandage.update(4, false);
assert.strictEqual(player.health, 20, 'live heal reaches 20 health at four seconds from 1/100');
assert.strictEqual(player.afflictions.windedStamina, 6.2, 'bandaging removes affliction buildup at exactly one fifth of the 19 Health healed so far');
assert.strictEqual(player.afflictions.drunkenHealth, 10, 'bandaging never removes Drunken Health');
assert.strictEqual(player.afflictions.drunkenFooting, 10, 'bandaging never removes Drunken Footing');
assert.strictEqual(bandage.active, true, 'bandaging remains active at midpoint');

now = 8000;
bandage.update(4, false);
assert.strictEqual(player.health, 100, 'live heal reaches full health at eight seconds');
assert.strictEqual(player.afflictions.windedStamina, 0, 'higher-priority ordinary affliction is cleansed first');
assert.strictEqual(player.afflictions.bleedingHealth, 0.2, 'total ordinary affliction cleanse equals 19.8, exactly one fifth of 99 Health healed');
assert.strictEqual(player.afflictions.drunkenHealth, 10, 'Drunken Health remains untouched after the full bandage');
assert.strictEqual(player.afflictions.drunkenFooting, 10, 'Drunken Footing remains untouched after the full bandage');
assert.strictEqual(bandage.debugSnapshot().afflictionCleanse.ratio, 0.2, 'diagnostics expose the authored one-fifth cleanse ratio');
assert.strictEqual(bandage.debugSnapshot().afflictionCleanse.totalRemoved, 19.8, 'diagnostics expose the amount of ordinary affliction buildup removed');
assert.strictEqual(bandage.active, false, 'bandaging completes at full health');
assert.strictEqual(lastLock.released, true, 'completion releases action ownership');
assert.strictEqual(timers.size, 0, 'completion clears the pending loop retrigger');
assert(sfxVoices.every(voice => voice.paused), 'completion stops every still-audible overlapping bandage voice');

player.health = 40;
player.lastAttackReceivedAt = 9000;
now = 10000;
assert.strictEqual(bandage.start({ source:'test-hit' }), true, 'bandaging can start again after completion');
window.dispatchEvent(new CustomEvent('hobunji-resource-change', {
  detail:{ entity:player, delta:-5, reason:'bandit-hit', immediate:true },
}));
assert.strictEqual(bandage.active, false, 'an immediate player hit cancels bandaging');
assert.strictEqual(lastLock.released, true, 'hit cancellation releases action ownership immediately');
assert.strictEqual(timers.size, 0, 'hit cancellation clears the pending bandage loop retrigger');
assert(sfxVoices.slice(-1).every(voice => voice.paused), 'hit cancellation stops the current bandage audio immediately');

player.health = 100;
player.afflictions.windedStamina = 0;
player.afflictions.bleedingHealth = 0;
assert.strictEqual(bandage.start({ source:'full-alcohol-only' }), false, 'full health still refuses bandaging when only excluded alcohol afflictions remain');
assert.strictEqual(player.afflictions.drunkenHealth, 10, 'Drunken Health alone cannot make a full-Health bandage eligible');
assert.strictEqual(player.afflictions.drunkenFooting, 10, 'Drunken Footing alone cannot make a full-Health bandage eligible');

player.afflictions.bleedingHealth = 10;
assert.strictEqual(bandage.start({ source:'full-cleanse' }), true, 'full health can bandage when an eligible affliction is active');
assert.strictEqual(bandage.debugSnapshot().afflictionCleanse.cleanseOnly, true, 'diagnostics identify full-Health cleanse-only bandaging');
now += 4000;
bandage.update(4, false);
assert.strictEqual(player.health, 100, 'cleanse-only bandaging never changes already-full Health');
assert.strictEqual(player.afflictions.bleedingHealth, 6.2, 'full-Health bandaging applies one-fifth cleanse against the same midpoint heal curve');
assert.strictEqual(player.afflictions.drunkenHealth, 10, 'full-Health cleansing still excludes Drunken Health');
assert.strictEqual(player.afflictions.drunkenFooting, 10, 'full-Health cleansing still excludes Drunken Footing');
assert.strictEqual(bandage.active, true, 'cleanse-only bandaging remains active while eligible buildup remains');
now += 4000;
bandage.update(4, false);
assert.strictEqual(player.afflictions.bleedingHealth, 0, 'full-Health bandaging can finish clearing ordinary buildup');
assert.strictEqual(bandage.active, false, 'cleanse-only bandaging completes when no eligible buildup remains');
assert.strictEqual(lastLock.released, true, 'cleanse-only completion releases action ownership');

player.health = 1;
assert.equal(bandage.start(), true);
bandage.update(4, false);
assert.equal(player.health, 20);
now += 60000;
bandage.update(60, true);
assert.equal(player.health, 20, 'paused gameplay never advances healing');
assert.equal(bandage.debugSnapshot().elapsedMs, 4000, 'diagnostics report gameplay time only');
assert.equal(bandage.debugSnapshot().paused, true);
assert.equal(timers.size, 0, 'pause stops audio scheduling');
assert(sfxVoices.every(voice => voice.paused), 'pause silences all active bandage voices');
bandage.update(0, false);
assert.equal(player.health, 20, 'resume does not catch up elapsed wall-clock time');
assert.equal(sfxCalls.at(-1), 'bandageLoop', 'resume restarts the loop without replaying the start cue');
for (const invalidDelta of [NaN, Infinity, -1]) bandage.update(invalidDelta, false); // Malformed game deltas must not alter the heal curve.
assert.equal(bandage.debugSnapshot().elapsedMs, 4000);
bandage.update(4, false);
assert.equal(player.health, 100, 'four more active seconds completes the original eight-second heal');
assert.equal(lastLock.released, true);
assert.equal(timers.size, 0);

console.log('Bandage system curve, affliction cleanse/full-Health cleanse, pause/resume, audio, and cancellation tests passed.');

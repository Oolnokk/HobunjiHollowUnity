const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'combat-vocalizations.js'), 'utf8');
const animalPlaybackSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'animal-voice-independent-playback.js'), 'utf8');
const voiceOwnerSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'character-voice-owner.js'), 'utf8');
const banditSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'combat-bandit.js'), 'utf8');
let now = 0;
let scheduledBreath = null;
let stagedSpec = null;
const played = [];
const listeners = new Map();
const docListeners = new Map();

function addListener(map, type, fn) {
  if (!map.has(type)) map.set(type, []);
  map.get(type).push(fn);
}
function emit(map, type, detail) {
  for (const fn of map.get(type) || []) fn({ type, detail });
}

const player = {
  health: 100, maxHealth: 100,
  stamina: 100, maxStamina: 100,
  exhaustion: { active: false, blackStamina: 100 },
};
let W = null;
const abilities = new Map();
function register(id, def) { abilities.set(id, { ...def, id, label: def.label || id }); }

register('swingCombo', {
  category: 'combo', slotFamily: 'tap',
  onTap() {
    W.Combat.beginStagedAction({
      windupS: 0.2, strikeS: 0.1,
      onStrike() { W.__comboStrike = (W.__comboStrike || 0) + 1; },
    });
  },
});
register('opportunistJab', {
  category: 'quickAttack', slotFamily: 'tap',
  onTap() {
    W.Combat.beginStagedAction({
      windupS: 0.07, strikeS: 0.1,
      onStrike() { W.__quickStrike = (W.__quickStrike || 0) + 1; },
    });
  },
});
register('chargedBreaker', {
  category: 'offensiveHold', slotFamily: 'hold',
  onHoldStart() {},
  onHoldEnd() {
    W.Combat.beginStagedAction({
      windupS: 0.3, strikeS: 0,
      onStrike() { W.__heldStrike = (W.__heldStrike || 0) + 1; },
    });
  },
  onHoldCancel() {},
});

const context = {
  console,
  setTimeout, clearTimeout,
  Math: Object.create(Math),
  performance: { now: () => now },
  Promise,
  JSON,
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  Audio: function Audio() {},
  fetch: async url => {
    if (String(url).includes('combat-vocalizations.json')) return { ok: false, status: 404, json: async () => null };
    throw new Error('audio fetch disabled in harness');
  },
};
context.Math.random = () => 0.99;
context.window = context;
W = context;
context.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
context.window.addEventListener = (type, fn) => addListener(listeners, type, fn);
context.window.dispatchEvent = event => emit(listeners, event.type, event.detail);
context.document = {
  addEventListener: (type, fn) => addListener(docListeners, type, fn),
};
context.window.AnimalVoiceIndependentPlayback = {
  playIndependent(url, opts = {}) {
    const entry = { url, ...opts, pitchPreserved: true, stopped: false, fadeOutS: null, handle: null };
    let finished = false;
    const finish = () => { if (finished) return; finished = true; opts.onFinished?.(); };
    const handle = {
      stop(fadeOutS = 0) { entry.stopped = true; entry.fadeOutS = fadeOutS; finish(); },
      finish,
    };
    entry.handle = handle;
    played.push(entry);
    return handle;
  },
};
context.window.AudioSystem = {
  gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }),
  creatureAudioSpatial: entity => ({ panX: entity === player ? 0 : 0.5, extraWetBoost: entity === player ? 0 : 0.2, distance: entity === player ? 0 : 100 }),
  playOneShotSfx(cfg, volumeScale, pitch) {
    played.push({ url: cfg.url, volumeScale, pitch });
    return { url: cfg.url };
  },
};
context.window.RuntimeFrameScheduler = {
  register(id, fn) {
    if (id === 'combat-vocalizations-breath') scheduledBreath = fn;
    return () => {};
  },
};
context.window.Combat = {
  deps: { player },
  chargedBreakerData: { MAX_CHARGE_S: 4 },
  abilities: {
    register,
    unregister: id => abilities.delete(id),
    get: id => abilities.get(id) || null,
    listForFamily: family => [...abilities.values()].filter(def => def.slotFamily === family),
  },
  beginStagedAction(spec) {
    stagedSpec = spec;
    return { spec };
  },
};

vm.createContext(context);
vm.runInContext(voiceOwnerSource, context, { filename: 'character-voice-owner.js' });
vm.runInContext(source, context, { filename: 'combat-vocalizations.js' });

assert(context.window.CombatVocalizations, 'runtime API should install');
assert.equal(context.window.CombatVocalizations.version, 4);
assert.equal(typeof scheduledBreath, 'function', 'breath loop should use shared scheduler');

const chargePlan = context.window.CombatVocalizations.chargeRatePlan(1.2, 4, 1.25);
assert(Math.abs(chargePlan.stretchedTempo - 0.3) < 1e-9, 'full charge stretch must be based on clip/target duration, independent of normal voice tempo');
assert(Math.abs((1.2 / chargePlan.stretchedTempo) - 4) < 1e-9, 'full charge vocal must still span exactly 4 seconds when normal voice tempo is not 1x');
assert(Math.abs(chargePlan.catchUpTempo - 2.5) < 1e-9, 'early release must switch to 2x NORMAL tempo, not 2x stretched tempo');
assert(Math.abs(chargePlan.catchUpTempo - chargePlan.stretchedTempo * 2) > 1, 'catch-up tempo must be independent of the stretched tempo');
assert.equal(chargePlan.earlyReleaseNormalSpeedMul, 2);
assert.match(animalPlaybackSource, /renderDecodedIndependentBuffer/, 'combat should reuse the animal-call independent tempo/pitch renderer');
assert.match(animalPlaybackSource, /GENERIC_MAX_SHIFT_SEMITONES = 24/, 'combat may use +14 semitone profiles without raising the animal-call +/-12 ceiling');
assert.match(animalPlaybackSource, /function trimDecodedSilence/, 'shared pitch-preserving playback trims decoded leading/trailing silence before combat timing');
assert.match(animalPlaybackSource, /extraWetBase/, 'generic combat one-shots route through the environmental reverb send without inheriting animal-only extra wetness');
assert.match(source, /__combatVocalWet = window\.EnvironmentalReverb\?\.connectWetNode/, 'custom charge playback also sends into the current environmental reverb space');
assert.match(animalPlaybackSource, /function stop\(fadeOutS = 0\)/, 'shared processed voice handles must support click-safe fade stops');
assert.match(banditSource, /voiceCategory: 'combo'/, 'NPC combo attacks must carry semantic vocal metadata');
assert.match(banditSource, /voiceCategory: 'quickAttack'/, 'NPC quick attacks must carry semantic vocal metadata');
assert.match(banditSource, /voiceCategory: 'offensiveHold'/, 'NPC charged attacks must carry semantic vocal metadata');
assert.match(source, /chargeRatePlan\(audibleBuffer\.duration/, 'charge duration math uses the silence-trimmed audible buffer');
assert.equal(context.window.CombatVocalizations.getConfig().utteranceModulation.species.nuhongan.female.pitchSemitones, 14, 'authored Nuhongan female combat voice keeps its +14 semitone profile');
assert.match(source, /AnimalVoiceIndependentPlayback\?\.playIndependent/, 'combat one-shots should route through the animal-call pitch-preserving player');
assert.equal(context.window.CombatVocalizations.liveChargeTargetDurationS('chargedBreaker'), 4, 'live charge should reuse Charged Breaker MAX_CHARGE_S');
assert.equal(context.window.CombatVocalizations.getConfig().chargeSampler, undefined, 'legacy start/middle/end sampler config should be gone');

// Full stamina fast path: no vocal playback.
now = 1000;
scheduledBreath({ timestamp: now });
assert.equal(played.length, 0, '100% stamina must perform no breath playback');

// Non-exhausted low stamina starts immediately and keeps breathing while stamina stays below max.
context.window.__hobunjiPlayerProfile = { appearance: { speciesId: 'nuhongan', gender: 'female' } };
player.stamina = 10;
const beforeBreathing = played.length;
scheduledBreath({ timestamp: 2000 });
assert.equal(played.length, beforeBreathing + 1, 'dropping below max stamina should start breathing immediately');
scheduledBreath({ timestamp: 4000 });
assert.equal(played.length, beforeBreathing + 2, 'breathing should continue on cadence while stamina remains below max without another stamina event');
assert(played.at(-1).url.includes('heavybreath_medium_intensity3'), 'non-exhausted low stamina should top out at intensity 3');
assert(!played.at(-1).url.includes('intensity4') && !played.at(-1).url.includes('intensity5'));
assert.equal(played.at(-1).pitchPreserved, true, 'breath tempo changes must use independent pitch preservation');
assert.equal(played.at(-1).tempo, 1, 'default vocal tempo remains 1x');
assert(played.at(-1).pitchSemitones > 14 && played.at(-1).pitchSemitones < 14.3, 'breathing receives the same Nuhongan female species pitch shift plus small authored random variation');
assert.equal(played.at(-1).trimSilence, true, 'combat vocals request decoded silence trimming');
assert.equal(played.at(-1).tailPadS, 0, 'combat vocals add no artificial silent tail after trimming');

// Exhausted state can reach intensity 5.
player.exhaustion.active = true;
scheduledBreath({ timestamp: 20000 });
assert(played.at(-1).url.includes('heavybreath_intensity5'), 'exhausted breathing should allow intensity 5');

// Direct damage always vocalizes immediately.
player.health = 70;
const beforeDirect = played.length;
emit(listeners, 'hobunji-resource-change', { entity: player, delta: -30, immediate: true, reason: 'damage' });
assert.equal(played.length, beforeDirect + 1);
assert(played.at(-1).url.includes('sfx_pain_'));

// DoT vocalizations throttle to the authored half-second cadence.
now = 30000;
const beforeDot = played.length;
emit(listeners, 'hobunji-resource-change', { entity: player, delta: -1, immediate: false, reason: 'resource-tick' });
now = 30499;
emit(listeners, 'hobunji-resource-change', { entity: player, delta: -1, immediate: false, reason: 'resource-tick' });
assert.equal(played.length, beforeDot + 1, 'second DoT tick inside half a second must be silent');
now = 30501;
emit(listeners, 'hobunji-resource-change', { entity: player, delta: -1, immediate: false, reason: 'resource-tick' });
assert.equal(played.length, beforeDot + 2, 'DoT pain should repeat after half a second');

// Combo strikes use attackgrunt, quick/held strikes use releasegrunt.
abilities.get('swingCombo').onTap();
assert(stagedSpec, 'wrapped combo should still stage');
const beforeCombo = played.length;
stagedSpec.onStrike();
assert.equal(context.window.__comboStrike, 1, 'original combo strike must still execute');
assert.equal(played.length, beforeCombo + 1);
assert(played.at(-1).url.includes('sfx_attackgrunt_1'));

abilities.get('opportunistJab').onTap();
const beforeQuick = played.length;
stagedSpec.onStrike();
assert.equal(context.window.__quickStrike, 1, 'original quick strike must still execute');
assert.equal(played.length, beforeQuick + 1);
assert(played.at(-1).url.includes('sfx_releasegrunt'));

abilities.get('chargedBreaker').onHoldStart();
abilities.get('chargedBreaker').onHoldEnd();
const beforeHeld = played.length;
stagedSpec.onStrike();
assert.equal(context.window.__heldStrike, 1, 'original held strike must still execute');
assert.equal(played.length, beforeHeld + 1);
assert(played.at(-1).url.includes('sfx_releasegrunt'));


// One owned voice per character: active grunts beat pain and breathing.
const priorityPlayer = context.window.CombatVocalizations.playStrikeGrunt(player, 'combo', 'priority-test');
const activeEntry = played.at(-1);
const beforeSuppressedPain = played.length;
emit(listeners, 'hobunji-resource-change', { entity: player, delta: -3, immediate: true, reason: 'priority-test-hit' });
assert.equal(played.length, beforeSuppressedPain, 'damage vocal must not overlap an active grunt from the same character');
player.stamina = 5;
scheduledBreath({ timestamp: 41000 });
assert.equal(played.length, beforeSuppressedPain, 'breathing must not overlap an active grunt from the same character');
activeEntry.handle.finish();
scheduledBreath({ timestamp: 41150 });
assert.equal(played.length, beforeSuppressedPain + 1, 'suppressed breathing should retry promptly after the active voice releases');
played.at(-1).handle.finish();

// NPCs use the same species/gender modulation, spatial acoustics, damage voice,
// breathing loop, and staged attack grunts as the player.
const npc = {
  id: 'npc-voice-test', name: 'NPC Voice Test', x: 12, y: 7, areaId: 'test-area',
  health: 80, maxHealth: 100, stamina: 35, maxStamina: 100,
  exhaustion: { active: false, blackStamina: 100 },
  rosterRecord: { appearance: { speciesId: 'tletingan', gender: 'female' } },
};
now = 50000;
const beforeNpcPain = played.length;
emit(listeners, 'hobunji-resource-change', { entity: npc, delta: -5, immediate: true, reason: 'npc-hit' });
assert.equal(played.length, beforeNpcPain + 1, 'humanoid NPC direct damage should vocalize');
assert(played.at(-1).pitchSemitones > 7.5, 'NPC pain uses the NPC species/gender pitch profile');
assert.equal(played.at(-1).panX, 0.5, 'NPC voice uses world-position stereo panning');
assert.equal(played.at(-1).extraWetBoost, 0.2, 'NPC voice uses distance-aware environmental wet boost');
assert.equal(played.at(-1).area, 'test-area', 'NPC voice forwards its physical area to reverb');
played.at(-1).handle.finish();

scheduledBreath({ timestamp: 51000 });
assert(played.at(-1).url.includes('heavybreath_'), 'tracked winded NPC should emit heavy breathing');
assert(played.at(-1).pitchSemitones > 7.5, 'NPC breathing uses NPC species/gender pitch');
played.at(-1).handle.finish();

const npcAttackBefore = played.length;
context.window.Combat.beginStagedAction({
  windupS: 0.1, strikeS: 0.05,
  data: { isBandit: true, attacker: npc, voiceCategory: 'combo', voiceAbilityId: 'swingCombo' },
  onStrike() { context.window.__npcStrike = (context.window.__npcStrike || 0) + 1; },
});
stagedSpec.onStrike();
assert.equal(context.window.__npcStrike, 1, 'NPC original staged strike still executes');
assert.equal(played.length, npcAttackBefore + 1, 'NPC staged combo strike should emit the attack grunt');
assert(played.at(-1).url.includes('sfx_attackgrunt_1'));
assert(played.at(-1).pitchSemitones > 7.5, 'NPC attack grunt uses NPC species/gender pitch');

const debug = context.window.CombatVocalizations.debugSnapshot();
assert(debug.wrappedAbilities.some(entry => entry.id === 'swingCombo'));
assert(debug.wrappedAbilities.some(entry => entry.id === 'chargedBreaker'));

console.log('combat vocalizations: ok');

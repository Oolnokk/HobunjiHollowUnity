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
let stagedAction = null; // Advances the actual action retained by the vocal input gate.
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
register('acceleratingFlurry', {
  category: 'offensiveHold', slotFamily: 'hold',
  onHoldStart() {},
  onHoldUpdate() { // Each Flurry strike is its own staged action fired while the hold continues.
    W.Combat.beginStagedAction({ windupS: 0.05, strikeS: 0.085 });
  },
  onHoldEnd() {},
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
let pitchBackendReady = true; // Tests startup context suspension independently of the audio mock's decoded playback.
context.window.AnimalVoiceIndependentPlayback = {
  readyForIndependentPitch: () => pitchBackendReady,
  playIndependent(url, opts = {}) {
    const entry = { url, ...opts, pitchPreserved: true, stopped: false, fadeOutS: null, handle: null };
    let finished = false;
    const finish = () => { if (finished) return; finished = true; opts.onFinished?.(); };
    const handle = {
      independentPitch: true, // Mirrors the decoded WebAudio voice path so the mobile diagnostic can verify the selected backend.
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
  combatAudioSpatial: entity => ({ // Test the real voice engine's behavior when AudioSystem reports a distant, vertically separated NPC.
    panX: entity === player ? 0 : 0.5,
    extraWetBoost: entity === player ? 0 : 0.2,
    distance: entity === player ? 0 : 100,
    gain: entity?.id === 'npc-voice-test' ? 0.25 : 1,
  }),
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
    stagedAction = { spec, totalS:(spec.windupS||0)+(spec.strikeS||0)+(spec.recoverS||0), t:0, phase:'windup' };
    return stagedAction;
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
assert.match(animalPlaybackSource, /function readyForIndependentPitch\(\)/, 'breathing must have a stable readiness gate for Web Audio startup');
assert.match(animalPlaybackSource, /context\.state === 'interrupted'/, 'mobile interrupted AudioContexts also try to resume before breathing');
assert.match(animalPlaybackSource, /primeAudioContext\(true\)/, 'trusted mobile or keyboard gesture must override a resume request left pending by passive breathing');
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
assert(played.at(-1).pitchSemitones > 14 && played.at(-1).pitchSemitones < 14.3, 'breathing retains its subtle variation on top of the Nuhongan female species pitch shift');
assert.equal(context.window.CombatVocalizations.debugSnapshot().lastBreath.independentPitch, true, 'breathing debug records an actual independent pitch handle');
const breathBackendHandle = played.at(-1).handle; // Simulates a decoded renderer switching to a native fallback after the call already returned.
breathBackendHandle.independentPitch = false;
assert.equal(context.window.CombatVocalizations.debugSnapshot().lastBreath.independentPitch, false, 'mobile breath diagnostic reflects asynchronous renderer fallback');
breathBackendHandle.independentPitch = true;
played.at(-1).handle.finish();
pitchBackendReady = false;
const beforeDeferredBreath = played.length; // Simulates the first breath arriving before Android/desktop AudioContext resume settles.
scheduledBreath({ timestamp: 10000 });
assert.equal(played.length, beforeDeferredBreath, 'breathing must not fall back to native unpitched playback during audio unlock');
assert.equal(W.CombatVocalizations.debugSnapshot().lastBreath.reason, 'audio-context-pending');
assert.equal(W.CombatVocalizations.debugSnapshot().lastBreath.suppressed, true);
pitchBackendReady = true;
scheduledBreath({ timestamp: 10100 });
assert.equal(played.length, beforeDeferredBreath + 1, 'breathing retries promptly after the pitch-preserving backend becomes ready');
assert(played.at(-1).pitchSemitones > 14 && played.at(-1).pitchSemitones < 14.3, 'deferred breath retains the same species pitch shift');
played.at(-1).handle.finish();
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
assert(W.CombatVocalizations.debugSnapshot().lastStrike.url.includes('sfx_attackgrunt_1'));
assert(Math.abs(W.CombatVocalizations.debugSnapshot().lastStrike.durationS-0.1)<1e-9);

abilities.get('opportunistJab').onTap();
const beforeQuick = played.length;
stagedSpec.onStrike();
assert.equal(context.window.__quickStrike, 1, 'original quick strike must still execute');
assert(W.CombatVocalizations.debugSnapshot().lastStrike.url.includes('sfx_releasegrunt'));
assert(Math.abs(W.CombatVocalizations.debugSnapshot().lastStrike.durationS-0.1)<1e-9);

abilities.get('chargedBreaker').onHoldStart();
abilities.get('chargedBreaker').onHoldEnd();
const beforeHeld = played.length;
stagedSpec.onStrike();
assert.equal(context.window.__heldStrike, 1, 'original held strike must still execute');
assert(W.CombatVocalizations.debugSnapshot().lastStrike.url.includes('sfx_releasegrunt'));


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
assert.equal(played.at(-1).volume, 0.9 * 0.25, 'distant NPC pain uses 3D attenuation instead of full local volume');
assert(played.at(-1).lowpassHz < 18000, 'far NPC pain loses direct high frequencies');
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
assert(W.CombatVocalizations.debugSnapshot().lastStrike.url.includes('sfx_attackgrunt_1'));
assert.equal(W.CombatVocalizations.debugSnapshot().lastStrike.category,'combo');

const debug = context.window.CombatVocalizations.debugSnapshot();
assert(debug.wrappedAbilities.some(entry => entry.id === 'swingCombo'));
assert(debug.wrappedAbilities.some(entry => entry.id === 'chargedBreaker'));

console.log('combat vocalizations: ok');

player.stamina = player.maxStamina; // Keep the probe focused on NPC playback.
player.exhaustion.active = false;
for (const entry of played) entry.handle?.finish();
context.window.Combat.deps.getCurrentArea = () => 'another-map';
const beforeOffMapBreath = played.length; // An old-map NPC must be removed, not merely silenced for one frame.
scheduledBreath({ timestamp:90000 });
assert.equal(played.length, beforeOffMapBreath, 'off-map NPC does not breathe into the current map');
assert.equal(W.CombatVocalizations.debugSnapshot().trackedNpcBreathers, 0);
context.window.Combat.deps.getCurrentArea = () => npc.areaId;
emit(listeners, 'hobunji-resource-change', {entity:npc,delta:-1,immediate:true});
assert.equal(W.CombatVocalizations.debugSnapshot().trackedNpcBreathers, 1);
W.CombatVocalizations.forgetEntity(npc);
assert.equal(W.CombatVocalizations.debugSnapshot().trackedNpcBreathers, 0, 'despawn releases retained NPC references');
assert.equal(played.at(-1).stopped, true, 'despawn fades the current NPC voice');

// Active visual phases own both voice timing and the queue; the return tail is cosmetic.
emit(docListeners, 'hobunjiPlayerReady');
let visualRemainingS = 1.3; // Includes 0.2s windup, 0.1s strike, 0.7s hold, and 0.3s return.
W.Combat.deps.getWeaponAttackTimeline=()=>({remainingS:visualRemainingS,activeRemainingS:Math.max(0,visualRemainingS-0.3),windupRemainingS:0.2,strikeRemainingS:Math.max(0,visualRemainingS-1.0),holdEndRemainingS:Math.max(0,visualRemainingS-0.3)});
W.AudioSystem.gameAudioConfig=()=>({enabled:false});
abilities.get('swingCombo').onTap();
assert(Math.abs(W.CombatVocalizations.attackStartDelayS()-1)<1e-9,'muted attacks wait through Hold only');
assert(Math.abs(stagedSpec.recoverS-0.7)<1e-9,'staged recovery includes hold but excludes return');
const beforePhase = W.CombatVocalizations.debugSnapshot().lastStrike; // Windup must retain its charge voice until the exact boundary.
stagedSpec.onUpdate({t:0.19});
assert.deepEqual(W.CombatVocalizations.debugSnapshot().lastStrike,beforePhase);
stagedSpec.onUpdate({t:0.2});
assert(Math.abs(W.CombatVocalizations.debugSnapshot().lastStrike.durationS-0.8)<1e-9,'second grunt spans Windup through Strike and the whole hold');
assert.equal(W.CombatVocalizations.debugSnapshot().lastStrike.category,'combo');
stagedSpec.onStrike({t:0.3});
assert(Math.abs(W.CombatVocalizations.debugSnapshot().lastStrike.durationS-0.8)<1e-9,'impact does not restart the release voice');
stagedAction.t=0.99;
visualRemainingS=0.31;
assert(Math.abs(W.CombatVocalizations.attackStartDelayS()-0.01)<1e-9,'queue still waits during the final Hold interval');
stagedAction.t=1;
visualRemainingS=0.3;
assert.equal(W.CombatVocalizations.attackStartDelayS(),0,'tracked action and visual timeline both release the queue before return');
stagedSpec.onComplete(stagedAction);
stagedAction.phase='done';
assert.equal(W.CombatVocalizations.attackStartDelayS(),0,'completed actions cannot reinstate the return delay');
emit(docListeners, 'hobunjiPlayerReady');
assert.equal(W.CombatVocalizations.attackStartDelayS(),0,'return tail does not gate attacks after old actions are cleared');
// Below 25 fps gameLoop clamps dt, so the staged clock must follow the wall-clock utterance instead.
visualRemainingS = 1.3;
abilities.get('swingCombo').onTap();
const slowAction = stagedAction;
now += 200;
slowAction.t = 0.04; // One clamped frame of game time.
stagedSpec.onUpdate(slowAction);
assert(Math.abs(slowAction.t-0.2)<1e-9,'player attack clock advances by real elapsed time');
assert(Math.abs(W.CombatVocalizations.attackStartDelayS()-0.8)<1e-9,'queue ends with the utterance, not the slower game clock');
now += 5000;
stagedSpec.onUpdate(slowAction);
assert(Math.abs(slowAction.t-0.45)<1e-9,'a long pause catches up at most 0.25s per frame');
stagedSpec.onComplete(slowAction);
slowAction.phase='done';
// Flurry: one utterance per strike, mapped over its whole Windup -> Strike -> hold.
W.Combat.deps.getWeaponAttackTimeline=()=>({remainingS:0.8,activeRemainingS:0.4,windupRemainingS:0.05,strikeRemainingS:0.135,holdEndRemainingS:0.6});
abilities.get('acceleratingFlurry').onHoldUpdate();
const flurryVoice = W.CombatVocalizations.debugSnapshot().lastStrike;
assert.equal(flurryVoice.abilityId,'acceleratingFlurry','the strike utterance starts with the strike, not after a separate windup grunt');
assert(Math.abs(flurryVoice.durationS-0.6)<1e-9,'one utterance spans the strike\'s windup, strike and hold');
stagedSpec.onComplete(stagedAction);
stagedAction.phase='done';
console.log('shared animation timeline voice and queue timing: ok');

const gameSource = fs.readFileSync(path.join(__dirname,'..','docs','game.js'),'utf8'); // Executes the real visual timeline bridge, including explicit and automatic hold endpoints.
const timelineContext = {activeTool:'weapon',combatSwingAnim:'thrust',toolSwingT:1.3,toolSwingDur:1.3,combatSwingWindupFrac:0.2/1.3,combatSwingStrikeFrac:0.3/1.3,combatSwingHoldS:0.7,combatSwingHeld:false}; // Animation clock at Neutral.
vm.createContext(timelineContext);
vm.runInContext(gameSource.slice(gameSource.indexOf('      function getWeaponAttackTimeline()'),gameSource.indexOf('      // Ranged actions supply separate load/fire pose sets')),timelineContext);
assert.equal(timelineContext.getWeaponAttackTimeline().remainingS,1.3);
assert(Math.abs(timelineContext.getWeaponAttackTimeline().activeRemainingS-0.65)<1e-9,'input gate ends halfway through the 0.7s hold');
assert(Math.abs(timelineContext.getWeaponAttackTimeline().strikeRemainingS-0.3)<1e-9);
assert(Math.abs(timelineContext.getWeaponAttackTimeline().holdEndRemainingS-1)<1e-9,'release voice maps through the end of the 0.7s hold');
assert(Math.abs(timelineContext.getWeaponAttackTimeline().windupRemainingS-0.2)<1e-9);
timelineContext.toolSwingT=1.1;
assert(Math.abs(timelineContext.getWeaponAttackTimeline().windupRemainingS)<1e-9,'Windup endpoint begins the second sound');
assert.equal(timelineContext.getWeaponAttackTimeline().remainingS,1.1,'second phase includes strike, hold, and return');
assert(Math.abs(timelineContext.getWeaponAttackTimeline().strikeRemainingS-0.1)<1e-9,'inputs still ignored before the Strike pose');
timelineContext.toolSwingT=0.3;
assert.equal(timelineContext.getWeaponAttackTimeline().activeRemainingS,0,'mid-hold releases input while the hold and return animation continue');
timelineContext.combatSwingHoldS=0;
timelineContext.toolSwingT=1.3;
assert(Math.abs(timelineContext.getWeaponAttackTimeline().activeRemainingS-0.45)<1e-9,'automatic holds release input at their midpoint too');
timelineContext.combatSwingStrikeFrac=1;
assert(Math.abs(timelineContext.getWeaponAttackTimeline().activeRemainingS-1.3)<1e-9,'the gate never ends before the Strike pose');
timelineContext.toolSwingT=0;
assert.equal(timelineContext.getWeaponAttackTimeline(),null,'reaching Neutral releases the animation gate');

// Every authored species/gender applies the same profile to all one-shot combat vocals.
W.AudioSystem.gameAudioConfig = () => ({ enabled: true, sfxVolume: 1 });
for (const entry of played) entry.handle?.finish();
for (const [speciesId, genders] of Object.entries(W.CombatVocalizations.getConfig().utteranceModulation.species)) {
  for (const [gender, profile] of Object.entries(genders)) {
    const actor = { // Fresh actor isolates cadence/voice ownership for each authored profile.
      id: `voice-${speciesId}-${gender}`, health: 80, maxHealth: 100, stamina: 50, maxStamina: 100,
      appearance: { speciesId, gender },
    };
    for (const category of ['combo', 'quickAttack', 'offensiveHold']) {
      W.CombatVocalizations.playStrikeGrunt(actor, category, 'profile-audit');
      assert(Math.abs(played.at(-1).pitchSemitones - (profile.pitchSemitones + 1.47)) < 1e-9, `${actor.id}/${category} pitch`);
      assert.equal(played.at(-1).tempo, profile.tempo);
      assert.equal(played.at(-1).volume, Math.min(1, 0.86 * profile.gain));
      played.at(-1).handle.finish();
    }
    emit(listeners, 'hobunji-resource-change', { entity: actor, delta: -1, immediate: true });
    assert(Math.abs(played.at(-1).pitchSemitones - (profile.pitchSemitones + 1.47)) < 1e-9, `${actor.id}/pain pitch`);
    assert.equal(played.at(-1).volume, Math.min(1, 0.9 * profile.gain));
    played.at(-1).handle.finish();
    scheduledBreath({ timestamp: 100000 });
    assert(played.at(-1).url.includes('heavybreath_'));
    assert(Math.abs(played.at(-1).pitchSemitones - (profile.pitchSemitones + 0.2156)) < 1e-9, `${actor.id}/breath pitch`);
    assert.equal(played.at(-1).tempo, profile.tempo);
    assert.equal(played.at(-1).volume, Math.min(1, 0.72 * profile.gain));
    const breathEntry = played.at(-1); // Dodge must preempt this actor's breathing with the shared click-safe handoff.
    const dodge = W.CombatVocalizations.playDodge(actor); // Captures the actual independent tempo/pitch request.
    assert.equal(breathEntry.stopped, true);
    assert(played.at(-1).url.endsWith('sfx_pain_intensity1.m4a'));
    assert(Math.abs(played.at(-1).pitchSemitones - (profile.pitchSemitones + 1.47)) < 1e-9, `${actor.id}/dodge pitch`);
    assert.equal(played.at(-1).tempo, profile.tempo / 0.75);
    assert.equal(played.at(-1).volume, Math.min(1, 0.9 * profile.gain));
    assert.equal(dodge.durationScale, 0.75);
    assert.equal(W.CharacterVoiceOwner.current(actor).kind, 'active');
    assert.equal(W.CombatVocalizations.debugSnapshot().lastDodge.intensity, 1);
    W.CombatVocalizations.forgetEntity(actor);
  }
}
assert.equal(W.CombatVocalizations.playDodge(null), null, 'missing actors are ignored');
assert.equal(W.CombatVocalizations.playDodge({}), null, 'animals do not acquire humanoid dodge vocals');
W.AudioSystem.gameAudioConfig = () => ({ enabled: false });
const beforeMutedDodge = played.length; // Muted audio must not queue a dodge utterance.
assert.equal(W.CombatVocalizations.playDodge(player), null);
assert.equal(played.length, beforeMutedDodge);
W.AudioSystem.gameAudioConfig = () => ({ enabled: true, sfxVolume: 1 });

// A missing independent renderer must still transpose the voice in emergency native playback.
W.AnimalVoiceIndependentPlayback = null;
W.Audio = function Audio(url) { // Captures HTMLAudioElement properties without requiring a browser.
  this.src = url;
  this.addEventListener = () => {};
  this.play = () => Promise.resolve();
};
W.__hobunjiPlayerProfile = { appearance: { speciesId: 'mashtzarr', gender: 'male' } };
const nativeDodge = W.CombatVocalizations.playDodge(player); // Native-only browsers couple speed/pitch, but keep authored voice identity.
assert.equal(nativeDodge.snd.preservesPitch, false);
assert(Math.abs(nativeDodge.snd.playbackRate - ((1 / 0.75) * Math.pow(2, (-6 + 1.47) / 12))) < 1e-9);
assert.equal(nativeDodge.independentPitch, false);
W.CharacterVoiceOwner.release(nativeDodge.claim);
player.stamina = 5;
scheduledBreath({ timestamp: 150000 });
assert.equal(W.CombatVocalizations.debugSnapshot().lastBreath.reason, 'pitch-renderer-loading', 'breathing waits for an asynchronously loading pitch renderer');
assert.equal(W.CombatVocalizations.debugSnapshot().lastBreath.suppressed, true);
now += 6000; // Simulates an unavailable module after the bounded startup retry window.
scheduledBreath({ timestamp: 150100 });
const nativeBreathDebug = W.CombatVocalizations.debugSnapshot().lastBreath; // Confirms that the native-only path still transposes a winded player's voice.
assert.equal(nativeBreathDebug.independentPitch, false);
assert(Math.abs(nativeBreathDebug.pitchSemitones - (-6 + 0.2156)) < 1e-9, 'native breathing retains the authored Mashtzarr male pitch shift and subtle randomized variation');
assert.equal(W.CharacterVoiceOwner.current(player)?.kind, 'breath');
W.CharacterVoiceOwner.stop(player, 0);

// Execute the real ordinary dodge entry point, including all its early exits.
const dodgeActor = { x: 0, y: 0, angle: 0, inputStrength: 1, inputX: 1, inputY: 0, stamina: 100 }; // Isolated player for the authoritative game.js action.
let ordinaryDodgeCalls = 0; // Counts audio calls from successful dodge starts only.
const dodgeContext = vm.createContext({
  window: { CombatVocalizations: { playDodge(actor) { assert.equal(actor, dodgeActor); ordinaryDodgeCalls++; } } },
  player: dodgeActor, DODGE_STAMINA_COST: 18, DODGE_DUR_S: 0.22, DODGE_COOLDOWN_S: 0.5, DODGE_IFRAME_MS: 250,
  beginSomersaultRecovery: () => true, performance: { now: () => 0 }, Math,
}); // Exact closure dependencies needed by performDodge.
vm.runInContext(gameSource.slice(gameSource.indexOf('      function performDodge()'), gameSource.indexOf('      // Single dedicated "context action" button')), dodgeContext);
assert.equal(dodgeContext.performDodge(), true);
assert.equal(ordinaryDodgeCalls, 1);
assert.equal(dodgeContext.performDodge(), false);
assert.equal(ordinaryDodgeCalls, 1, 'an already active dodge does not vocalize again');
dodgeActor.dodging = false;
assert.equal(dodgeContext.performDodge(), false);
assert.equal(ordinaryDodgeCalls, 1, 'cooldown rejection does not vocalize');
dodgeActor.dodgeCooldownT = 0;
dodgeContext.window.Mounts = { rideState: 'mounted' };
assert.equal(dodgeContext.performDodge(), false);
assert.equal(ordinaryDodgeCalls, 1, 'mounted rejection does not vocalize');
dodgeContext.window.Mounts = null;
dodgeActor.prone = true;
assert.equal(dodgeContext.performDodge(), true);
assert.equal(ordinaryDodgeCalls, 1, 'prone recovery is not an evasive dodge');
console.log('all species/gender combat voice profiles, dodge duration, native fallback, and ordinary dodge trigger: ok');

(async () => {
  await W.CombatVocalizations.configPromise;
  const renders = []; // Captures the actual decoded charge/release renderer inputs.
  const outputs = []; // Captures the gain applied to each timed vocal output.
  const audioContext = { // Minimal Web Audio graph executes the real timed combat playback path.
    currentTime: 0, state: 'running', destination: {},
    decodeAudioData(_bytes, done) { done({ duration: 1.2 }); },
    createBufferSource() { return { playbackRate: {}, connect() {}, start() {}, stop() {}, disconnect() {} }; },
    createGain() {
      const output = { gain: { value: 1 }, connect() {}, disconnect() {} }; // Captures the authored species gain used by chargeOutputGain.
      outputs.push(output);
      return output;
    },
  };
  W.AudioContext = function AudioContext() { return audioContext; };
  W.fetch = async url => String(url).includes('combat-vocalizations.json')
    ? { ok: false }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  W.AnimalVoiceIndependentPlayback = {
    renderDecodedIndependentBuffer: async (buffer, _ctx, options) => {
      renders.push(options);
      return { buffer, playbackRate: Math.pow(2, options.pitchSemitones / 12), durationS: buffer.duration / options.tempo };
    },
    trimDecodedSilence: buffer => ({ buffer, trimStartS: 0, trimEndS: 0 }),
  };
  await W.CombatVocalizations.reloadConfig();
  for (const [speciesId, genders] of Object.entries(W.CombatVocalizations.getConfig().utteranceModulation.species)) {
    for (const [gender, profile] of Object.entries(genders)) {
      const actor = { appearance: { speciesId, gender } }; // Fresh humanoid owns each timed charge and release separately.
      for (const category of ['charge', 'combo', 'quickAttack', 'offensiveHold']) {
        const token = W.CombatVocalizations.beginCharge({ // Unique release URL avoids pre-existing failed-decode entries from the offline harness.
          entity: actor, category, targetDurationS: 0.6,
          ...(category === 'charge' ? { catchUpOnRelease: true } : { assetUrl: `${speciesId}-${gender}-${category}.m4a` }),
        });
        for (let turn = 0; turn < 20 && !token.ready && !token.done; turn++) await Promise.resolve();
        assert.equal(token.ready, true, `${speciesId}/${gender}/${category} renders`);
        assert(Math.abs(token.pitchSemitones - (profile.pitchSemitones + 1.47)) < 1e-9, `${speciesId}/${gender}/${category} modulation`);
        assert.equal(token.output.gain.value, 0.86 * profile.gain, 'the original voice master retains species volume and charge fade');
        assert.equal(token.output.__combatVocalDistanceGain?.gain.value, 1, 'distance-following attenuation is a separate gain node');
        assert.equal(renders.at(-1).pitchSemitones, token.pitchSemitones);
        assert.equal(token.normalTempo, profile.tempo);
        if (category === 'charge') {
          assert.equal(token.catchUpTempo, profile.tempo * 2);
          W.CombatVocalizations.releaseCharge(token);
        }
        token.source.onended();
      }
    }
  }
  console.log('all species/gender profiles reach timed charge/combo/quick/held renderers: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });

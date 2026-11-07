const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');
const config = read('docs/config/scratchbones-config.js');
const audio = read('docs/js/audio-system.js');
const ranged = read('docs/js/combat/ranged-weapons.js'); // Exercises weapon-specific load/fire and projectile impact routing.
const attackValues = JSON.parse(read('docs/config/combat/attack-values.json'));
const core = read('docs/js/combat/combat-core.js');
const combo = read('docs/js/combat/combat-combo.js');
const quick = read('docs/js/combat/combat-quickattacks.js');
const charged = read('docs/js/combat/combat-charged-breaker.js');
const counter = read('docs/js/combat/combat-counter-shield.js');
const flurry = read('docs/js/combat/combat-flurry.js');
const bandit = read('docs/js/combat/combat-bandit.js');
const corroded = read('docs/js/combat/combat-corroded-health.js');
const progression = read('docs/js/combat/combat-progression.js');
const game = read('docs/game.js');

const expectedAssets = [
  'sfx_swing_1.mp3', 'sfx_swing_2.mp3', 'sfx_swing_3.mp3',
  'sfx_sharp_hit_small.mp3', 'sfx_sharp_hit_medium.mp3', 'sfx_sharp_hit_large.ogg', 'sfx_sharp_hit_huge.mp3',
  'sfx_blunt_hit_small.mp3', 'sfx_blunt_hit_medium.mp3', 'sfx_blunt_hit_large.mp3', 'sfx_blunt_hit_huge.mp3',
  'sfx_block.mp3',
  'sfx_arrow_hit.mp3',
  'sfx_bandage_start.mp3', 'sfx_bandage_loop.mp3',
];
for (const file of expectedAssets) {
  assert(fs.existsSync(`docs/assets/audio/sfx/combat/${file}`), `missing combat asset ${file}`);
  assert(config.includes(`assets/audio/sfx/combat/${file}`), `combat config does not wire ${file}`);
}
assert(fs.existsSync('docs/assets/audio/sfx/sfx_load_dart.m4a'), 'blowgun dart load asset must be committed');
assert.match(config, /"blowgunLoad": \{ "url": "assets\/audio\/sfx\/sfx_load_dart\.m4a"/, 'blowguns must have their own dart loading cue');
assert.match(ranged, /playRangedImpactSfx\?\.\(x, y, p\.areaId, p\.def\?\.rangedType === 'blowgun' \? 2 : 1\)/, 'only blowgun projectiles may double the arrow impact pitch');
assert.match(config, /"bandageStart": \{[^\n]*"gainBoost": 2/, 'bandage start must use true 2x WebAudio gain');
assert.match(config, /"bandageLoop": \{[^\n]*"preload": true, "overlapMs": 120/, 'bandage loop must preload and overlap each pass by 120 ms');

assert(core.includes('action.data?.comboStep'), 'staged swing playback must receive the combo step');
assert.equal(attackValues.combo.COMBO_RESET_S, 1.8, 'authored combo reset window must be doubled to 1.8 seconds');
assert(combo.includes('let COMBO_RESET_S = 1.8'), 'runtime fallback combo reset window must match the authored value');
assert(combo.includes('consumeHealthVulnerability: isFinisher'), 'combo finishers must explicitly consume Bruised/Corroded Health');
assert(combo.includes("specialProc || (isFinisher && vulnerabilityBefore > 0) ? 'huge' : ['small', 'medium', 'large'][comboStep]"), 'combo finisher impacts should use huge only when vulnerability is available to consume');
assert(quick.includes('consumeHealthVulnerability: conditionBonusUsed'), 'condition-qualified quick attacks must consume Bruised/Corroded Health');
assert(quick.includes("conditionBonusUsed ? 'huge' : 'small'"), 'only bonus-qualified quick attacks should use huge');
assert(corroded.includes('opts?.heavy || opts?.consumeHealthVulnerability'), 'health vulnerability wrapper must accept explicit power-hit qualification');
assert(corroded.includes('condition-qualified quick attack, or combo finisher'), 'Bruised/Corroded descriptions must advertise all power-hit consumers');
assert(progression.includes('const BLEED = 0.50, WOUND = 0.65, BRUISE = 0.75, WIND = 0.90, POISON = 0.42, INFECT = 0.60, SHATTER = 0.55, CONGEAL = 1.00;'), 'mastery affliction baselines must retain the power-weighted rebalance');
assert(charged.includes("undefined, 'huge'"), 'charged heavy attacks should use huge');
assert(counter.includes('playCounterShieldBlockSfx'), 'Counter Shield absorption should play its block cue');
assert(flurry.includes("strikeIndex <= 2 ? 'small' : strikeIndex <= 5 ? 'medium' : 'large'"), 'flurry impacts should grow without using huge');
assert(bandit.includes("['small', 'medium', 'large'][comboStep]"), 'bandit combos need the same ordinary impact sequence');
assert(game.includes('playCounterShieldBlockSfx(c.x, c.y, c.areaId)'), 'guarding bandits should emit the block cue at their position');

class FakeAudio {
  static loads = 0;
  static loadsByUrl = new Map();
  static plays = 0;
  constructor(src) {
    this.src = src;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
    this.paused = true;
    this.ended = false;
    this.preservesPitch = true; // Modern native media supports tempo changes without automatically raising pitch.
  }
  load() { FakeAudio.loads++; FakeAudio.loadsByUrl.set(this.src, (FakeAudio.loadsByUrl.get(this.src) || 0) + 1); }
  pause() { this.paused = true; }
  addEventListener(name, listener) { ((this.listeners ||= {})[name] ||= []).push(listener); } // Preserve both cleanup and next-part listeners, as real browser media events do.
  finish() { this.ended = true; this.paused = true; for (const listener of this.listeners?.ended || []) listener(); } // Simulates a full clip without a timer or browser media device.
  play() { FakeAudio.plays++; FakeAudio.lastPlayed = this; this.paused = false; return Promise.resolve(); }
}

const combatSfx = {
  enabled: true,
  weaponSwing1: { url: 'swing1.mp3', volume: 1, preload: true },
  weaponSwing2: { url: 'swing2.mp3', volume: 1, preload: true },
  weaponSwing3: { url: 'swing3.mp3', volume: 1, preload: true },
  quickAttackBonusSlash: { url: 'anime-slash.wav', volume: 0.9, preload: true }, // Shared source for unchanged Quick Attack and double finisher variants.
  weaponHitSharpHuge: { url: 'sharp-huge.mp3', volume: 1, preload: true },
  counterShieldBlock: { url: 'block.mp3', volume: 1, preload: true },
  rangedImpact: { url: 'arrow-hit.mp3', volume: 1, preload: true },
  bandageStart: { url: 'bandage-start.mp3', volume: 1, gainBoost: 2 },
  bandageLoop: { url: 'bandage-loop.mp3', volume: 1, preload: true, overlapMs: 120 },
};
const context = {
  Audio: FakeAudio,
  performance: { now: () => 1000 },
  setTimeout: () => 0,
  window: { SCRATCHBONES_CONFIG: { game: { audio: { enabled: true, sfxVolume: 1, combatSfx } } } },
};
vm.runInNewContext(audio, context);
context.window.AudioSystem.init({
  TILE: 32,
  player: { x: 0, y: 0 },
  getCurrentArea: () => 'farm',
  audioUrlFailed: () => false,
  isRealMediaError: () => false,
  markAudioUrlFailed: () => {},
});
// Each preload:true combat cue fills a 2-voice pool; cues without preload
// stay lazy. (Footstep recordings preload their own pools too, so only the
// combat URLs are counted here.)
for (const entry of Object.values(combatSfx)) {
  if (!entry || typeof entry !== 'object') continue;
  assert.equal(FakeAudio.loadsByUrl.get(entry.url) || 0, entry.preload ? 2 : 0,
    `combat cue ${entry.url} should ${entry.preload ? 'fill its two-voice pool' : 'not preload'}`);
}

const bandageLoopVoice = context.window.AudioSystem.playCombatSfxKey('bandageLoop');
assert(bandageLoopVoice instanceof FakeAudio, 'semantic combat-SFX playback should return its started voice for lifecycle control');

context.window.AudioSystem.playWeaponSlashSfx(undefined, 0);
let debug = context.window.AudioSystem.combatSfxDebugSnapshot();
assert.equal(debug.last.key, 'weaponSwing1', 'combo step 1 must select swing 1 exactly');
assert.equal(debug.last.detail.comboStep, 0);

context.window.AudioSystem.playWeaponHitSfx('sharp', 0, 0, 'farm', undefined, 'huge');
debug = context.window.AudioSystem.combatSfxDebugSnapshot();
assert.equal(debug.last.key, 'weaponHitSharpHuge');
assert.equal(debug.last.detail.size, 'huge');

context.window.AudioSystem.playCounterShieldBlockSfx(0, 0, 'farm');
debug = context.window.AudioSystem.combatSfxDebugSnapshot();
assert.equal(debug.last.key, 'counterShieldBlock');
assert.equal(debug.last.detail.block, true);

context.window.AudioSystem.playRangedImpactSfx(0, 0, 'farm');
debug = context.window.AudioSystem.combatSfxDebugSnapshot();
assert.equal(debug.last.key, 'rangedImpact');
assert.equal(debug.last.detail.rangedImpact, true);
assert.equal(debug.last.detail.pitch, 1, 'ordinary arrow impacts retain default pitch');
context.window.AudioSystem.playRangedImpactSfx(0, 0, 'farm', 2);
assert.equal(context.window.AudioSystem.combatSfxDebugSnapshot().last.detail.pitch, 2, 'blowgun dart impacts are tagged for mobile audio diagnostics');
assert(Math.abs(FakeAudio.lastPlayed.playbackRate - 2) < 0.1, 'blowgun dart impacts must actually play at roughly 2x pitch');
assert.equal(debug.maxStartDelayMs, 140, 'stale mobile combat play requests need a strict deadline');
assert.equal(FakeAudio.plays, 6, 'named bandage loop plus swing, melee impact, block, and two arrow impacts should each render exactly once');

// In headless/mobile native fallback, the first lowered-pitch slash must finish before the second begins.
const beforeSlash = FakeAudio.plays; // Keeps existing ordinary weapon/arrow SFX counts independent of the new finisher.
context.window.AudioSystem.playComboFinisherBonusSfx(0, 0, 'farm');
const firstSlash = FakeAudio.lastPlayed; // The first finisher recording starts immediately on contact.
assert.equal(FakeAudio.plays, beforeSlash + 1, 'the second slash must not overlap the first');
assert.equal(firstSlash.src, 'anime-slash.wav');
assert(Math.abs(firstSlash.volume - 0.9 * 0.8) < 1e-9, 'both finisher clips are 80% of the authored slash volume');
assert.equal(firstSlash.playbackRate, 3, 'pitch-preserving native fallback prioritizes one-third duration rather than incorrectly raising pitch by 14 semitones');
assert.equal(firstSlash.preservesPitch, true);
firstSlash.finish();
const secondSlash = FakeAudio.lastPlayed; // Fired by the real ended handler, not a guessed timer.
assert.equal(FakeAudio.plays, beforeSlash + 2);
assert(Math.abs(secondSlash.volume - 0.9 * 0.8) < 1e-9);
assert.equal(secondSlash.playbackRate, 3, 'second native fallback cue preserves its one-third duration');
assert.equal(secondSlash.preservesPitch, true);
const finisherDebug = context.window.AudioSystem.combatSfxDebugSnapshot().last; // Copyable without mobile devtools.
assert.equal(finisherDebug.key, 'comboFinisherDoubleSlash');
assert.equal(finisherDebug.detail.backend, 'native-limited-fallback');
assert.equal(finisherDebug.detail.requestedTempo, 3);
assert.equal(finisherDebug.detail.volumeScale, 0.8);
assert.deepStrictEqual([...finisherDebug.detail.requestedSemitones], [-5, -6]);
assert.deepStrictEqual([...finisherDebug.detail.actualPitchModes], ['original-pitch-fast', 'original-pitch-fast'], 'mobile debug must disclose a native pitch-preserving fallback cannot independently lower the notes');
assert.deepStrictEqual([...finisherDebug.detail.actualPlaybackRates], [3, 3], 'mobile debug reports actual rather than requested playback rates');

// Old native implementations without preservesPitch instead keep the requested lowered notes (without achieving triple tempo).
class LegacyAudio extends FakeAudio {
  constructor(url) { super(url); delete this.preservesPitch; } // No browser-specific pitch-preservation flag exists.
}
context.Audio = LegacyAudio; // VM global constructor switches only for this compatibility case.
const oldNativeStart = FakeAudio.plays; // Counts two more independently-triggered native sounds.
context.window.AudioSystem.playComboFinisherBonusSfx(0, 0, 'farm');
const oldFirst = FakeAudio.lastPlayed;
assert(Math.abs(oldFirst.playbackRate - 2 ** (-5 / 12)) < 1e-9, 'legacy fallback lowers the first sound rather than accidentally pitching it upward');
assert.equal(FakeAudio.plays, oldNativeStart + 1);
oldFirst.finish();
const oldSecond = FakeAudio.lastPlayed;
assert(Math.abs(oldSecond.playbackRate - 2 ** (-6 / 12)) < 1e-9, 'legacy fallback lowers the second sound');
assert.equal(FakeAudio.plays, oldNativeStart + 2);
const oldDebug = context.window.AudioSystem.combatSfxDebugSnapshot().last;
assert.deepStrictEqual([...oldDebug.detail.actualPitchModes], ['lower-pitch-slow', 'lower-pitch-slow']);
assert.deepStrictEqual([...oldDebug.detail.actualPlaybackRates], [2 ** (-5 / 12), 2 ** (-6 / 12)]);
context.Audio = FakeAudio; // Restore the normal test backend.
const mutedStart = FakeAudio.plays; // Asset-level zero volume must never be replaced with the usual default 80%.
combatSfx.quickAttackBonusSlash.volume = 0;
context.window.AudioSystem.playComboFinisherBonusSfx(0, 0, 'farm');
assert.equal(FakeAudio.plays, mutedStart, 'a deliberately muted anime slash must stay silent');
combatSfx.quickAttackBonusSlash.volume = .9; // Restore normal mix before unrelated SFX checks.
assert.match(audio, /startAt \+ clips\[0\]\.durationS/, 'decoded Web Audio must schedule the second slash exactly at the first clip end');
assert.match(audio, /tempo: COMBO_FINISHER_SLASH_TEMPO, pitchSemitones/, 'independent DSP must receive triple tempo and each requested lowered pitch');
assert.match(combo, /playComboFinisherBonusSfx/, 'only combo specials call the new semantic cue');
assert.match(quick, /playQuickAttackBonusSfx/, 'ordinary Quick Attack cue remains unchanged');

// Exercise the actual shared cue router independently of world/projectile rendering.
const sfxStart = ranged.indexOf('  function playRangedActionSfx('); // First byte of the unchanged gameplay SFX routine.
const sfxEnd = ranged.indexOf('\n  function triggerPlayerVisual(', sfxStart); // Last byte, avoiding unrelated Three.js setup.
assert(sfxStart > -1 && sfxEnd > sfxStart, 'shared ranged SFX routine must remain present');
const cueCalls = []; // Captures the requested asset and effective playback pitch for each weapon/owner.
const rangedContext = {
  window: { AudioSystem: {
    combatSfxConfig: () => ({ rangedLoad: { url: 'crossbow-load' }, blowgunLoad: { url: 'dart-load' }, rangedFire: { url: 'arrow-shot' } }),
    playOneShotSfx: (cfg, volume, pitch) => cueCalls.push({ url: cfg.url, pitch, volume }),
    playCreatureSfxAt: (owner, cfg, pitch) => cueCalls.push({ owner: owner.id, url: cfg.url, pitch }),
  } },
  defFor: key => ({ rangedType: key.startsWith('bshuakauitl') ? 'blowgun' : 'crossbow' }),
  SCATTERBOW_LOAD_CHORUS_MS: [0], SCATTERBOW_FIRE_CHORUS_MS: [0],
  lastAudioEvent: '', setTimeout: () => { throw Error('single-shot cues must not be delayed'); },
};
vm.runInNewContext(ranged.slice(sfxStart, sfxEnd) + '\nglobalThis.fireCue = playRangedActionSfx;', rangedContext);
rangedContext.fireCue('bshuakauitl_copper', 'load');
rangedContext.fireCue('crossbow', 'load');
rangedContext.fireCue('bshuakauitl_copper', 'fire');
rangedContext.fireCue('crossbow', 'fire');
rangedContext.fireCue('bshuakauitl_copper', 'fire', { id: 'npc-blowgun' });
assert.deepStrictEqual(cueCalls.map(c => [c.url, c.pitch]), [
  ['dart-load', 1], ['crossbow-load', 1], ['arrow-shot', 2], ['arrow-shot', 1], ['arrow-shot', 2],
], 'blowgun load and shot cues must be weapon-specific for both players and NPCs');

// Execute the actual projectile→impact router, not merely a regex on its source.
const impactStart = ranged.indexOf('  function playProjectileImpactSfx('); // Beginning of the shipped impact dispatcher.
const impactEnd = ranged.indexOf('\n  function projectileHit(', impactStart); // End of the dispatcher, before collision resolution.
assert(impactStart >= 0 && impactEnd > impactStart, 'projectile impact router must remain testable');
const impactCalls = []; // Confirms per-projectile classification reaches the audio API with an unchanged location.
const impactContext = {
  window: { AudioSystem: {
    playRangedImpactSfx: (x, y, areaId, pitch) => impactCalls.push({ x, y, areaId, pitch }),
    playWeaponHitSfx: () => impactCalls.push({ thrown: true }),
  } },
};
vm.runInNewContext(ranged.slice(impactStart, impactEnd) + '\nglobalThis.playImpact = playProjectileImpactSfx;', impactContext);
const dart = { prevX: 0, prevY: 0, x: 20, y: 10, areaId: 'farm', def: { rangedType: 'blowgun' } }; // Projectile impact at half-segment uses (10,5).
impactContext.playImpact(dart, 0.5);
impactContext.playImpact({ ...dart, def: { rangedType: 'crossbow' } }, 0.5);
impactContext.playImpact({ ...dart, def: { rangedType: 'thrown', dmgType: 'sharp' } }, 0.5);
assert.deepStrictEqual(impactCalls, [
  { x: 10, y: 5, areaId: 'farm', pitch: 2 },
  { x: 10, y: 5, areaId: 'farm', pitch: 1 },
  { thrown: true },
], 'blowgun darts double impact pitch without changing arrow/crossbow/thrown hits');


async function testDecodedFinisherTiming() {
  const starts = []; // Actual WebAudio BufferSource.start calls and playback rates for consecutive audio scheduling.
  const gains = []; // Real GainNode values show both slashes actually receive 80% of the authored sound level.
  const renderRequests = // Exact independent WSOLA pitches and tempo passed to the shared renderer.
  const decoded = { duration: 0.9, numberOfChannels: 1, sampleRate: 44100, length: 39690, getChannelData: () => new Float32Array(39690) }; // Minimal valid decoded recording for the live audio owner.
  let audioContext = null; // Exposes the running test context clock to timing assertions.
  class FakeContext {
    constructor() { this.currentTime = 42; this.state = 'running'; this.destination = {}; audioContext = this; }
    decodeAudioData() { return Promise.resolve(decoded); }
    createBufferSource() {
      const source = { buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() {} };
      source.start = at => starts.push({ at, rate: source.playbackRate.value, duration: source.buffer.duration }); // Captures the exact scheduled cue from production WebAudio.
      return source;
    }
    createGain() { const gain = { gain: { value: 0 }, connect() {}, disconnect() {} }; gains.push(gain); return gain; }
    createStereoPanner() { return { pan: { value: 0 }, connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
  }
  const settings = { enabled: true, sfxVolume: 1, combatSfx: {
    enabled: true, quickAttackBonusSlash: { url: 'anime-slash.wav', volume: 0.9, preload: true },
  } }; // Same semantic cue key as production with no unrelated combat sounds.
  const world = {
    window: { SCRATCHBONES_CONFIG: { game: { audio: settings } }, AudioContext: FakeContext,
      AnimalVoiceIndependentPlayback: {
        renderDecodedIndependentBuffer(buffer, _ctx, opts) {
          assert.equal(buffer, decoded, 'reuses the decoded shared anime slash, rather than independently fetching it');
          renderRequests.push({ ...opts }); // Captures both semitone requests during startup, not on the first strike.
          const pitch = 2 ** (opts.pitchSemitones / 12); // Renderer-reported playback rate accounts for the deliberate lower pitch.
          return Promise.resolve({ buffer: { duration: buffer.duration * pitch / opts.tempo },
            playbackRate: pitch, durationS: buffer.duration / opts.tempo });
        },
      } },
    Audio: FakeAudio, performance: { now: () => 1000 }, document: { addEventListener() {} },
    setTimeout: () => 0, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
  }; // Real production audio module executes in an isolated headless WebAudio context.
  vm.runInNewContext(audio, world);
  world.window.AudioSystem.init({ TILE: 64, player: { x: 0, y: 0 }, getCurrentArea: () => 'farm',
    audioUrlFailed: () => false, isRealMediaError: () => false, markAudioUrlFailed() {} });
  for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); // Flush async fetch, decode and the two cached renders without real timers.
  assert.deepStrictEqual(renderRequests.map(v => [v.tempo, v.pitchSemitones]), [[3, -5], [3, -6]], 'both independent transforms pre-render before combat');
  const nativeBefore = FakeAudio.plays; // Ensures the decoded path does not silently invoke an HTML Audio fallback.
  world.window.AudioSystem.playComboFinisherBonusSfx(0, 0, 'farm');
  assert.equal(starts.length, 2, 'the qualified finisher starts exactly two WebAudio voices');
  assert(Math.abs(starts[0].at - (audioContext.currentTime + .005)) < 1e-8);
  assert(Math.abs(starts[1].at - starts[0].at - .3) < 1e-8, 'second slash begins as soon as the one-third-duration first slash ends');
  assert(Math.abs(starts[0].rate - 2 ** (-5 / 12)) < 1e-8, 'first slash is pitched down by five semitones');
  assert(Math.abs(starts[1].rate - 2 ** (-6 / 12)) < 1e-8, 'second slash is pitched down by six semitones');
  assert(Math.abs(starts[0].duration / starts[0].rate - .3) < 1e-8, 'first processed recording lasts precisely one-third duration');
  assert(Math.abs(starts[1].duration / starts[1].rate - .3) < 1e-8, 'second processed recording lasts precisely one-third duration');
  assert.equal(FakeAudio.plays, nativeBefore, 'processed audio never triggers coupled native playback');
  assert(gains.slice(-2).every(node => Math.abs(node.gain.value - 0.72) < 1e-9), 'both WebAudio slashes use 80% of the normal 0.9 recorded volume');
  assert.equal(world.window.AudioSystem.combatSfxDebugSnapshot().last.detail.backend, 'independent-WSOLA');
  settings.combatSfx.quickAttackBonusSlash.volume = 0; // Explicit zero must silence even already-decoded positional voices.
  world.window.AudioSystem.playComboFinisherBonusSfx(0, 0, 'farm');
  assert.equal(starts.length, 2, 'asset mute prevents another WebAudio source from starting');
}

testDecodedFinisherTiming().then(() => console.log('combat SFX wiring: ok'))
  .catch(error => { console.error(error); process.exitCode = 1; }); // CI must fail rather than hide async WebAudio assertions.


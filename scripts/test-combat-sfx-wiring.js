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
assert(combo.includes("isFinisher && vulnerabilityBefore > 0 ? 'huge' : ['small', 'medium', 'large'][comboStep]"), 'combo finisher impacts should use huge only when vulnerability is available to consume');
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
  }
  load() { FakeAudio.loads++; FakeAudio.loadsByUrl.set(this.src, (FakeAudio.loadsByUrl.get(this.src) || 0) + 1); }
  pause() { this.paused = true; }
  addEventListener() {}
  play() { FakeAudio.plays++; FakeAudio.lastPlayed = this; this.paused = false; return Promise.resolve(); }
}

const combatSfx = {
  enabled: true,
  weaponSwing1: { url: 'swing1.mp3', volume: 1, preload: true },
  weaponSwing2: { url: 'swing2.mp3', volume: 1, preload: true },
  weaponSwing3: { url: 'swing3.mp3', volume: 1, preload: true },
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

console.log('combat SFX wiring: ok');
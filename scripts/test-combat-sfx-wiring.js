const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');
const config = read('docs/config/scratchbones-config.js');
const audio = read('docs/js/audio-system.js');
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
];
for (const file of expectedAssets) {
  assert(fs.existsSync(`docs/assets/audio/sfx/combat/${file}`), `missing combat asset ${file}`);
  assert(config.includes(`assets/audio/sfx/combat/${file}`), `combat config does not wire ${file}`);
}

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
  static plays = 0;
  constructor(src) {
    this.src = src;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
    this.paused = true;
    this.ended = false;
  }
  load() { FakeAudio.loads++; }
  pause() { this.paused = true; }
  addEventListener() {}
  play() { FakeAudio.plays++; this.paused = false; return Promise.resolve(); }
}

const combatSfx = {
  enabled: true,
  weaponSwing1: { url: 'swing1.mp3', volume: 1, preload: true },
  weaponSwing2: { url: 'swing2.mp3', volume: 1, preload: true },
  weaponSwing3: { url: 'swing3.mp3', volume: 1, preload: true },
  weaponHitSharpHuge: { url: 'sharp-huge.mp3', volume: 1, preload: true },
  counterShieldBlock: { url: 'block.mp3', volume: 1, preload: true },
  rangedImpact: { url: 'arrow-hit.mp3', volume: 1, preload: true },
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
assert.equal(FakeAudio.loads, 12, 'each configured low-latency combat cue should fill its two-voice pool');

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
assert.equal(debug.maxStartDelayMs, 140, 'stale mobile combat play requests need a strict deadline');
assert.equal(FakeAudio.plays, 4, 'swing, melee impact, block, and arrow impact should each render exactly once');

console.log('combat SFX wiring: ok');
const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');
const config = read('docs/config/scratchbones-config.js');
const audio = read('docs/js/audio-system.js');
const core = read('docs/js/combat/combat-core.js');
const combo = read('docs/js/combat/combat-combo.js');
const quick = read('docs/js/combat/combat-quickattacks.js');
const charged = read('docs/js/combat/combat-charged-breaker.js');
const counter = read('docs/js/combat/combat-counter-shield.js');
const flurry = read('docs/js/combat/combat-flurry.js');
const bandit = read('docs/js/combat/combat-bandit.js');
const game = read('docs/game.js');

const expectedAssets = [
  'sfx_swing_1.mp3', 'sfx_swing_2.mp3', 'sfx_swing_3.mp3',
  'sfx_sharp_hit_small.mp3', 'sfx_sharp_hit_medium.mp3', 'sfx_sharp_hit_large.ogg', 'sfx_sharp_hit_huge.mp3',
  'sfx_blunt_hit_small.mp3', 'sfx_blunt_hit_medium.mp3', 'sfx_blunt_hit_large.mp3', 'sfx_blunt_hit_huge.mp3',
  'sfx_block.mp3',
];
for (const file of expectedAssets) {
  assert(fs.existsSync(`docs/assets/audio/sfx/combat/${file}`), `missing combat asset ${file}`);
  assert(config.includes(`assets/audio/sfx/combat/${file}`), `combat config does not wire ${file}`);
}

assert(core.includes('action.data?.comboStep'), 'staged swing playback must receive the combo step');
assert(combo.includes("['small', 'medium', 'large'][comboStep]"), 'combo impacts must map steps 1/2/3 to small/medium/large');
assert(quick.includes("conditionBonusUsed ? 'huge' : 'small'"), 'only bonus-qualified quick attacks should use huge');
assert(charged.includes("undefined, 'huge'"), 'charged heavy attacks should use huge');
assert(counter.includes('playCounterShieldBlockSfx'), 'Counter Shield absorption should play its block cue');
assert(flurry.includes("strikeIndex <= 2 ? 'small' : strikeIndex <= 5 ? 'medium' : 'large'"), 'flurry impacts should grow without using huge');
assert(bandit.includes("['small', 'medium', 'large'][comboStep]"), 'bandit combos need the same impact sequence');
assert(game.includes('playCounterShieldBlockSfx(c.x, c.y, c.areaId)'), 'guarding bandits should emit the block cue at their position');

class FakeAudio {
  static loads = 0;
  static plays = 0;
  constructor(src) {
    this.src = src;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
  }
  load() { FakeAudio.loads++; }
  cloneNode() { return new FakeAudio(this.src); }
  addEventListener() {}
  play() { FakeAudio.plays++; return Promise.resolve(); }
}

const combatSfx = {
  enabled: true,
  weaponSwing1: { url: 'swing1.mp3', volume: 1, preload: true },
  weaponSwing2: { url: 'swing2.mp3', volume: 1, preload: true },
  weaponSwing3: { url: 'swing3.mp3', volume: 1, preload: true },
  weaponHitSharpHuge: { url: 'sharp-huge.mp3', volume: 1, preload: true },
  counterShieldBlock: { url: 'block.mp3', volume: 1, preload: true },
};
const context = {
  Audio: FakeAudio,
  performance: { now: () => 1000 },
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
assert.equal(FakeAudio.loads, 5, 'every configured low-latency combat cue should preload once');

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
assert.equal(FakeAudio.plays, 3, 'swing, impact, and block should each render exactly once');

console.log('combat SFX wiring: ok');

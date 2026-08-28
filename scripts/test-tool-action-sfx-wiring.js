const fs = require('fs');
const assert = require('assert');
const vm = require('vm');
const game = fs.readFileSync('docs/game.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const audio = fs.readFileSync('docs/js/audio-system.js', 'utf8'); // Evaluated below to exercise preload and keyed playback without a browser.
for (const file of ['sfx_dig.mp3', 'sfx_pick.mp3', 'sfx_chop.mp3', 'sfx_break_tree.mp3', 'sfx_break_rock.mp3']) {
  assert(config.includes(`assets/audio/sfx/${file}`), `missing configured ${file}`);
}
assert(!config.includes('assets/audio/sfx/farming/sfx_dig.mp3'), 'dig must not use the legacy farming path');
assert(game.includes("sfxKey: 'dig'"), 'shovel contact stages need dig SFX');
assert(game.includes("sfxKey: 'chop'"), 'axe chop stages need chop SFX');
assert(game.includes("sfxKey: 'pick'"), 'pick mine stages need pick SFX');
assert(game.includes("chargeAction && !chargeStageSfxFired && progress >= chargeSfxProgress"), 'held stage SFX need an independent one-shot latch and contact point');
assert(!game.includes("chargeAction && !strikeFired && progress >= SF"), 'held stage SFX must not share the gameplay action latch');
assert((game.match(/sfxKey: 'dig', sfxAt: 0\.16/g) || []).length === 2, 'hole and dew dig thrusts must sound at contact start');
assert(game.includes("pendingAction.tool === 'shovel'"), 'single-strike shovel actions need dig SFX');
assert(audio.includes('function playObjectSfxKey('), 'AudioSystem needs a configured-key playback boundary');
assert(audio.includes('preloadConfiguredObjectSfx()'), 'tool cues need eager preload support');
assert(config.match(/"preload": true/g)?.length >= 5, 'all five tool cues need eager preload');
assert(game.includes("terminalSfxKey: index === stages.length - 1 ? 'breakTree'"), 'tree break SFX must land on the final strike');
assert(game.includes("terminalSfxKey: index === stages.length - 1 ? 'breakRock'"), 'rock break SFX must land on the final strike');
assert(game.includes('chargeAction.finalStrikeCommitted = true'), 'final break contact must commit the held action');
assert(!game.includes("playObjectSfxKey?.('breakTree');\n          window.SkillSystem"), 'tree break SFX must not wait for post-animation completion');
assert(!game.includes("playObjectSfxKey?.('breakRock');\n          window.SkillSystem"), 'rock break SFX must not wait for post-animation completion');
assert(!game.includes('function playConfiguredToolSfx('), 'gameplay must not duplicate AudioSystem config lookup');
assert(!/refillTwist(?:Out|Back)'[^\n]*sfxKey/.test(game), 'shovel twist stages must stay silent');
assert(!/refillReset'[^\n]*sfxKey/.test(game), 'shovel reset stage must stay silent');
assert(!/anim: 'toss'[^\n]*sfxKey/.test(game), 'dirt toss stages must stay silent');

class FakeAudio {
  static loads = 0;
  static clones = 0;
  static plays = 0;
  constructor(src) {
    this.src = src;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
  }
  load() { FakeAudio.loads++; }
  cloneNode() { FakeAudio.clones++; return new FakeAudio(this.src); }
  addEventListener() {}
  play() { FakeAudio.plays++; return Promise.resolve(); }
}
const audioContext = { // Supplies the browser globals used by AudioSystem during this isolated regression run.
  Audio: FakeAudio,
  performance: { now: () => 1234 },
  window: {
    SCRATCHBONES_CONFIG: {
      game: { audio: { objectSfx: { dig: { url: 'dig.mp3', volume: 0.8, preload: true } } } },
    },
  },
};
vm.runInNewContext(audio, audioContext);
audioContext.window.AudioSystem.init({
  TILE: 32,
  audioUrlFailed: () => false,
  isRealMediaError: () => false,
  markAudioUrlFailed: () => {},
});
assert.equal(FakeAudio.loads, 1, 'preloaded tool cue should call load once during AudioSystem init');
audioContext.window.AudioSystem.playObjectSfxKey('dig');
assert.equal(FakeAudio.clones, 1, 'keyed playback should clone the retained preloaded element');
assert.equal(FakeAudio.plays, 1, 'keyed playback should start the cloned cue');
const audioDebug = audioContext.window.AudioSystem.objectSfxDebugSnapshot(); // Confirms the mobile diagnostic reports the cue that actually played.
assert.equal(audioDebug.last.key, 'dig');
assert.equal(audioDebug.last.preloaded, true);
console.log('tool action SFX wiring: ok');

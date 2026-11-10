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
  static loadsByUrl = new Map();
  static clones = 0;
  static plays = 0;
  static pauses = 0;
  static instances = []; // Verify the metronome replaces its previous recorded pick voice without interrupting ordinary pick strikes.
  constructor(src) {
    this.src = src;
    this.dataset = {};
    this.readyState = 4;
    this.networkState = 1;
    this.currentTime=0;this.paused=true;this.events=new Map();
    FakeAudio.instances.push(this);
  }
  load() { FakeAudio.loads++; FakeAudio.loadsByUrl.set(this.src, (FakeAudio.loadsByUrl.get(this.src) || 0) + 1); }
  cloneNode() { FakeAudio.clones++; return new FakeAudio(this.src); }
  addEventListener(name,fn) {if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
  emit(name) {for(const listener of this.events.get(name)||[])listener();}
  pause() {FakeAudio.pauses++;this.paused=true;}
  play() { FakeAudio.plays++;this.paused=false;return Promise.resolve(); }
}
const audioContext = { // Supplies the browser globals used by AudioSystem during this isolated regression run.
  Audio: FakeAudio,
  performance: { now: () => 1234 },
  window: {
    SCRATCHBONES_CONFIG: {
      game: { audio: { objectSfx: {
        dig: { url: 'dig.mp3', volume: 0.8, preload: true },
        pick: { url: 'assets/audio/sfx/sfx_pick.mp3', volume: 0.8, preload: true },
        ...Object.fromEntries([1,2,3,4].map(beat => ['stoneBeat'+beat,
          {url:'assets/audio/sfx/sfx_stonebeat-'+beat+'.mp3',volume:0.8,preload:true}])),
      } } },
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
// Footstep recordings preload their own voice pools too, so count only the tool cue's URL.
assert.equal(FakeAudio.loadsByUrl.get('dig.mp3'), 1, 'preloaded tool cue should call load once during AudioSystem init');
audioContext.window.AudioSystem.playObjectSfxKey('dig');
assert.equal(FakeAudio.clones, 1, 'keyed playback should clone the retained preloaded element');
assert.equal(FakeAudio.plays, 1, 'keyed playback should start the cloned cue');
const audioDebug = audioContext.window.AudioSystem.objectSfxDebugSnapshot(); // Confirms the mobile diagnostic reports the cue that actually played.
assert.equal(audioDebug.last.key, 'dig');
assert.equal(audioDebug.last.preloaded, true);
const audioSystem=audioContext.window.AudioSystem;
assert.equal(FakeAudio.loadsByUrl.get('assets/audio/sfx/sfx_pick.mp3'),1,
  'ordinary mining still preloads its full-length pick recording');
for(let beat=1;beat<=4;beat++)assert.equal(FakeAudio.loadsByUrl.get('assets/audio/sfx/sfx_stonebeat-'+beat+'.mp3'),1,
  'the numbered stone beat must preload exactly once');
let previousVoice=null; // Checks each beat takes over the single metronome voice without cutting off other object SFX.
for(let beatIndex=0;beatIndex<8;beatIndex++){
  assert.equal(audioSystem.playObjectSfxKeyMetronome(beatIndex%4===0?.72:.54,beatIndex),true);
  const voice=FakeAudio.instances.at(-1),expectedBeat=beatIndex%4+1;
  assert.equal(voice.src,'assets/audio/sfx/sfx_stonebeat-'+expectedBeat+'.mp3',
    'quarter beat '+beatIndex+' must use its matching recorded number');
  assert.equal(voice.playbackRate,1,'stone beats never drift in pitch or playback duration');
  if(previousVoice)assert.equal(previousVoice.paused,true,'the next beat replaces the last metronome voice');
  previousVoice=voice;
}
assert.equal(audioSystem.objectSfxDebugSnapshot().last.key,'stoneBeat4','mobile probe reports the actual fourth beat');
assert.equal(audioSystem.objectSfxDebugSnapshot().last.maxDurationSec,3,
  'the recording may play to its natural end instead of being cut off at the old pick transient');
previousVoice.currentTime=3.01;
previousVoice.emit('timeupdate');
assert.equal(previousVoice.paused,true,'the safety cap retires an unusually long recording');
audioSystem.playObjectSfxKey('pick');
const ordinaryMiningVoice=FakeAudio.instances.at(-1);
ordinaryMiningVoice.currentTime=.7;ordinaryMiningVoice.emit('timeupdate');
assert.equal(ordinaryMiningVoice.paused,false,
  'regular mining picks still play the FULL untrimmed recording');
console.log('tool action SFX wiring: full-length mining pick and cycling 1-2-3-4 stone beat recordings OK');

#!/usr/bin/env node
'use strict';
// Production-backed age audio integration: run with node scripts/test-humanoid-voice-age-audio.js.
const assert = require('node:assert/strict'); // Enforces stage boundaries, pitch ratios, and editor behavior.
const fs = require('node:fs'); // Loads actual shipped JavaScript.
const vm = require('node:vm'); // Executes production functions in a lightweight browser stub.
const read = file => fs.readFileSync(file, 'utf8'); // Shared file reader for this suite.
function section(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length); // Bounded original function extraction.
  assert(i >= 0 && j > i, 'Missing production function: ' + a);
  return src.slice(i, j);
}
let day = 100; // Simulated raw game-day for one saved child.
const fam = { children: [{ id: 'kid', bornRawDay: 100 }] }; // Exact shape of the saved family list.
const fw = {}; // Receives test-exposed authoritative family phase resolver.
vm.runInNewContext(section(read('docs/js/romance-family.js'),'  function ageDays(child)','  function babyAmbientSound(')
  + '\nwindow.age = voiceAgePhase;', { window:fw, fam, H:{rawDay:()=>day},
  basketDays:()=>28, toddlingDays:()=>140, cfg:()=>({independentAfterDays:168}),
  num:(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback });
for(const [age,expected] of [[0,'baby'],[27,'baby'],[28,'toddler'],[167,'toddler'],[168,'child']]){
  day=100+age;
  assert.equal(fw.age('kid'),expected,'age boundary '+age);
}
assert.equal(fw.age('other'),null,'unrelated adults must not inherit family age');
// Actual production dialogue audio, both generated oscillator and short recorded tick branches.
let shift=0, speaker=null, oscillator=null, audio=null, sourceUrl=null; // Values observed from playback, not a reimplemented audio planner.
const win={AudioSystem:{gameAudioConfig:()=>({enabled:true,sfxVolume:1})},
  CombatVocalizations:{getAgePitchOffset:(_rec,id)=>{speaker=id;return shift;}}}; // Shared age-pitch provider.
const ctx={ currentTime:0,
  createOscillator:()=> (oscillator={frequency:{value:0},connect(){return this},start(){},stop(){}}),
  createGain:()=>({gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},
    connect(){return this}}),
}; // Minimal working signal graph for the shipped syllable function.
function Audio(){audio=this;this.volume=1;this.dataset={};this.playbackRate=1;this.addEventListener=()=>{};this.play=()=>Promise.resolve()} // Short recorded-clip mock.
const handles=new Map(); // Existing voice replacement registry.
const fixedMath=Object.create(Math);fixedMath.random=()=>0.5; // Fixes intrinsic variance while retaining real Math methods.
const dw={window:win,Audio,Math:fixedMath,setTimeout:()=>1,
  npcDialogueLetterSfxConfig:()=>({enabled:true,volume:.18,url:sourceUrl,playbackRate:1,
    frequencyHz:520,frequencyVarianceHz:35,durationMs:24,waveform:'square'}),
  _npcSpeechOwnerKey:rec=>rec.id,_npcSpeechAudioContext:()=>ctx,_npcSpeechBySpeaker:handles,
  _fadeNpcSpeechHandle(){},_finishNpcSpeechHandle(){},NPC_SPEECH_FADE_OUT_S:.01,NPC_SPEECH_FADE_IN_S:.005}; // Production dependencies, no actual speakers.
vm.runInNewContext(section(read('docs/js/dialogue-content.js'),'  function _playNpcDialogueLetterSfx(',
  '  function stopNpcDialogueTypewriter(')+'\nwindow.speak=_playNpcDialogueLetterSfx;',dw);
const say=()=>{handles.clear();win.speak('a',{id:'portrait'},'kid')}; // Speaker ID must follow child rather than portrait.
say();assert.equal(oscillator.frequency.value,520,'adult oscillator unchanged');
for(const ageShift of [9,6,3]){
  shift=ageShift;say();
  assert.equal(oscillator.frequency.value,520*2**(ageShift/12),'oscillator age shift '+ageShift);
}
assert.equal(speaker,'kid','floating syllables pass the saved child ID');
sourceUrl='tick.ogg';shift=9;say();
assert.equal(audio.playbackRate,2**(9/12),'baby recorded syllable is pitched up');
assert.equal(audio.preservesPitch,false,'recorded syllable actually transposes');
shift=-24;say();assert.equal(audio.playbackRate,.25,'native playbackRate is clamped');
shift=0;say();assert.equal(audio.playbackRate,1,'adult clip remains unchanged');
// Editor synchronization is checked through its real render/set functions.
const editor=read('docs/tools/combat-vocalization-editor/index.html'); // Shipped mobile editor HTML.
const controls=Object.fromEntries(['baby','toddler','child'].flatMap(stage=>
  [[stage+'PitchSlider',{value:null}],[stage+'PitchNumber',{value:null}]])); // Both controls per age.
controls.previewAge={value:'adult'}; // Test the editor's audition profile separately from audio offsets.
controls.json={value:''}; // Production updateJson serializes into the editor's JSON textarea.
const cfg={utteranceModulation:{agePitchSemitones:{baby:9,toddler:6,child:3}}}; // Editor JSON shared with runtime.
let writes=0;const ew={}; // Stores exported editor methods and update count.
vm.runInNewContext(section(editor,'  function authoredAgePitch(stage)','  function populateSpecies(')
  +'\nwindow.ageEditor={renderAgePitch,setAgePitch,voicePlan};',
  {window:ew,cfg,$:id=>controls[id],AGE_PITCH_DEFAULTS:{baby:9,toddler:6,child:3},
    clamp:(n,lo,hi)=>Math.max(lo,Math.min(hi,Number(n)||0)),updateJson:()=>writes++,profileFor:()=>({pitchSemitones:5,tempo:1,gain:1})});
ew.ageEditor.renderAgePitch();assert.equal(controls.babyPitchSlider.value,9,'authored slider baseline');
ew.ageEditor.setAgePitch('toddler',-4);
assert.equal(cfg.utteranceModulation.agePitchSemitones.toddler,-4,'editor updates real config');
assert.equal(controls.toddlerPitchSlider.value,-4,'slider mirrors value');
assert.equal(controls.toddlerPitchNumber.value,-4,'number mirrors value');
assert.equal(JSON.parse(controls.json.value).utteranceModulation.agePitchSemitones.toddler,-4,'production JSON serialization retains the edited pitch');
cfg.utteranceModulation.agePitchSemitones={adult:9,baby:null,toddler:'',child:'invalid'}; // Malformed import should not suppress species pitch or change adult identity.
ew.ageEditor.renderAgePitch();
assert.equal(controls.babyPitchSlider.value,9,'null age entry displays default');
assert.equal(controls.toddlerPitchNumber.value,6,'empty age entry displays default');
assert.equal(controls.childPitchSlider.value,3,'invalid age entry displays default');
assert.equal(ew.ageEditor.voicePlan(0).pitchSemitones,5,'adult audition ignores accidental imported adult offset');
controls.previewAge.value='baby';
assert.equal(ew.ageEditor.voicePlan(0).pitchSemitones,14,'baby audition adds fallback +9 to +5 species voice');
assert.match(read('docs/js/bootstrap/classic-groups/combat-config.js'),/combat-config-loader\.js\?v=[A-Za-z0-9_-]+/, 'bootstrap loads the combat configuration module with a versioned URL');
assert.match(read('docs/js/combat/combat-config-loader.js'),/combat-vocalizations\.js\?v=[A-Za-z0-9_-]+/, 'combat loader loads the voice module with a versioned URL');
console.log('Humanoid voice age audio: family boundary, oscillator/recorded dialogue, slider and cache chain passed');

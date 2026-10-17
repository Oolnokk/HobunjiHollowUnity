'use strict';

const assert = require('node:assert/strict'); // Assertions for the executable scale, sampler, and controller regressions below.
const fs = require('node:fs'); // Reads the shipped owners rather than a duplicated implementation.
const vm = require('node:vm'); // Runs extracted functions with small audio/input adapters.
const source = fs.readFileSync('docs/assets/minigames/lyre-performance.html', 'utf8'); // Real instrument engine.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Real camera input owner.
function functionSource(text, name, indent = '  ') {
  const start = text.indexOf(`${indent}function ${name}(`); // Locates the owner without relying on its internal formatting.
  assert.ok(start >= 0, name);
  const end = text.indexOf(`\n${indent}}`, start) + indent.length + 2; // Function closing brace at the owner's indentation.
  return text.slice(start, end);
}
const context = vm.createContext({ // Shared state used by the real harmony and pattern functions.
  state:{scaleName:'Major',tonicMidi:48,game:{active:false},harmonyPattern:'fixed', arpeggioIndex:0},
  clamp:(v,min,max) => Math.max(min,Math.min(max,v)),
  sharedTransportData:() => ({}), usesFixedKurrayaHarmony:() => true,
  fixedKurrayaHarmonyCadence:() => ({eventSerial:0,progressionStep:0}),
  currentSongChordSegment:() => null, currentHarmonyStep:() => 0,
  HARMONY_PATTERNS:{fixed:[3]}, FIXED_HARMONY_PATTERN_ID:'fixed',
  FIXED_HARMONY_STEPS:[{degree:3,rootSemitones:5,quality:'major'}],
  ROMAN_DEGREES:['I','II','III','IV','V','VI','VII'], NOTE_NAMES:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
  HARMONY_REGISTER_OFFSET:-12, PAD_ROOT_REGISTER_OFFSET:-24,
});
vm.runInContext(source.match(/  const SCALES = \{[\s\S]*?\n  \};/)[0], context);
vm.runInContext(source.match(/  const AUTO_PICK_PATTERN_LIBRARY = \{[\s\S]*?\n  \};/)[0], context);
for (const name of ['scalePitchClasses','scaleSafeMidi','scaleDegreeOffset','noteMidi','currentHarmonyData','arpeggioMidi','chordStrumMidis','pitchClass','pitchClassDistance','alteredChordPitchClasses','uniquePermutations','nextDirectionalMidi','voiceAlteredChordFromMelody','smartArpeggioMidis','melodyTopStrumMidis','automaticPatternDefinition','assignSlowArpDirection','automaticPatternSteps','rootPadTargetMidi','lowKurrayaChordMidis']) {
  vm.runInContext(functionSource(source,name),context);
}
vm.runInContext(`
  for (const name of Object.keys(SCALES)) {
    state.scaleName = name;
    for (const tonic of [36,48,53,61]) {
      state.tonicMidi = tonic;
      for (const root of [0,4,5,7,9]) {
        FIXED_HARMONY_STEPS[0].rootSemitones = root;
        const allowed = new Set(scalePitchClasses());
        const check = midi => { if (!allowed.has(((midi-tonic)%12+12)%12)) throw Error(name+' out-of-scale '+midi); };
        lowKurrayaChordMidis().forEach(check);
        for (let slot=0; slot<8; slot++) check(arpeggioMidi(slot));
        for (let degree=0; degree<20; degree++) {
          const melody = noteMidi(degree,0);
          for (const id of Object.keys(AUTO_PICK_PATTERN_LIBRARY)) {
            const result = automaticPatternSteps(melody,{},id);
            for (const step of result.steps) {
              if (step.type === 'note') check(step.midi);
              if (step.type === 'strum' || step.type === 'boom') melodyTopStrumMidis(melody,step.voicing).forEach(check);
            }
          }
        }
      }
    }
  }
`,context);
context.state.scaleName = 'Major'; context.state.tonicMidi = 48;
assert.deepEqual(Array.from(context.lowKurrayaChordMidis(29)),[29,36], 'F1 + C2 perfect fifth');
context.state.scaleName = 'Hirajoshi';
assert.deepEqual(Array.from(context.lowKurrayaChordMidis(24)),[24,30], 'C1 uses the nearest permitted interval when G is outside the scale');

const starts = []; // Records sample starts and pitch rates from the real sampler pipeline.
function audioNode() {
  const param = () => ({value:1,setValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}}); // Minimal AudioParam adapter.
  return {gain:param(),frequency:param(),Q:param(),detune:param(),playbackRate:param(),connect(){return this;},disconnect(){},start(at,offset){starts.push({node:this,at,offset});},stop(at){this.stopAt=at;}};
}
Object.assign(context, {nowMs:() => 1000,log:() => {}, document:{hidden:false},PAD_SYNTH_CROSSFADE_S:0.8});
Object.assign(context.state, {audioContext:{state:'running',currentTime:10,createGain:audioNode,createBiquadFilter:audioNode,createBufferSource:audioNode},master:audioNode(),buffer:{duration:2},sampleRootMidi:60,pitchCache:new Map(),markers:{trimStart:0.1,trimEnd:1.9},attack:0.01,release:0.1,voice:'Natural',kurrayaMixLevel:0,padMixLevel:1,rootPadLevel:0.04,rootPadEnabled:true,rootPadVoices:[]});
for (const name of ['validatedMarkers','playbackDataForMidi','createVoiceNodes','audioStartTimeFor','rootPadSynthGain','createRootPadVoice','syncRootPad']) vm.runInContext(functionSource(source,name),context);
context.state.scaleName='Major';
const bass = context.createRootPadVoice(29,1100); // Executes the ordinary transposition path two-plus octaves below the recorded sample.
assert.equal(starts.length,2);
for (const [index, start] of starts.entries()) {
  assert.equal(start.at,10.1);
  assert.equal(start.offset,0.1);
  assert.equal(start.node.buffer,context.state.buffer);
  assert.equal(start.node.playbackRate.value,2 ** ((bass.chordMidis[index]-60)/12));
  assert.ok(start.node.stopAt > start.at);
}
assert.ok(bass.gain.gain.value > 0,'bass remains audible with lead mix muted');
context.state.rootPadRootMidi=context.rootPadTargetMidi();
for (const start of starts) start.node.onended();
context.syncRootPad();
assert.equal(starts.length,2,'a naturally ended low pluck waits for the next chord instead of looping every frame');

const camera = vm.createContext({ // Runs the actual early music branch of the game's controller owner.
  window:{MusicMinigame:{state:{active:true}},ControllerUI:{isActive:() => false},ControllerInput:{frame:() => ({pad:{axes:[1,1,.6,-.4]}}),normalizeStick:(x,y) => ({x:x||0,y:y||0})}},
  gamepadState:{focused:true,uiOwned:false},input:{x:1,y:1},INPUT_DEFAULTS:{deadzone:.24},CONTROLLER_LOOK_RESPONSE:1,
  releaseControllerGameplayInput:() => {},publishControllerStatus:() => {},
  controllerCameraX:0,controllerCameraY:0,
});
vm.runInContext(functionSource(game,'pollControllerInput','      '),camera);
camera.pollControllerInput();
assert.equal(camera.controllerCameraX,.6); assert.equal(camera.controllerCameraY,-.4);
assert.equal(camera.input.x,0); assert.equal(camera.input.y,0);
camera.window.ControllerInput.frame=() => ({pad:null});
camera.pollControllerInput();
assert.equal(camera.controllerCameraX,0); assert.equal(camera.controllerCameraY,0);
console.log('Kurraya scale/pattern matrix, low sampled fifth chords, one-shot lifecycle, and controller camera passed.');

// Exercise the hosted footstep bridge and real beat player with decoded surface recordings.
const metronomeMethod = source.match(/    async useGameplayFootstepMetronome\(urls\) \{[\s\S]*?\n    \},/)[0]; // Actual bridge method used after the gameplay iframe loads.
const loader = source.slice(source.indexOf('  async function loadLabMetronomeFootsteps('),source.indexOf('\n  // Same-origin host bridge:')); // Existing async surface-sample loader.
context.ensureAudio = async () => context.state.audioContext;
context.fetch = async url => ({ok:true,arrayBuffer:async () => url});
context.decodeAudioDataCompat = async url => ({duration:1,filename:url});
context.normalizeAuxiliaryDecodedBuffer = buffer => buffer;
context.musicLabMixState = () => ({});
context.state.labMetronomeBuffers=[];
context.state.labMetronomeNames=[];
context.state.metronomeSampleLevel=.55;
context.state.metronomeMixLevel=1;
context.state.auditoryMetronome=false;
vm.runInContext(loader,context);
vm.runInContext(functionSource(source,'playMetronomeClick'),context);
vm.runInContext(`globalThis.surfaceBridge = ({${metronomeMethod}})`,context);
context.surfaceBridge.useGameplayFootstepMetronome(['stone-1.mp3','stone-2.mp3']).then(() => {
  assert.equal(context.state.auditoryMetronome,true);
  assert.equal(context.state.labMetronomeBuffers.length,2);
  context.playMetronomeClick({absoluteBeat:1,beatInChord:1},false,1200);
  assert.equal(starts.at(-1).node.buffer.filename,'stone-2.mp3');
  assert.equal(starts.at(-1).at,10.2);
  console.log('Hosted surface-footstep metronome loading, enablement, rotation, and clock scheduling passed.');
}).catch(error => { console.error(error); process.exitCode=1; });

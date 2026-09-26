#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/assets/minigames/lyre-performance.html'), 'utf8');
const hostSource = fs.readFileSync(path.join(__dirname, '../docs/js/music-minigame.js'), 'utf8'); // Verifies gameplay loads the newly versioned fixed-harmony minigame rather than a stale cached copy.
const kurrayaHost = fs.readFileSync(path.join(__dirname, '../docs/js/kurraya-instrument.js'), 'utf8'); // Verifies explicitly imported Music Lab Kurraya samples survive the gameplay host's bundled-sample gate.
const musicLab = fs.readFileSync(path.join(__dirname, '../docs/tools/kurraya-music-lab/index.html'), 'utf8'); // Verifies the combined Kurraya authoring surface owns scale audition, mix/sample authoring, and SFX transposition.
const toolsHub = fs.readFileSync(path.join(__dirname, '../docs/tools/index.html'), 'utf8'); // Verifies the combined Kurraya Music Lab remains reachable from the existing developer-tools hub.

assert.match(
  source,
  /const TRANSPORT_AUDIO_LOOKAHEAD_MS = PULSE_LOOKAHEAD_MS/,
  'transport audio must use the same look-ahead horizon as automatic Kurraya notes'
);

assert.match(
  source,
  /function playMetronomeClick\(beatData = 0, force = false, whenMs = null\)[\s\S]*?audioStartTimeFor\(context, whenMs\)/,
  'metronome/footstep playback must schedule against the Web Audio clock instead of the noticing render frame'
);

assert.match(
  source,
  /function syncRootPad\(force = false, whenMs = null, clock = null\)[\s\S]*?rootPadTargetMidi\(targetClock\)[\s\S]*?createRootPadSampleVoice\(targetMidi, whenMs\)[\s\S]*?createRootPadVoice\(targetMidi, whenMs\)/,
  'root-pad changes must use the predicted harmony state and the same scheduled audio timestamp'
);

assert.match(
  source,
  /function createRootPadVoice\(midi, whenMs = null\)[\s\S]*?const rootMidi = midi[\s\S]*?rootOscillator\.frequency\.setValueAtTime\(midiFrequency\(rootMidi\), now\)[\s\S]*?chordMidis:\[rootMidi\]/,
  'the synth harmony pad must contain only the current progression root'
);

assert.doesNotMatch(
  source,
  /function createRootPadVoice\(midi, whenMs = null\)[\s\S]*?fifthOscillator/,
  'the synth root pad must not create a hidden fifth oscillator'
);

assert.match(
  source,
  /function createRootPadVoice\(midi, whenMs = null\)[\s\S]*?rootOscillator\.type = 'triangle'[\s\S]*?now \+ 0\.18/,
  'the single low synth root must expose audible harmonics and reach preview level promptly on small speakers'
);

assert.match(
  source,
  /function analyzeAuxiliaryRoot\(buffer\)[\s\S]*?estimatePitch\([\s\S]*?rootPadSampleRootMidi = detected\.midi/,
  'imported pad SFX must auto-detect their actual recorded fundamental before transposition'
);

assert.match(
  source,
  /function normalizeAuxiliaryDecodedBuffer\(decoded\)[\s\S]*?correlation < 0\.15[\s\S]*?\(left \+ right\) \* 0\.70710678/,
  'auxiliary pad imports must use phase-safe mono conversion so stereo width cannot cancel the fundamental'
);

assert.match(
  source,
  /async importPadSample\(file, rootMidi = state\.rootPadSampleRootMidi\)[\s\S]*?importAuxiliarySample\(file,'rootPad',\{autoDetectRoot:true\}\)/,
  'Music Lab pad imports must request automatic root detection rather than trusting the previous Recorded root value'
);

assert.match(
  musicLab,
  /padRootSource === 'detected'[\s\S]*?padDetectedFrequency[\s\S]*?padDetectedConfidence[\s\S]*?padChordNames/,
  'Music Lab must visibly report detected pad pitch/confidence and the actual root currently sounding'
);

assert.match(
  source,
  /function createRootPadSampleVoice\(midi, whenMs = null\)[\s\S]*?const rootMidi = midi[\s\S]*?rootSource\.playbackRate\.setValueAtTime\(Math\.pow\(2, \(rootMidi - state\.rootPadSampleRootMidi\) \/ 12\), now\)[\s\S]*?chordMidis:\[rootMidi\]/,
  'imported harmony-pad samples must transpose only one source to the current progression root'
);
assert.doesNotMatch(
  source,
  /function createRootPadSampleVoice\(midi, whenMs = null\)[\s\S]*?fifthSource/,
  'imported root pads must not duplicate the source at a fifth'
);

assert.match(
  source,
  /function rootPadTargetMidi\(clock = sharedTransportData\(\)\)[\s\S]*?currentHarmonyData\(clock\)[\s\S]*?state\.tonicMidi \+ harmony\.rootOffset \+ PAD_ROOT_REGISTER_OFFSET/,
  'the root pad must remain driven by the exact scheduled live harmony root and authored pad register'
);

assert.match(
  source,
  /kurrayaMixLevel:1[\s\S]*?metronomeMixLevel:1[\s\S]*?padMixLevel:1/,
  'the sampler must keep independent Kurraya, metronome, and pad layer mix multipliers'
);

assert.match(
  source,
  /gainAmount \* state\.kurrayaMixLevel/,
  'the Kurraya mix multiplier must reach instrument-note playback'
);
assert.match(
  source,
  /state\.rootPadSampleLevel \* state\.padMixLevel/,
  'the pad mix multiplier must reach imported root-pad playback'
);
assert.match(
  source,
  /state\.metronomeSampleLevel \* state\.metronomeMixLevel/,
  'the metronome mix multiplier must reach metronome audio'
);

assert.match(
  source,
  /mixState\(\)[\s\S]*?setMixLevels\(levels = \{\}[\s\S]*?importKurrayaSample\(file[\s\S]*?importPadSample\(file[\s\S]*?useLabFootstepMetronome\(urls\)/,
  'the shared bridge must expose the Music Lab mix, Kurraya import, pad import, and game-footstep metronome controls'
);

assert.match(
  source,
  /labMetronomeBuffers[\s\S]*?loadLabMetronomeFootsteps\(urls = \[\]\)[\s\S]*?normalizeAuxiliaryDecodedBuffer/,
  'the standalone lab metronome must decode real recorded footsteps through the engine audio path'
);

assert.match(
  kurrayaHost,
  /KURRAYA_CUSTOM_SAMPLE_KEY = 'hobunji\.kurrayaCustomSample\.v1'[\s\S]*?preferredName = String\(customSample\?\.name \|\| KURRAYA_AUDIO_ASSET\.filename\)[\s\S]*?Restored \$\{preferredName\}/,
  'gameplay must restore an explicitly chosen custom Kurraya sample instead of always overwriting it with the bundled pluck'
);

assert.match(
  source,
  /function scheduleTransportAudioAhead\(\)[\s\S]*?findUpcomingTransportBoundary\(clock => clock\.transportAbsoluteBeat\)[\s\S]*?playMetronomeClick\(currentHarmonyBeatData\(beatBoundary\.clock\), false, beatBoundary\.atMs\)[\s\S]*?findUpcomingTransportBoundary\(clock => currentHarmonyStep\(clock\)\)[\s\S]*?syncRootPad\(false, chordBoundary\.atMs, chordBoundary\.clock\)/,
  'one shared ahead-of-time scheduler must queue both beat and chord-root audio'
);

assert.match(
  source,
  /function updateGameFrame\(\)[\s\S]*?scheduleTransportAudioAhead\(\);[\s\S]*?if \(state\.scheduledHarmonyStep !== harmonyStep\) syncRootPad\(\);[\s\S]*?if \(state\.scheduledMetronomeBeat !== beatData\.absoluteBeat\) playMetronomeClick\(beatData\)/,
  'render-frame boundary handling must remain fallback-only after ahead scheduling'
);

assert.match(
  source,
  /transportAudioLookaheadMs: TRANSPORT_AUDIO_LOOKAHEAD_MS[\s\S]*?scheduledMetronomeBeat:[\s\S]*?scheduledHarmonyStep:/,
  'mobile/host diagnostics must expose the transport scheduling state'
);

assert.match(
  source,
  /const FIXED_HARMONY_STEPS = Object\.freeze\(\[[\s\S]*?degree:3,rootSemitones:5,quality:'major'[\s\S]*?degree:4,rootSemitones:7,quality:'major'[\s\S]*?degree:2,rootSemitones:4,quality:'minor'[\s\S]*?degree:5,rootSemitones:9,quality:'minor'/,
  'free improvisation must use the transposable F-G-Em-Am / IV-V-iii-vi chord roots and fixed qualities'
);

assert.match(
  source,
  /KURRAYA_AUTHORING_STEPS = Object\.freeze\(\[[\s\S]*?\.\.\.FIXED_HARMONY_STEPS[\s\S]*?degree:0,rootSemitones:0,quality:'major'/,
  'song authoring must add tonic C/I major without changing the four-root free-play progression'
);

assert.match(
  source,
  /normalizeKurrayaArrangementSteps\([\s\S]*?KURRAYA_AUTHORING_STEPS\.length - 1[\s\S]*?chordOptions:KURRAYA_AUTHORING_STEPS\.map/,
  'the arrangement bridge must accept and expose all five F/G/E/A/C authoring choices'
);

assert.match(
  source,
  /const fixedStep = fixedCadence[\s\S]*?KURRAYA_AUTHORING_STEPS\[fixedCadence\.progressionStep\][\s\S]*?FIXED_HARMONY_STEPS\[fixedCadence\.progressionStep\]/,
  'authored-song playback must resolve C from the five-choice song palette while free play stays on the four fixed roots'
);

assert.match(
  source,
  /KURRAYA_TIME_SIGNATURE = Object\.freeze\(\[6,8\]\)[\s\S]*?KURRAYA_BEAT_GROUPING = Object\.freeze\(\[3,3\]\)[\s\S]*?KURRAYA_THREE_FOUR_TIME_SIGNATURE = Object\.freeze\(\[3,4\]\)[\s\S]*?KURRAYA_THREE_FOUR_BEAT_GROUPING = Object\.freeze\(\[3\]\)/,
  'the mixed Kurraya phrase must start in 6/8 and switch to 3/4'
);

assert.match(
  source,
  /'when-the-kininjis-bloom':\{[\s\S]*?timeSignature:\[6,8\], beatGrouping:\[3,3\][\s\S]*?chords:null/,
  'When the Kininjis Bloom must start in 6/8 and use the shared mixed-meter harmony phrase'
);

assert.match(
  source,
  /function generateSong\(type, bpm\)[\s\S]*?countInBeats = type === 'when-the-kininjis-bloom'[\s\S]*?FIXED_HARMONY_SIX_EIGHT_CHORDS \* KURRAYA_TIME_SIGNATURE\[0\][\s\S]*?countInMs = beatMs \* countInBeats/,
  'the four 6/8 accompaniment bars must live before the 16-bar melody body instead of consuming its first four bars'
);

assert.match(
  source,
  /FIXED_HARMONY_SIX_EIGHT_CHORDS = 4[\s\S]*?FIXED_HARMONY_THREE_FOUR_CHORDS = 16[\s\S]*?FIXED_HARMONY_CYCLE_CHORDS = FIXED_HARMONY_SIX_EIGHT_CHORDS \+ FIXED_HARMONY_THREE_FOUR_CHORDS[\s\S]*?FIXED_HARMONY_CHORD_QUARTER_BEATS = 3[\s\S]*?KURRAYA_INTRO_QUARTER_BEATS = FIXED_HARMONY_SIX_EIGHT_CHORDS \* FIXED_HARMONY_CHORD_QUARTER_BEATS[\s\S]*?FIXED_HARMONY_FINAL_SHORT_STEPS = Object\.freeze\(\[0,1,4,4\]\)[\s\S]*?KURRAYA_DEFAULT_BODY_STEPS = Object\.freeze\(\[0,1,2,3, 0,1,2,3, 0,1,2,3, \.\.\.FIXED_HARMONY_FINAL_SHORT_STEPS\]\)/,
  'the harmony cycle must reserve four 6/8 intro chords before sixteen 3/4 melody bars and author F-G-C-C for the final short repeat'
);

assert.match(
  source,
  /function fixedKurrayaMixedMeterPhase\(performanceQuarterBeatFloat = 0\)[\s\S]*?chordWithinCycle < FIXED_HARMONY_SIX_EIGHT_CHORDS[\s\S]*?KURRAYA_TIME_SIGNATURE[\s\S]*?KURRAYA_THREE_FOUR_TIME_SIGNATURE[\s\S]*?performanceMeterBeatFloat:absoluteStartMeterBeat \+ meterBeatIntoChord/,
  'the mixed-meter phase must choose meter by chord section while keeping a continuous denominator-beat clock'
);

assert.match(
  source,
  /function sharedTransportData\([\s\S]*?rawHarmonyQuarterBeatFloat = fixedKurraya && state\.game\.active[\s\S]*?transportElapsedMs \/ Math\.max\(1,quarterBeatMs\)[\s\S]*?harmonyQuarterBeatFloat[\s\S]*?FIXED_HARMONY_CYCLE_QUARTER_BEATS - 1e-6[\s\S]*?mixedPhase = fixedKurraya \? fixedKurrayaMixedMeterPhase\(harmonyQuarterBeatFloat\)[\s\S]*?transportMeterBeatFloat = fixedKurraya[\s\S]*?transportAbsoluteBeat = Math\.floor\(transportMeterBeatFloat\)/,
  'the authored-song harmony clock must advance through the four 6/8 intro bars, then stay monotonic through the 3/4 melody and hold the final authored root through the playback tail'
);

assert.match(
  source,
  /function kurrayaHarmonySegments\(steps, meterLabel, startChord = 0\)[\s\S]*?previous && previous\.step === step[\s\S]*?previous\.lengthBars \+= 1[\s\S]*?function fixedKurrayaHarmonyCadence\(clock = sharedTransportData\(\)\)[\s\S]*?authoredSongActive[\s\S]*?eventSerial:phase\.cycleIndex \* FIXED_HARMONY_CYCLE_CHORDS \+ segment\.startChord[\s\S]*?progressionStep:segment\.step[\s\S]*?spanMeasures:segment\.lengthBars[\s\S]*?spanBeats:segment\.lengthBars \* meterNumerator/,
  'neighboring equal authored bars must collapse into one sustained harmony event instead of retriggering the pad on every bar'
);
assert.match(
  source,
  /id="harmonyChordBeats" disabled[\s\S]*?4 chords in 6\/8 → 16 chords in 3\/4/,
  'the disabled cadence control must describe the fixed mixed-meter phrase'
);

assert.match(
  source,
  /function nextSharedBeatAt\([\s\S]*?clock\.quarterBeatMs/,
  'automatic-pick release timing must preserve its quarter-BPM note-value grid while the metronome changes meter'
);

assert.match(
  source,
  /function scheduleSuccessfulPreviewContinuation\([\s\S]*?state\.game\.quarterBeatMs \|\| state\.game\.beatMs[\s\S]*?definition\.division/,
  'successful-preview arpeggio note values must remain quarter-BPM based while the metronome changes meter'
);

assert.match(
  source,
  /const requestedScaleName = options\.scaleOverride[\s\S]*?applyPerformanceScale\(requestedScaleName,\{persist:options\.persistScale !== false\}\)/,
  'ordinary authored playback must still support its authored scale while the audition path can explicitly override it'
);

assert.match(
  source,
  /scaleAuditionState\(\)[\s\S]*?scaleSemitones:scalePitchClasses\(\)\.slice\(\)[\s\S]*?arrangement:kurrayaSongArrangementState\(\)[\s\S]*?setAuditionScale\(scaleName\)[\s\S]*?setAuditionTonic\(tonicMidi\)[\s\S]*?setKurrayaSongArrangement\(arrangement = \{\}\)[\s\S]*?setKurrayaSongMelody\(notes = \[\]\)[\s\S]*?resetKurrayaSongMelody\(\)[\s\S]*?resetKurrayaSongArrangement\(\)[\s\S]*?startSongAudition\(scaleName = state\.scaleName, tonicMidi = state\.tonicMidi\)[\s\S]*?stopSongAudition\(\)/,
  'the shared music bridge must expose scale, chord-section, and session-local melody authoring'
);

assert.match(
  hostSource,
  /MUSIC_MINIGAME_SRC = 'assets\/minigames\/lyre-performance\.html\?v=20260925mixedmeter5'/,
  'gameplay must cache-bust the fixed-harmony minigame revision'
);

assert.match(musicLab, /HobunjiMusicControlBridge/, 'the standalone tool must use the shared Kurraya bridge');
assert.match(musicLab, /startSongAudition/, 'the standalone tool must start the real authored-song demo path');
assert.match(musicLab, /setAuditionScale/, 'the standalone tool must select scales through the shared engine');
assert.match(musicLab, /Visible diagnostics/, 'the standalone tool must keep mobile-visible diagnostics');
assert.match(musicLab, /id="kurrayaMix"[\s\S]*?id="padMix"[\s\S]*?id="metronomeMix"/, 'the Music Lab must expose all three playback-mix sliders');
assert.match(musicLab, /id="kurrayaSampleFile"[\s\S]*?id="padSampleFile"[\s\S]*?Recorded root/, 'the Music Lab must expose Kurraya and pad SFX import controls');
assert.match(musicLab, /hardstep_1\.mp3[\s\S]*?hardstep_2\.mp3[\s\S]*?hardstep_3\.mp3/, 'the standalone metronome must rotate real recorded game footstep sounds');
assert.match(musicLab, /Bars 1–4 are the 6\/8 accompaniment intro before the melody[\s\S]*?Bars 5–20 are the 16-bar 3\/4 melody body[\s\S]*?default ending is F → G → C → C/i, 'the Music Lab must state the four-chord 6/8 then sixteen-chord 3/4 phrase visibly');
assert.match(musicLab, /importKurrayaSample[\s\S]*?importPadSample[\s\S]*?useLabFootstepMetronome/, 'the Music Lab must route sample changes and footsteps through the shared engine bridge');

assert.match(
  source,
  /function kurrayaSongArrangementState\(\)[\s\S]*?melodyStartQuarterBeat:KURRAYA_INTRO_QUARTER_BEATS[\s\S]*?melodyNotes/,
  'the bridge must expose the real melody after the four-bar intro for timeline authoring'
);

assert.match(
  source,
  /KURRAYA_DEFAULT_MELODY_NOTES = Object\.freeze\([\s\S]*?notes:KURRAYA_DEFAULT_MELODY_NOTES\.map/,
  'the original Kurraya melody must remain an immutable reset source'
);
assert.match(
  source,
  /kurrayaSongMelodyNotes:KURRAYA_DEFAULT_MELODY_NOTES\.map[\s\S]*?function getSongDefinition\(type\)[\s\S]*?state\.kurrayaSongMelodyNotes/,
  'generated Kurraya melodies must remain session-local instead of mutating the repo-authored songbook'
);
assert.match(
  source,
  /function normalizeKurrayaMelodyNotes\(notes, fallback = KURRAYA_DEFAULT_MELODY_NOTES\)[\s\S]*?totalQuarterBeats[\s\S]*?Kurraya melody must span exactly 48 quarter-beats/,
  'generated Kurraya melodies must validate the exact 48-quarter-beat 3/4 body'
);

assert.match(
  source,
  /function currentHarmonyBeatData\([\s\S]*?beatInMeasure = modulo\(beatInChord,meter\.numerator\)[\s\S]*?isMeasureStart:beatInMeasure===0/,
  'long chord sections must keep normal measure accents while sustaining across multiple bars'
);

assert.match(
  musicLab,
  /Adjacent bars painted with the same root become one sustained long chord[\s\S]*?id="arrangementPalette"[\s\S]*?id="arrangementTimeline"/,
  'the Music Lab must show the melody and provide a bar-painting chord-section editor'
);

assert.match(
  musicLab,
  /Pick F\/G\/E\/A\/C[\s\S]*?Math\.min\(4,Math\.round\(Number\(stepIndex\)/,
  'the Music Lab must expose C as a fifth paintable chord choice'
);

assert.match(
  musicLab,
  /ARRANGEMENT_STORAGE_KEY[\s\S]*?paintArrangementBar\(barIndex\)[\s\S]*?setKurrayaSongArrangement\(\{introSteps,bodySteps\}\)[\s\S]*?arrangementSectionText/,
  'the chord editor must persist its draft locally and drive the live engine arrangement'
);

assert.match(
  musicLab,
  /id="randomMelodyBtn"[\s\S]*?id="melodyResetBtn"[\s\S]*?MELODY_STORAGE_KEY[\s\S]*?composeRandomMelody\(snapshot = arrangementSnapshot\)[\s\S]*?setKurrayaSongMelody\(melody\)/,
  'the Music Lab must expose random melody generation, reset, persistence, and live-engine application'
);

assert.match(
  musicLab,
  /RANDOM_MELODY_RHYTHMS[\s\S]*?RANDOM_MELODY_CADENCE_RHYTHMS[\s\S]*?function makeMelodicContour[\s\S]*?Math\.abs\(previousInterval\) >= 3[\s\S]*?function chooseMelodyDegree[\s\S]*?chordDistance === 0[\s\S]*?downbeat \? 6\.2[\s\S]*?function chooseCadenceDegree[\s\S]*?phraseCenters = \[4\.2,5\.5,6\.7,5\.0\]/,
  'the melody generator must use reusable rhythmic motifs, stepwise/leap-recovery contour, structural-beat chord tones, cadences, and phrase-level contour'
);

assert.match(
  musicLab,
  /Copy song draft[\s\S]*?melodyNotes = arrangement\.melodyNotes\.map[\s\S]*?JSON\.stringify\(\{introSteps:arrangement\.introSteps,bodySteps:arrangement\.bodySteps,melodyNotes\}\)/,
  'copied song drafts must include the generated melody as well as chord bars'
);

assert.doesNotMatch(source, /1–5–6–4/, 'legacy selectable harmony ids must not survive the fixed-progression migration');

assert.match(
  musicLab,
  /data-kurraya-pane="song"[\s\S]*?data-kurraya-pane="sfx"/,
  'the combined Kurraya Music Lab must expose both workflows as in-page panes'
);

assert.match(
  musicLab,
  /SOURCE_URL = '\.\.\/\.\.\/assets\/audio\/music\/instruments\/sfx_kurraya_pluck\.m4a'/,
  'the Kurraya transposer must start from the actual bundled runtime pluck'
);

assert.match(
  musicLab,
  /Math\.pow\(2, Number\(offset\) \/ 12\)/,
  'the Kurraya transposer must use the same semitone playback-rate model as runtime notes'
);

assert.match(
  musicLab,
  /OfflineAudioContext[\s\S]*?frameCount = Math\.max\(1,Math\.ceil\(sourceBuffer\.length \/ Math\.max\(0\.01,rate\)\)\)[\s\S]*?source\.playbackRate\.value = rate/,
  'the Kurraya transposer must bake runtime-equivalent rate transposition into an offline AudioBuffer'
);

assert.match(
  musicLab,
  /TARGET_PEAK = 0\.92[\s\S]*?stereoCorrelation < 0\.15[\s\S]*?energy-preserving stereo sum/,
  'the Kurraya transposer must retain the sampler\'s phase-safe mono and normalization behavior'
);

assert.match(
  musicLab,
  /writeText\(0,'RIFF'\)[\s\S]*?writeText\(8,'WAVE'\)[\s\S]*?setUint16\(34,16,true\)/,
  'the Kurraya transposer must export ordinary mono 16-bit PCM WAV files'
);

assert.match(
  musicLab,
  /Detected \/ source root[\s\S]*?Target note[\s\S]*?Visible diagnostics/,
  'the Kurraya transposer must expose editable pitch controls and mobile-visible diagnostics'
);

assert.match(
  toolsHub,
  /data-target="kurraya-music-lab"[\s\S]*?kurraya-music-lab\/index\.html\?v=20260925lab10/,
  'the combined Kurraya Music Lab must be the single Kurraya entry in the tools hub'
);
assert.doesNotMatch(
  toolsHub,
  /data-target="(?:song-scale-audition|kurraya-sfx-transposer)"/,
  'the tools hub must not retain separate Kurraya scale-audition or SFX-transposer entries'
);

console.log('Kurraya mixed-meter transport, root pad, mix/sample controls, and Music Lab regression passed');

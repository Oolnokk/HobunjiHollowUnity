#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/assets/minigames/lyre-performance.html'), 'utf8');

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

console.log('Kurraya transport audio sync regression passed');

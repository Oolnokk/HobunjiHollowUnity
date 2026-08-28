#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/animal-voice-independent-playback.js'), 'utf8');

assert.doesNotThrow(() => new vm.Script(source), 'animal independent playback parses as JavaScript');
assert.match(source, /function smoothBlendWeight\(/, 'renderer has a raised-cosine smoothing window');
assert.match(source, /0\.5 - 0\.5 \* Math\.cos\(Math\.PI \* t\)/, 'splice weighting is raised-cosine rather than a hard linear ramp');
assert.match(source, /function cubicSample\(/, 'pitch resampling uses cubic interpolation');
assert.match(source, /output\[index\] = cubicSample\(channel, index \* safeRatio\)/, 'normal pitch resampling uses cubic samples');
assert.match(source, /output\[index\] = cubicSample\(channel, index \/ safeStretch\)/, 'short-clip stretch fallback also uses cubic samples');
assert.match(source, /const WSOLA_OVERLAP_RATIO = 0\.62/, 'WSOLA uses a larger overlap region for smoother joins');
assert.match(source, /const WSOLA_CORRELATION_STEP = 2/, 'WSOLA searches waveform alignment at a finer resolution');
assert.match(source, /const SEGMENT_CROSSFADE_S = 0\.026/, 'contour-stage joins use a longer 26 ms crossfade');
assert.match(source, /const OUTPUT_EDGE_FADE_S = 0\.006/, 'rendered calls get a tiny six millisecond edge ramp');
assert.match(source, /const OUTPUT_TAIL_PAD_S = 0\.018/, 'rendered calls retain a short silent tail after the release ramp');
assert.match(source, /return applyOutputEdgeEnvelope\(rendered, sampleRate\)/, 'edge smoothing is applied after the complete WSOLA\/contour render');
assert.doesNotMatch(source, /const weight = index \/ Math\.max\(1, crossfade - 1\)/, 'WSOLA no longer uses the old linear crossfade');
assert.doesNotMatch(source, /const weight = index \/ Math\.max\(1, overlap - 1\)/, 'contour concatenation no longer uses the old linear crossfade');

console.log('animal voice smoothing regression checks passed');

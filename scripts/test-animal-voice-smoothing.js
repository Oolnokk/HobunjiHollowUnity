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
assert.match(source, /output\[index\] = cubicSample\(channel, index \* safeRatio\)/, 'pitch resampling uses cubic samples');
assert.match(source, /const WSOLA_OVERLAP_RATIO = 0\.62/, 'WSOLA fallback keeps a larger overlap region for smoother joins');
assert.match(source, /const WSOLA_CORRELATION_STEP = 2/, 'WSOLA fallback searches waveform alignment at a fine resolution');
assert.match(source, /const SEGMENT_CROSSFADE_S = 0\.026/, 'contour-stage joins use a longer 26 ms crossfade');
assert.match(source, /const OUTPUT_EDGE_FADE_S = 0\.006/, 'rendered calls get a tiny six millisecond edge ramp');
assert.match(source, /const OUTPUT_TAIL_PAD_S = 0\.018/, 'rendered calls retain a short silent tail after the release ramp');
assert.match(source, /function findStableSpliceRegion\(/, 'tempo renderer searches for a repeatable peak-adjacent body region');
assert.match(source, /loopCorrelation/, 'splice eligibility considers whether a grain tail matches its own head');
assert.match(source, /function spliceTempoStretch\(/, 'tempo renderer has a non-stretch splice path');
assert.match(source, /mode: 'splice-repeat'/, 'slower calls are lengthened by duplicating source grains');
assert.match(source, /mode: 'splice-cut'/, 'faster calls are shortened by deleting source material');
assert.match(source, /const spliced = spliceTempoStretch\(pitched, requiredStretch, sampleRate\)/, 'splice tempo is attempted before WSOLA');
assert.match(source, /lastTempoBackend = 'wsola-fallback'/, 'non-repeatable calls retain the smoother WSOLA fallback');
assert.match(source, /tempoBackend: lastTempoBackend/, 'mobile diagnostics reveal which tempo renderer was used');
assert.match(source, /return applyOutputEdgeEnvelope\(rendered, sampleRate\)/, 'edge smoothing is applied after the complete splice\/contour render');
assert.doesNotMatch(source, /const weight = index \/ Math\.max\(1, crossfade - 1\)/, 'WSOLA no longer uses the old linear crossfade');
assert.doesNotMatch(source, /const weight = index \/ Math\.max\(1, overlap - 1\)/, 'contour concatenation no longer uses the old linear crossfade');

console.log('animal voice splice-tempo smoothing regression checks passed');

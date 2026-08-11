#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const rotation = fs.readFileSync('docs/js/perp-rotation.js', 'utf8'); // Checked below for per-player clamp-state instrumentation.
const probe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Checked below for mobile-visible temporal reporting.

assert.ok(rotation.includes('state.pixelProbeDebug'), 'perp clamp retains its latest decision on the entity state');
assert.ok(rotation.includes('rawTargetRotY: rawTarget'), 'clamp debug includes the raw rendered-facing target');
assert.ok(rotation.includes('effectiveTargetRotY: effectiveTarget'), 'clamp debug includes the effective target');
assert.ok(rotation.includes('snapToRotY: snapTo'), 'clamp debug identifies explicit hard snaps');
assert.ok(rotation.includes('nearestDeltaRad: nearestDT'), 'clamp debug includes signed distance from the nearest edge-on angle');
assert.ok(rotation.includes('previousSide'), 'clamp debug distinguishes side retention from a side change');

assert.ok(probe.includes('_pixelProbeCurrentFacingDebug'), 'probe combines player clamp state with final rendered yaw');
assert.ok(probe.includes('renderVsEffectiveDeltaRad'), 'probe distinguishes downstream render-yaw overrides from clamp output');
assert.ok(probe.includes('facingAtClick'), 'probe captures the visible clicked frame before diagnostic renders');
assert.ok(probe.includes('facingSamples'), 'probe samples transform state beside every framebuffer sample');
assert.ok(probe.includes('maxLogicalStep'), 'probe summarizes authoritative aim jumps');
assert.ok(probe.includes('maxRenderStep'), 'probe summarizes final rendered-yaw jumps');
assert.ok(probe.includes('hardSnapFrames'), 'probe counts dead-zone hard snaps');
assert.ok(probe.includes('portraitSideChanges'), 'probe correlates composer portrait swaps');
assert.ok(probe.includes('composerPYR='), 'per-frame trace shows pre-delta and composed world pitch/yaw/roll');
assert.ok(probe.includes('matrixDot='), 'per-frame trace shows matrix-derived portrait facing');
assert.ok(probe.includes('quatDot='), 'per-frame trace shows quaternion-only portrait facing');
assert.ok(probe.includes('disagree='), 'per-frame trace flags reflected-basis disagreement');
assert.ok(probe.includes('drunkPR='), 'per-frame trace shows drunk pitch and roll');

console.log('Player-facing Pixel Probe diagnostic wiring checks passed.');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..'); // Repository root used by the source-level lifecycle regression checks below.
const paritySource = fs.readFileSync(path.join(root, 'docs/js/procedural-hand-outline-parity.js'), 'utf8'); // Current outline adapter source under test.
const probeSource = fs.readFileSync(path.join(root, 'docs/js/hand-pixel-probe-diagnostics.js'), 'utf8'); // Mobile diagnostic source that must expose live-hook state.

// Regression: fallback and GLB visuals intentionally share left_hand_visual/right_hand_visual.
// A name-only waiter therefore terminates on the temporary fallback meshes before the GLBs
// arrive. The waiter must identify the actual GLB root instead and keep rescanning until it
// replaces the fallback visual.
assert.match(paritySource, /function currentVisualStatus\(rig\)/, 'outline parity must inspect the currently attached hand visuals');
assert.match(paritySource, /visual\?\.userData\?\.handModelKey/, 'GLB readiness must use the GLB-only handModelKey marker');
assert.match(paritySource, /live\.glbVisualsReady/, 'initial async load must wait until both current visuals are actual GLBs');
assert.doesNotMatch(
  paritySource,
  /const leftLoaded = !!rig\.group\?\.getObjectByName\?\.\('left_hand_visual'\)/,
  'name-only fallback/GLB readiness detection must not return',
);

// Diagnostics must distinguish historical hook counters from the meshes that are attached now.
assert.match(paritySource, /currentOutlineMeshesHooked/, 'rig debug must report whether every current outline mesh is hooked');
assert.match(paritySource, /currentGlbVisualsReady/, 'rig debug must report whether current visuals are GLBs rather than fallbacks');
assert.match(probeSource, /LIVE=\$\{hand\.currentOutlineMeshesHooked \? 'OK' : 'BROKEN'\}/, 'mobile Pixel Probe must make a live-hook failure explicit');
assert.match(probeSource, /GLB=\$\{hand\.currentGlbVisualsReady \? 'ready' : 'fallback\/loading'\}/, 'mobile Pixel Probe must expose fallback-vs-GLB state');

// Regression: mirrored hand GLBs use a negative X scale. The original reflection fix was
// accidentally replaced by later transform-lock work; both protections must coexist.
assert.match(paritySource, /state\.visibleMatrixWorld\.determinant\(\) < 0/, 'mirrored hand shell draws must detect reflected transforms');
assert.match(paritySource, /\(reflected \? -1 : 1\)/, 'mirrored hand shell extrusion must reverse thickness sign');

console.log('hand outline live-visual lifecycle regression checks passed');

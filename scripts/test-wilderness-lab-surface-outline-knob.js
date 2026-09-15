#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const markers = fs.readFileSync('docs/tools/wilderness-generation-lab/lab-markers.js', 'utf8');
const features = fs.readFileSync('docs/tools/wilderness-generation-lab/lab-features.js', 'utf8');
const live = fs.readFileSync('docs/tools/wilderness-generation-lab/lab-surface-outline-live.js', 'utf8');
const environmentSync = fs.readFileSync('docs/tools/wilderness-generation-lab/lab-surface-outline-environment-sync.js', 'utf8');
const config = fs.readFileSync('docs/config/natural-surface-materials.js', 'utf8');

assert.equal(fs.existsSync('docs/tools/wilderness-generation-lab/lab-features-core.js'), false, 'live tuning must not duplicate lab-features');
assert.match(features, /const LIVE_ZONE_RECIPES = Object\.freeze/, 'existing Wilderness Lab implementation stays intact');

const configAt = markers.indexOf('../../config/natural-surface-materials.js');
const mapperAt = markers.indexOf('../../js/surface-stretch-uv-furniture.js');
const ringAt = markers.indexOf('../../js/surface-stretch-tile-ring.js');
const parityAt = markers.indexOf('../../js/surface-tile-material-parity.js');
const liveAt = markers.indexOf('lab-surface-outline-live.js');
const environmentAt = markers.indexOf('../../js/environment-surface-micro-plateau.js');
const realEnvironmentAt = markers.indexOf('lab-real-environment-surface.js');
const syncAt = markers.indexOf('lab-surface-outline-environment-sync.js');
assert.ok(configAt >= 0 && mapperAt > configAt && ringAt > mapperAt && parityAt > ringAt && liveAt > parityAt && environmentAt > liveAt && realEnvironmentAt > environmentAt && syncAt > realEnvironmentAt,
  'Lab must load shared water/snow tuning before the real snow renderer and sync adapter');

assert.match(config, /sourceEdgeFraction:\s*0\.45/, 'shared default remains 0.45');
assert.match(config, /scope:\s*'water-and-snow'/, 'shared config scope must be explicit');
assert.match(live, /const DEFAULT_SOURCE_EDGE = 0\.45/, 'Lab knob starts at 0.45');
assert.match(live, /Reset 0\.45/, 'Lab reset restores 0.45');
assert.match(live, /Water bank \+ snow outline tuning/, 'UI must describe the narrowed scope');
assert.match(live, /Grass keeps its normal tiled wavy_surface texture/, 'UI must make restored grass behavior explicit');
assert.match(live, /Coldmuck slush and cliffs are unchanged/, 'UI must make non-participating surfaces explicit');
assert.match(live, /does <b>not<\/b> regenerate the wilderness/, 'slider remains visual-only');
assert.doesNotMatch(live, /generateBtn/, 'live tuner must never trigger generation');
assert.doesNotMatch(live, /GRASS_|CLIFF_|carved_smooth|grassBase|cliffBase/, 'old fake grass/cliff tuning preview must be gone');

assert.match(live, /WATER_KEYS = new Set\(\['water', 'river', 'stream', 'waterfall'\]\)/,
  'Lab bank preview targets waterway terrain only');
assert.match(live, /function makeOutlineTexture\(/, 'Lab derives the same transparent outline-only bank texture');
assert.match(live, /if \(!keep\) pixels\.data\[i \+ 3\] = 0/, 'non-outline bank pixels must be transparent');
assert.match(live, /tileRing\.applyTileMeasuredRingUv\(mapped, state\.cells/, 'waterway preview uses real tile-distance protected-band math');
assert.match(live, /sourceEdgeFraction: state\.sourceEdgeFraction/, 'live knob drives the bank protected width directly');
assert.match(live, /api\.renderWorkspace = function wildernessLabWaterBankRenderWorkspace/, 'new generations refresh the water-bank preview cache');

assert.match(environmentSync, /winterPreset'\)\?\.value === 'snow'/, 'seasonal knob sync must activate only for snow');
assert.match(environmentSync, /if \(!snowPreviewActive\(\)\) return/, 'slush must not be rebuilt by protected-band changes');
assert.match(environmentSync, /requestAnimationFrame\(refreshRealSnowSurface\)/, 'snow visual refreshes coalesce to one frame');
assert.doesNotMatch(environmentSync, /generateBtn/, 'snow sync must never regenerate wilderness');
assert.match(markers, /surface-tile-material-parity\.js/, 'Lab must load the same snow-only adapter as gameplay');

console.log('Wilderness Lab water-bank/snow tuning tests passed');

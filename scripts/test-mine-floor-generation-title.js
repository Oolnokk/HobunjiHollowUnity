#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cavern = fs.readFileSync('docs/js/cavern-generator.js', 'utf8');
const mine = fs.readFileSync('docs/js/town-mine.js', 'utf8');
assert.match(cavern, /function setGenerationLabel\(text, huge = false\)/, 'cavern generator exposes shared generation-label formatting');
assert.match(cavern, /clamp\(64px, 14vw, 160px\)/, 'mine-floor title uses oversized responsive type');
assert.match(cavern, /setGenerationLabel\('Generating den…', false\)/, 'animal dens reset the shared loading label');
assert.match(cavern, /setGenerationLabel,\s*generateCavernFloor/, 'generation-label helper is exported');
assert.match(mine, /setGenerationLabel\?\.\(`FLOOR \$\{floorNumber\}`, true\)/, 'mine floor writes its floor number before generation');
assert.ok(mine.indexOf('setGenerationLabel?.(`FLOOR ${floorNumber}`, true)') < mine.indexOf('generateCavernFloor(`${visitSeed}_layout`'), 'floor title is set before the expensive cave carve');
console.log('Mine floor generation title tests passed');

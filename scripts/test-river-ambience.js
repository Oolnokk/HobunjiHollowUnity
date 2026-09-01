#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const musicSource = fs.readFileSync(path.join(__dirname, '../docs/js/music-system.js'), 'utf8');
const configSource = fs.readFileSync(path.join(__dirname, '../docs/config/scratchbones-config.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
const riverAsset = path.join(__dirname, '../docs/assets/audio/sfx/bgs/bgs_river.mp3');

assert.ok(fs.statSync(riverAsset).size > 1000, 'the uploaded river recording exists and is not empty');
assert.match(configSource, /"river": "assets\/audio\/sfx\/bgs\/bgs_river\.mp3"[\s\S]*?"riverVolume": 0\.55[\s\S]*?"riverRangeTiles": 14/,
  'river ambience URL, maximum volume, and earshot are authored in audio config');
assert.match(gameSource, /window\.Music\?\.init\(\{[\s\S]*?npcGridForArea,/,
  'Music receives the authoritative current-area grid resolver');
assert.match(musicSource, /minRow = Math\.max\(0,[\s\S]*?maxRow = Math\.min\(grid\.length - 1,[\s\S]*?minCol = Math\.max\(0,[\s\S]*?maxCol = Math\.min\(line\.length - 1/,
  'river proximity scans only the bounded listener neighborhood');
assert.match(musicSource, /type !== 'river' && type !== 'stream' && type !== 'waterfall'/,
  'rivers, streams, and waterfall approaches all feed the shared ambience loop');
assert.match(musicSource, /1 - nearestRiverTiles \/ riverRangeTiles[\s\S]*?setLoopingBgs\('river', bgs\.river, riverTargetVolume\)/,
  'the shared loop grows monotonically louder as the listener approaches water');
assert.match(musicSource, /riverAmbienceDebugSnapshot: \(\) => _riverAmbienceDebug/,
  'mobile diagnostics expose the river-distance mix decision');

console.log('river ambience regression checks passed');

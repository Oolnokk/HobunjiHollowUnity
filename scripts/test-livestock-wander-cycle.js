#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const farmSource = fs.readFileSync('docs/js/farm-animals.js', 'utf8');
const configSource = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');

assert.match(configSource,
  /"wander":\s*\{\s*"radiusTiles": 6,\s*"minTravelTiles": 3,\s*"waitMinSeconds": 10,\s*"waitMaxSeconds": 15/s,
  'livestock roaming distance and rest timing stay editable in central config');
assert.match(farmSource,
  /travelTiles < FARM_ANIMAL_WANDER_MIN_TRAVEL_TILES/,
  'wander targets must be several tiles from the animal current position');
assert.match(farmSource,
  /if \(!visiblyArrived\) return;[\s\S]{0,500}FARM_ANIMAL_WANDER_WAIT_MIN_SEC/,
  'station rest must begin only after the rendered animal arrives');
assert.match(farmSource,
  /animal\.wanderPhase = 'travel'/,
  'a picked station remains an explicit travel phase');
assert.match(farmSource,
  /_farmAnimalStepToward\(animal, animal\.wanderTargetCol, animal\.wanderTargetRow, onStep, _tileTouchesAnyBarn, false\)/,
  'station travel cannot choose an unrelated fallback direction and meander away');
assert.match(farmSource,
  /animal\.wanderPhase = 'rest'/,
  'an arrived animal enters an explicit rest phase');

console.log('Livestock wander-cycle regression checks passed.');

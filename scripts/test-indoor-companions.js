#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards indoor follower syncing and scene readiness.
const mountSource = fs.readFileSync('docs/js/mount-system.js', 'utf8'); // Guards the separate exterior-only mount rule.

assert.match(gameSource,
  /const companionSceneReady = !_isBuildingArea\(currentArea\) \|\| !!_buildingScenes\.get\(currentArea\);[\s\S]{0,180}syncCompanionFromWhistle\(\);[\s\S]{0,80}updateCompanions\(dt\);/,
  'companions and shoulder pets sync in ready building scenes');
assert.match(gameSource,
  /window\.Mounts\?\.updateMountRide\(dt\);[\s\S]{0,180}currentArea === 'farm'/,
  'mount cleanup runs before exterior-only wildlife systems are gated');
assert.match(mountSource,
  /return area === 'farm' \|\| area === 'town' \|\| deps\._isZoneArea\(area\);/,
  'mounts are allowed only in exterior areas');
assert.match(mountSource,
  /if \(!mountAllowedInArea\(deps\.getCurrentArea\(\)\)\)[\s\S]{0,120}Mounts cannot be called indoors\./,
  'indoor mount summons are rejected');
assert.match(mountSource,
  /if \(!mountAllowedInArea\(currentArea\)\)[\s\S]{0,280}deps\.companionObjects\.delete\(m\);[\s\S]{0,120}mountRideState = 'none';/,
  'an existing mount is removed at an indoor boundary in every ride phase');

console.log('indoor companion tests passed');

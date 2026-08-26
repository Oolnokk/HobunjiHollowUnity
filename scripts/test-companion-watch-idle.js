#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the player-idle companion behavior embedded in the main game closure.

assert.match(source, /function _isPlayerGenuinelyIdle\(\)[\s\S]{0,1500}return !isPlayerInCombat\(\);/, 'watch-player sampling uses a genuine idle predicate');
assert.match(source, /watchPlayerIdle = \{[\s\S]{0,220}timer: COMPANION_WATCH_IDLE_MIN_S/, 'watch-player behavior owns an explicit duration state');
assert.match(source, /const startChance = 1 - Math\.pow\(1 - COMPANION_WATCH_IDLE_RATE_PER_SEC, Math\.max\(0, dt\)\);[\s\S]{0,160}if \(rnd\(\) < startChance\) _startCompanionWatchIdle\(c\);/, 'watch-player starts probabilistically and frame-rate independently');
assert.match(source, /function _tickCompanionWatchIdle\([\s\S]{0,500}c\.vx = 0; c\.vy = 0;[\s\S]{0,240}_updateCreatureLookAtFace\(c, master, dt\)/, 'watch-player stops and targets the player face while its timer runs');
assert.match(source, /function _playerFaceTarget\(master = player\)[\s\S]{0,700}PLAYER_FACE_HEIGHT_RATIO/, 'player-facing behaviors resolve the portrait face height instead of the feet');
const treasurePriority = source.indexOf("} else if (c.treasureCue) {"); // Treasure branch must remain above the cute idle branch.
const watchPriority = source.indexOf("} else if (c.watchPlayerIdle) {"); // Watch branch must remain below treasure.
const normalFollowPriority = source.indexOf(
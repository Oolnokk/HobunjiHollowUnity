#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the companion treasure state machine embedded in the main game closure.

assert.match(source,
  /treasureCue = \{[\s\S]{0,240}phase: 'announce',[\s\S]{0,240}timer: TREASURE_ANNOUNCE_S/,
  'treasure detection creates one explicit announcement state');
assert.match(source,
  /markFacingAngle: Math\.atan2\(treasureHint\.y - c\.y, treasureHint\.x - c\.x\)/,
  'the cue seeds a bearing to the exact treasure tile even when arrival is immediate');
assert.match(source,
  /if \(cue\.phase === 'announce'\)[\s\S]{0,420}_updateCreatureLookAtFace\(c, master, dt\)[\s\S]{0,260}cue\.phase = 'lead'/,
  'announcement stops and targets the player face before leading');
assert.match(source,
  /cue\.phase === 'lead'[\s\S]{0,620}travelCreatureToward\(c, cue\.targetX, cue\.targetY, c\.def\.chaseSpeed, dt\)[\s\S]{0,260}cue\.phase = 'mark'/,
  'lead travels to the exact persisted treasure coordinate and transitions on arrival');
const markStartIndex = source.indexOf("if (cue.phase === 'mark') {"); // Start of the stationary indication phase under test.
const markEndIndex = source.indexOf('return { moving, runInPlace, aimAngle };', markStartIndex); // End of the cue tick result under test.
const markSource = source.slice(markStartIndex, markEndIndex);
assert(markStartIndex >= 0 && markEndIndex > markStartIndex
  && markSource.includes('c.vx = 0; c.vy = 0;')
  && markSource.includes('_updateCompanionHeadRotation(c, TREASURE_MARK_HEAD_DEG, dt)')
  && markSource.includes('runInPlace = true;'),
  'marking stops translation, tilts the head (with a legacy fallback), and requests run-in-place animation');
assert.match(source,
  /const movedPx = runInPlace[\s\S]{0,140}c\.def\.moveSpeed \* 0\.5 \* dt/,
  'run-in-place advances run frames explicitly without moving the companion');
const combatClearIndex = source.indexOf("if (target && c.treasureCue) _clearCompanionTreasureCue(c, dt, 'combat');"); // Priority-order anchor for the explicit combat interruption.
const cueMovementIndex = source.indexOf('} else if (c.treasureCue) {', combatClearIndex); // Movement-ownership anchor that must follow combat handling.
assert(combatClearIndex >
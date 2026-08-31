#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const bountyBoard = fs.readFileSync(path.join(__dirname, '..', 'docs/js/bounty-board.js'), 'utf8');
const proceduralTasks = fs.readFileSync(path.join(__dirname, '..', 'docs/js/procedural-tasks.js'), 'utf8');
const dialogueContent = fs.readFileSync(path.join(__dirname, '..', 'docs/js/dialogue-content.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'docs/index.html'), 'utf8');

assert.match(
  bountyBoard,
  /async function reserveForRequest\(experienced\)\s*\{[\s\S]{0,700}const existingPosting = getCurrentBountyPosting\(\);[\s\S]{0,700}bountyTaskId: existingPosting\.id/,
  'Spearhead must adopt an already-posted board bounty before generating a new target',
);
assert.match(index, /js\/bounty-board\.js\?v=20260831spearheadexisting1/, 'the bounty-board change must bypass the cached script');
assert.match(
  proceduralTasks,
  /spearhead_unumanuk:[\s\S]{0,1800}ask:[\s\S]{0,1200}victimless crimes\.`;[\s\S]{0,300}accept:[\s\S]{0,500}return `Great\./,
  'Spearhead must not say the acceptance-only Great line before the player accepts',
);
assert.match(
  dialogueContent,
  /act\.type === 'acceptRequest'[\s\S]{0,700}requestAcceptanceLine[\s\S]{0,300}renderDlgNode\(\{ type: 'line', text: acceptanceLine \}\)/,
  'a successful request acceptance must render its authored follow-up line before closing dialogue',
);
assert.match(index, /js\/procedural-tasks\.js\?v=20260831spearheadaccept1/, 'the split request dialogue must bypass the cached task script');
assert.match(index, /js\/dialogue-content\.js\?v=20260831spearheadaccept1/, 'the acceptance response handler must bypass the cached dialogue script');

console.log('Spearhead existing-bounty reservation test passed');

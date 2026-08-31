#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const bountyBoard = fs.readFileSync(path.join(__dirname, '..', 'docs/js/bounty-board.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'docs/index.html'), 'utf8');

assert.match(
  bountyBoard,
  /async function reserveForRequest\(experienced\)\s*\{[\s\S]{0,700}const existingPosting = getCurrentBountyPosting\(\);[\s\S]{0,700}bountyTaskId: existingPosting\.id/,
  'Spearhead must adopt an already-posted board bounty before generating a new target',
);
assert.match(index, /js\/bounty-board\.js\?v=20260831spearheadexisting1/, 'the bounty-board change must bypass the cached script');

console.log('Spearhead existing-bounty reservation test passed');

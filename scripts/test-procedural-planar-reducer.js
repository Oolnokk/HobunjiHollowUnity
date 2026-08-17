#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const reducer = require('../docs/tools/procedural-object-generator/planar-reducer.js');

const tests = reducer.runSelfTests();
for (const test of tests) {
  console.log(`${test.pass ? 'PASS' : 'FAIL'}: ${test.name} (${test.details})`);
}

const flat = tests.find(test => test.name.startsWith('flat 2x2 grid'));
const raised = tests.find(test => test.name.startsWith('raised center'));
assert.equal(flat?.pass, true, 'Flat grid should reduce from 8 triangles to 2.');
assert.equal(raised?.pass, true, 'Raised center should remain at 8 triangles.');

console.log('Procedural planar reducer regression checks passed.');
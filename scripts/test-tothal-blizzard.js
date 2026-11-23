#!/usr/bin/env node
// Real executable time-boundary tests for the monthly Tothal Shift blizzard.
const assert = require('node:assert/strict');
const B = require('../docs/js/tothal-blizzard.js');
const at = (day, hour) => B.stateFor(day, hour);
assert.equal(at(27, 23.99).storm, 0, 'no storm before day-28 midnight');
assert.equal(at(27, 0).phase, 'rising', 'day 28 begins at previous raw-day midnight');
assert(at(27, 0).storm > 0 && at(27, 0).storm < 0.2, 'onset is mild');
assert.equal(at(27, 0).snow, 0, 'onset begins with bare terrain');
assert(at(28, 12).storm > at(28, 6).storm, 'intensity rises through final day');
assert.equal(at(28, 0).storm, 1, 'peak at shift midnight');
assert.equal(at(28, 0).snow, 1, 'snow cover reaches full thickness at midnight');
assert(at(28, 3).storm < 1 && at(28, 3).storm > 0, 'falling action overnight');
assert.equal(at(29, 6).storm, 0, 'storm ends at 06:00 shift rollover');
assert.equal(at(29, 6).snow, 1, 'snow is still deep at storm end');
assert(at(29, 9).snow > 0 && at(29, 9).snow < 1, 'morning melt');
assert.equal(at(29, 12).snow, 0, 'snow clears at noon');
assert.equal(at(29, 12).active, false, 'event is fully over by noon');
assert.equal(at(55, 0).phase, 'rising', 'storm recurs next 28-day cycle');
assert.equal(at(56, 0).storm, 1, 'next cycle reaches its own midnight peak');
assert.equal(at(57, 6).storm, 0, 'next cycle clears after its shift');
assert.equal(at(1, 6).active, false, 'fresh new world has no phantom preceding storm');
console.log('Monthly Tothal blizzard arc passed.');

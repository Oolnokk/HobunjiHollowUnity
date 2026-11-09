#!/usr/bin/env node
'use strict';
const assert = require('assert');
const FE = require('../docs/js/furniture-elevation.js');
const box = (x, y, z, minY = 0) => ({ min: { x: -x / 2, y: minY, z: -z / 2 }, max: { x: x / 2, y: minY + y, z: z / 2 } });

// measuring: whole cubic cells, tolerant of float fuzz, never silently zero for a real piece
let m = FE.measureBounds(box(1, 1, 0.4));
assert.deepEqual([m.cellsW, m.cellsD, m.cellsH], [1, 1, 1]);
assert.equal(m.sizeZ, 0.4);
m = FE.measureBounds(box(1.0004, 0.9996, 1));
assert.deepEqual([m.cellsW, m.cellsH], [1, 1], 'float fuzz around a whole cell does not add a cell');
m = FE.measureBounds(box(1.01, 3.2, 2));
assert.deepEqual([m.cellsW, m.cellsH, m.cellsD], [2, 4, 2], 'a 3.2 tall ladder is 4 cells; 1.01 wide is 2');
assert.equal(FE.measureBounds(box(0.08, 0.08, 0.08)).cellsH, 1, 'a tiny piece still occupies one cell');
assert.equal(FE.measureBounds(null), null);
assert.equal(FE.measureBounds({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }), null, 'an empty box has no measurement');
m = FE.measureBounds({ min: { x: -0.5, y: 1, z: -0.5 }, max: { x: 0.5, y: 3, z: 0.5 } });
assert.equal(m.cellsH, 2); assert.equal(m.minY, 1); assert.equal(m.maxY, 3);

// effective: manual overrides win field by field, only in manual mode
const measured = FE.measureBounds(box(1, 2.2, 1));
assert.deepEqual(FE.effective({ mode: 'auto', measured }), { cellsW: 1, cellsD: 1, cellsH: 3, heightWorld: 3, source: 'measured' });
assert.equal(FE.effective({ mode: 'auto', measured, manual: { cellsH: 9 } }).cellsH, 3, 'manual values are ignored in auto mode');
const eff = FE.effective({ mode: 'manual', measured, manual: { cellsH: 2 } });
assert.deepEqual([eff.cellsW, eff.cellsD, eff.cellsH, eff.source], [1, 1, 2, 'manual'], 'only the overridden field changes');
assert.equal(FE.effective({ mode: 'manual', measured }).source, 'measured', 'manual mode with no overrides is still the measurement');
assert.deepEqual(FE.effective(null), { cellsW: 0, cellsD: 0, cellsH: 0, heightWorld: 0, source: 'none' });
assert.deepEqual(FE.effective({ mode: 'manual', manual: { cellsH: 2 } }).cellsH, 2, 'a manual size works even before any measurement');

// normalize: tolerant of junk from older or hand-edited files
const n = FE.normalize({ mode: 'weird', measured: { cellsW: '2', cellsD: 0, cellsH: 'x' }, manual: { cellsW: 0, cellsD: 3.4, cellsH: -1 } });
assert.equal(n.mode, 'auto'); assert.equal(n.version, 1);
assert.equal(n.measured.cellsW, 2); assert.equal(n.measured.cellsD, 0); assert.equal(n.measured.cellsH, 0);
assert.deepEqual(n.manual, { cellsD: 3 }, 'non-positive or non-numeric overrides are dropped; fractions round');
assert.equal(FE.normalize('x'), null); assert.equal(FE.normalize(undefined), null);

// checkCells
assert.deepEqual(FE.checkCells({ mode: 'auto', measured }, { cellsW: 1, cellsH: 3 }), []);
assert.deepEqual(FE.checkCells({ mode: 'auto', measured }, { cellsH: 1 }), ['height is 3 cells, expected 1']);
assert.deepEqual(FE.checkCells(null, { cellsH: 1 }), ['not measured yet']);

console.log('furniture-elevation: ok');

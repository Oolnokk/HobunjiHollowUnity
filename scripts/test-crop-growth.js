#!/usr/bin/env node
'use strict';

// Executes docs/js/crop-growth.js (extracted from game.js): growth multiplier
// bands, ditch penalty, and tickCropDay aging/readiness/stress labels.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'crop-growth.js'), 'utf8'), sandbox);
const CG = sandbox.window.CropGrowth;

const TileType = { TILLED: 'tilled', TRENCH: 'trench' };
const tile = (crop, water) => ({ type: 'tilled', crop, water, cropAge: 0, cropReady: false, stress: '' });
const grid = [[tile('garlink', 0.9), tile('', 0), tile('redberries', 0)], [{ type: 'trench' }, tile('', 0), tile('ongyums', 0.45)]];
const cropData = {
  garlink: { growDays: 3, idealMin: 0.15, idealMax: 0.45 },
  ongyums: { growDays: 3, idealMin: 0.35, idealMax: 0.70 },
  redberries: { growDays: 4, idealMin: 0.35, idealMax: 0.70, needsAdjacentDitch: true },
};
const irrigated = [];
sandbox.window.FarmProduction = { irrigate: (...args) => irrigated.push(args.length) };
CG.init({
  getGrid: () => grid, getCalendar: () => ({ day: 1 }), cropData, TileType, MAX_WATER: 3, RAIN_RATE: 0.018, ROWS: 2, COLS: 3,
  cardinalNeighbors: (col, row) => [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
    .filter(p => p.row >= 0 && p.row < 2 && p.col >= 0 && p.col < 3),
});

assert.equal(CG.cropGrowthMultiplier(grid[0][0], 0, 0), 1, 'w=0.3 sits inside garlink band');
assert.equal(CG.hasAdjacentDitch(0, 0), true);
assert.equal(CG.hasAdjacentDitch(2, 0), false);

CG.tickCropDay();
assert.equal(irrigated.length, 1, 'irrigation runs before growth');
assert.equal(grid[0][0].cropAge, 1);
assert.equal(grid[0][0].stress, '');
assert.equal(grid[0][2].stress, 'needs ditch');
assert.equal(grid[1][2].stress, 'dry', 'w=0.15 under idealMin 0.35 is dry (raw 0.45 units used to read as "too wet")');

grid[1][2].water = 3; // w=1.0, far over the band.
grid[0][0].cropAge = 2.5;
CG.tickCropDay();
assert.equal(grid[1][2].stress, 'too wet', 'w=1.0 vs idealMax 0.70 still grows at 25%');
assert.equal(grid[0][0].cropReady, true);
console.log('crop growth: ok');

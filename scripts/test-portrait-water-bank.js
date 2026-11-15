'use strict';
// A character portrait card is wider than the actor: standing BESIDE water must not tint it; standing ON a wet tile must.
// Executes the production predicate extracted from held-object-render-order.js and checks it is wired into submergedPortraits.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'held-object-render-order.js'), 'utf8');
const start = source.indexOf('function actorStandsInWater(');
assert.ok(start > 0, 'actorStandsInWater exists');
const end = source.indexOf('\n  }\n', start) + 4;
const actorStandsInWater = new Function(source.slice(start, end) + '\nreturn actorStandsInWater;')();

const pond = { userData: { hobunjiWaterTileFootprint: { bounds: [4, 3, 14, 6], tiles: new Set(['9,5', '9,4', '10,5']) } } };
assert.strictEqual(actorStandsInWater(pond, { col: 9, row: 6 }), false, 'on the bank just south of the pond: dry');
assert.strictEqual(actorStandsInWater(pond, { col: 8, row: 5 }), false, 'inside bounds but on a dry tile: dry');
assert.strictEqual(actorStandsInWater(pond, { col: 9, row: 5 }), true, 'on a wet tile: submerged');
const flood = { userData: { hobunjiWaterTileFootprint: { bounds: [0, 0, 10, 10] } } };
assert.strictEqual(actorStandsInWater(flood, { col: 3, row: 3 }), true, 'map-wide flood rectangle covers every tile');
assert.strictEqual(actorStandsInWater(flood, { col: 12, row: 3 }), false, 'outside the flood rectangle');
assert.strictEqual(actorStandsInWater({ userData: {} }, { col: 1, row: 1 }), true, 'footprint-less scenery water keeps the bounds test only');

const submerged = source.slice(source.indexOf('function submergedPortraits('));
assert.ok(/actorStandsInWater\(cover, scope\)/.test(submerged.slice(0, 900)), 'submergedPortraits requires the actor tile to be wet');
console.log('portrait water bank: ok');

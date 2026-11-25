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

const submergedStart = source.indexOf('  function submergedPortraits(');
const submergedEnd = source.indexOf('  function splitXrayGroupsForTint(', submergedStart);
assert.ok(submergedStart >= 0 && submergedEnd > submergedStart);
let rule = 'wet-tile'; // Exercise the production tint filter, not a fixed-length source substring.
const submergedPortraits = new Function('xrayRule', 'createLocalReplayFilter', 'filterOffscreenReplayMeshes',
  'tintCoverNearActor', 'actorStandsInWater', 'meshOverlapsWaterVolume',
  source.slice(submergedStart, submergedEnd) + '\nreturn submergedPortraits;')(
  () => rule, scene => portrait => scene.local.has(portrait), (_camera, meshes) => meshes,
  () => true, actorStandsInWater, () => true);
const portraitAt = (x,z) => ({matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,x,0,z,1]}});
const bank = portraitAt(9.5,6.5), wet = portraitAt(9.5,5.5), distantWet = portraitAt(10.5,5.5);
const scene = {local:new Set([bank,wet])};
assert.deepStrictEqual(submergedPortraits({},[pond],[bank,wet,distantWet],scene).portraits,[wet],
  'dry bank and distant wet portrait both stay out of special tint replay');
assert.deepStrictEqual(submergedPortraits({},[pond],[bank,wet,distantWet]).portraits,[wet,distantWet],
  'legacy no-scene path retains all wet portraits');
rule = 'off';
assert.deepStrictEqual(submergedPortraits({},[pond],[wet],scene).portraits,[]);
console.log('portrait water bank: ok');

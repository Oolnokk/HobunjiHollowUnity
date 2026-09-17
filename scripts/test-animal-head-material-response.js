'use strict';

const assert = require('assert');
const path = require('path');

global.window = global;
require(path.resolve(__dirname, '../docs/js/animal-head-material-response.js'));

const api = global.AnimalHeadMaterialResponse;
assert(api, 'AnimalHeadMaterialResponse should install on window/global');

assert.strictEqual(api.sampleResponseMap(null, 0.5, 0.5), 1, 'missing response maps must preserve legacy 100% deformation');

const map = api.decodeResponseMap({ width: 2, height: 2, encoding: 'rle-u9', data: [1, 0, 1, 128, 2, 256] });
assert(map, 'RLE response map should decode');
assert.strictEqual(map.values[0], 0);
assert.strictEqual(map.values[1], 128);
assert.strictEqual(map.values[2], 256);
assert.strictEqual(api.sampleResponseMap(map, 0, 0), 0);
assert.strictEqual(api.sampleResponseMap(map, 1, 1), 1, 'unset material cells must behave as 100% response');

assert.strictEqual(api.responseKindForVertex(20, 0.7, 0.5), 'compress');
assert.strictEqual(api.responseKindForVertex(20, 0.3, 0.5), 'stretch');
assert.strictEqual(api.responseKindForVertex(-20, 0.3, 0.5), 'compress');
assert.strictEqual(api.responseKindForVertex(-20, 0.7, 0.5), 'stretch');
assert.strictEqual(api.responseKindForVertex(0, 0.7, 0.5), 'neutral');

assert.strictEqual(api.effectiveBlendWeight(0, 0), 0, 'body endpoint must remain body-bound');
assert.strictEqual(api.effectiveBlendWeight(1, 0), 1, 'head endpoint must remain head-bound');
assert.strictEqual(api.effectiveBlendWeight(0.5, 0), 0, '0% material response should fully resist at the center of the blend seam');
assert.strictEqual(api.effectiveBlendWeight(0.5, 1), 0.5, '100% response must reproduce the legacy blend');
const low = api.effectiveBlendWeight(0.35, 0.25);
const high = api.effectiveBlendWeight(0.35, 0.75);
assert(low >= 0 && low <= 0.35);
assert(high > low && high <= 0.35, 'greater material response should yield more strongly while staying within the original head weight');

console.log('animal-head-material-response: all tests passed');

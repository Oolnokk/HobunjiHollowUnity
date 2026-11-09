#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'); // Reads actual shipped sources for accidental input exposure checks.

const house = read('docs/js/house-pieces-core.js'); // Source of physical world action prompts on house pieces.
const barn = read('docs/js/farm-buildings.js'); // Source of barn action prompts and Farm menu decoration.
const layout = read('docs/js/farm-panel-core.js'); // Source of house layout editing action buttons.

assert.doesNotMatch(house, /obj_house_demolish_/, 'neither a prompt nor its dispatch may trigger house demolition');
assert.doesNotMatch(layout, /mk\('Demolish'/, 'the house layout must not render demolition buttons');
assert.doesNotMatch(barn, /_installFarmPanelDemolishActions|_decorateFarmPanelDemolishActions/,
  'Farm panel rendering must not inject barn demolition buttons');
assert.doesNotMatch(barn, /textContent\s*=\s*['"]Demolish['"]/,
  'barn rendering must not create a destructive button');
assert.match(house, /action: 'obj_house_build_' \+ entry\.id/,
  'house foundations must retain their Build prompt');
assert.match(barn, /action: 'obj_barn_build_' \+ entry\.id/,
  'barn foundations must retain their Build prompt');
assert.match(house, /function demolish\(id\)/,
  'the internal house cleanup/recovery operation remains intact');
assert.match(barn, /function demolish\(id\)/,
  'the internal barn cleanup/recovery operation remains intact');

console.log('Furniture/building demolition UI safety checks passed');

#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('docs/js/procedural-furniture.js','utf8'); // Production recipe, not a duplicate test implementation.
const recipe=/CATALOG\.babyBasket = \[([\s\S]*?)\n  \];/.exec(src)?.[1];
assert(recipe,'baby basket recipe exists');
assert.match(recipe,/kind: 'cup'/,'same open cup primitive as the trough');
assert.match(recipe,/innerScale: \.78, basinDepth: \.19/,'hollow interior');
assert.match(recipe,/transform: \{ x: 0, y: \.13, z: 0, sx: \.8, sy: \.26, sz: \.56 \}/,'original small dimensions');
assert.doesNotMatch(recipe,/\bdisc\(|\bcyl\(/,'top disc and closed cylinder are gone');
assert.match(recipe,/box\(0, \.13, 0, \.62, \.045, \.38/,'bedding lower than the rim');
console.log('Baby basket open-cup regression passed.');

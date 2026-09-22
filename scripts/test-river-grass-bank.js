'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const vegetation = read('docs/js/vegetation-crop-rendering.js'); // Guards the town river-bank billboard clamp that prevents land grass from hanging over water.
const pixelProbe = read('docs/js/pixel-probe.js'); // Guards the mobile-readable bank-clamp diagnostic.
const index = read('docs/index.html'); // Guards cache-busting for both runtime files changed by this fix.

assert.match(vegetation, /const GRASS_BANK_SWAY_MARGIN = 0\.05/,
  'town bank grass reserves room for billboard width plus shader wind sway');
assert.match(vegetation, /function _townGrassBankEdges\(townGrid, col, row\)[\s\S]{0,1200}?return west \|\| east \|\| north \|\| south \? \{ west, east, north, south \} : null;/,
  'town grass identifies permanent water along all four sides and river-bend corners');
assert.match(vegetation, /const safeHalfExtent = w \* 0\.5 \+ GRASS_BANK_SWAY_MARGIN;[\s\S]{0,500}?edgeInsets\.south/,
  'bank-aware billboard placement clamps the full crossed-card footprint, not only its root');
assert.match(vegetation, /_fillBillboardInstances\(townGrassBillMesh, dummy, idx, col, row, 1\.0, tierY, 1, 1, 0, bankEdges\)/,
  'town grass passes detected bank edges into the shared billboard placement helper');
assert.match(vegetation, /debugGrassBankSnapshot/,
  'the vegetation runtime exposes a lightweight bank-clamp diagnostic');
assert.match(pixelProbe, /Grass bank inset: townTiles=/,
  'Pixel Probe surfaces river-bank grass clamp state without DevTools');
assert.match(index, /vegetation-crop-rendering\.js\?v=20260922rivergrass1/,
  'the shipped page cache-busts the bank-aware vegetation runtime');
assert.match(index, /pixel-probe\.js\?v=20260922rivergrass1/,
  'the shipped page cache-busts the river-bank Pixel Probe diagnostic');

console.log('River grass bank regression checks passed.');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = fs.readFileSync(path.resolve(__dirname, '../docs/js/fish-catalog.js'), 'utf8'); // Source checked to keep Western Slope's fallback pool wired into the central fish catalog.
const minigame = fs.readFileSync(path.resolve(__dirname, '../docs/js/fishing-minigame.js'), 'utf8'); // Source checked to keep the live map id mapped onto the catalog's Western Slope key.
const events = fs.readFileSync(path.resolve(__dirname, '../docs/js/fishing-events.js'), 'utf8'); // Source checked so fishing frenzies and ordinary casts continue using the same zone key.

assert.match(
  catalog,
  /const zones = \{[^}]*westernSlope:\[\][^}]*\}/s,
  'FishCatalog should publish a westernSlope pool'
);
assert.match(
  catalog,
  /zones\.westernSlope\.push\(\.\.\.zones\.northernCliffs\)/,
  'Western Slope should inherit the Northern Cliffs cold/highland pool until its own fish are authored'
);
assert.match(
  minigame,
  /currentArea === 'map_western_slope'\) return 'westernSlope'/,
  'Fishing should map map_western_slope to the westernSlope pool'
);
assert.match(
  events,
  /map_western_slope:\s*'westernSlope'/,
  'Fishing events should use the same Western Slope zone key'
);

console.log('Western Slope fishing zone regression passed.');

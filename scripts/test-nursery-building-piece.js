const assert = require('assert');
const fs = require('fs');

const buildingsSource = fs.readFileSync('docs/js/farm-buildings.js', 'utf8');
const piece = JSON.parse(fs.readFileSync('docs/config/pieces/barn-nursery.json', 'utf8'));

assert.match(
  buildingsSource,
  /nursery\s*:\s*\{\s*file:\s*'config\/pieces\/barn-nursery\.json',\s*w:\s*3,\s*h:\s*2\s*\}/,
  'FarmBuildings registers a dedicated 3x2 Nursery piece without changing Small Barn dimensions',
);
assert.match(
  buildingsSource,
  /_loadBarnPiece\(entry\.nursery\s*\?\s*'nursery'\s*:\s*entry\.tier\)/,
  'built Nursery structures load the dedicated authored piece',
);
assert.match(
  buildingsSource,
  /_pieceDef\(entry\.nursery\s*\?\s*'nursery'\s*:\s*entry\.tier\)/,
  'Nursery world footprints use the dedicated 3x2 dimensions',
);
assert.match(
  buildingsSource,
  /function _startNurseryInteriorLoop\(mapId\)[\s\S]*map_i_barn_farm_nursery[\s\S]*requestAnimationFrame\(frame\)/,
  'entering the Nursery starts its own temporary interior visual loop instead of relying on the exterior farm loop',
);
assert.match(
  buildingsSource,
  /window\.FarmAnimals\?\.updateAnimalMeshes\?\.\(dt\)/,
  'the Nursery interior loop drives the existing wrapped FarmAnimals visual seam so baby swarm rendering still runs indoors',
);
assert.match(
  buildingsSource,
  /if \(_nurseryInteriorLoopEntered\)[\s\S]*_stopNurseryInteriorLoop\(\{ flush: true \}\)/,
  'leaving the Nursery stops the temporary loop and flushes visual-only baby meshes',
);
assert.match(
  buildingsSource,
  /wrappedEnterBuilding[\s\S]*originalEnterBuilding\.call\(this, mapId, \.\.\.args\)[\s\S]*_startNurseryInteriorLoop\(mapId\)/,
  'FarmBuildings wraps the authoritative enterBuilding dependency so the Nursery loop starts from the real building transition',
);

const cells = piece.footprint?.cells || [];
assert.equal(cells.length, 6, 'Nursery authored footprint contains exactly six occupied cells');
const xs = cells.map(cell => cell.x);
const ys = cells.map(cell => cell.y);
assert.equal(Math.max(...xs) - Math.min(...xs) + 1, 3, 'Nursery authored footprint is three tiles wide');
assert.equal(Math.max(...ys) - Math.min(...ys) + 1, 2, 'Nursery authored footprint is two tiles deep');

const entries = piece.footprint?.extensions?.entryTunnels || [];
assert.equal(entries.length, 1, 'tiny Nursery has a single centered front entry rather than the Small Barn double opening');
assert.equal(entries[0].x, 9, 'Nursery entry is centered on the middle footprint column');
assert.equal(entries[0].y, Math.max(...ys), 'Nursery entry is on the front/south footprint edge');
assert(piece.base?.height < 1.4, 'Nursery body is authored shorter than the existing Small Barn');
assert(piece.roof?.crossGableSections?.[0]?.roofHeight < 1.19, 'Nursery roof is proportionally lower than the Small Barn roof');

console.log('Nursery 3x2 building + interior swarm regression tests passed');

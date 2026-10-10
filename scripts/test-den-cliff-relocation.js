// Relocated cliff dens look for another cliff site with the same den-entrance
// template (js/wildlife-spawn.js findCliffDenRelocationSite), judged on the
// game's merged zone layout through a source-scale view of its tiles.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const G = require(path.join(root, 'docs/js/wilderness-map-generator.js'));
const TP = require(path.join(root, 'docs/js/terrain-preview.js'));
const Cliff = require(path.join(root, 'docs/js/den-cliff-placement.js'));
const big = require(path.join(root, 'docs/config/locales/locale_animal_den_entrance.json'));
const small = require(path.join(root, 'docs/config/locales/locale_animal_den_entrance_small.json'));

const zone = 'map_northern_cliffs';
const ws = G.generateZoneWorkspace(zone, 'den-cliff-relocation-regression', [big, small]);
const merged = TP.buildMergedZoneGrid(ws, ws.maps[0].id); // Same merged layout game.js stores in _zoneLayouts.
const layout = { cols: merged.cols, rows: merged.rows, tiles: [...merged.tiles.values()], dens: ws.animalDens, transitions: [], rootTotems: ws.rootTotems || [], localeInstances: [], buildings: [] };
const templateFor = den => (den.entranceTemplateId === small.id ? small : big);
const context = { console, Math, DenCliffPlacement: Cliff, ZoneDenTotemFeatures: { denEntranceLocaleFor: templateFor } };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/wildlife-spawn.js'), 'utf8'), context);
const W = context.WildlifeSpawn;
let seed = 11;
W.init({ zoneLayouts: new Map([[zone, layout]]), rnd: () => ((seed = (seed * 16807) % 2147483647) / 2147483647), getCurrentArea: () => 'farm', player: { x: 0, y: 0 }, TILE: 55, hostileObjects: new Set() });
const tileMap = new Map(layout.tiles.map(t => [`${t.c},${t.r}`, t]));

// The source-scale view must agree with the generator: every generated cliff
// den re-validates on the merged layout once its own rock is cleared.
for (const den of ws.animalDens) {
  assert(den.cliffBacked, `${den.id} is cliff-backed`);
  const cleared = new Map([...tileMap].map(([key, tile]) => [key, { ...tile }]));
  for (let y = den.y; y < den.y + den.h; y++) for (let x = den.x; x < den.x + den.w; x++) {
    const tile = cleared.get(`${x},${y}`);
    if (tile?.rockKind === 'animalDen') { delete tile.rockKind; delete tile.boulderId; tile.type = 'grass'; }
  }
  const explained = Cliff.explain(Cliff.compileTemplate(templateFor(den)), W.__test.sourceScaleTileView(cleared, 2), den.x / 2, den.y / 2);
  assert(explained.result, `${den.id} re-validates on the merged layout (${explained.reason})`);
}

// Relocating a cliff den finds another cliff site with the same footprint.
const den = ws.animalDens[0];
const oldDen = { ...den };
const site = W.__test.findCliffDenRelocationSite(zone, den, oldDen, layout, tileMap, null, [], null);
assert(site && site.cliff, 'a relocated cliff den finds a cliff site');
assert(Math.hypot(site.x - oldDen.x, site.y - oldDen.y) >= 12, 'it moves well away from the old site');
const compiled = Cliff.compileTemplate(templateFor(den));
assert(Cliff.evaluate(compiled, W.__test.sourceScaleTileView(tileMap, 2), site.x / 2, site.y / 2), 'the new site satisfies the template cliff rules');
assert(site.mouthAnchor.y >= site.y && site.mouthAnchor.y < site.y + den.h, 'its entry is inside the footprint');
assert.deepEqual({ ...site.approachAnchor }, { x: site.mouthAnchor.x, y: site.y + den.h }, 'its approach tile is just in front');
for (const other of ws.animalDens.slice(1)) {
  const apart = site.x + den.w + 4 <= other.x || other.x + other.w + 4 <= site.x || site.y + den.h + 5 <= other.y || other.y + other.h + 5 <= site.y;
  assert(apart, `new site keeps clear of ${other.id}`);
}

// The stamped footprint keeps the entry column walkable.
W.__test.setDenFootprintOverlay(layout, { ...den, x: site.x, y: site.y, mouthAnchor: site.mouthAnchor }, true);
for (let row = site.mouthAnchor.y; row < site.y + den.h; row++) {
  const tile = tileMap.get(`${site.mouthAnchor.x},${row}`);
  assert(tile.type !== 'rock' && !tile.incline, `entry column ${site.mouthAnchor.x},${row} stays walkable`);
}
assert.equal(tileMap.get(`${site.x},${site.y + den.h - 1}`).type, 'rock', 'the rest of the footprint is den rock');

// Free-standing dens keep the legacy open-ground search.
assert.equal(W.__test.findCliffDenRelocationSite(zone, { ...den, cliffBacked: false }, oldDen, layout, tileMap, null, [], null), null, 'non-cliff dens skip the cliff search');
console.log(`PASS den-cliff-relocation: ${ws.animalDens.length} dens re-validate; ${den.id} (${den.x},${den.y}) -> cliff site (${site.x},${site.y})`);

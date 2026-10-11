// findSite uses a summed-area table of blocked tiles instead of re-scanning
// every candidate rect tile by tile. This checks it still picks exactly the
// site the plain per-tile scan would, across random zones and option mixes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/temporary-locales.js', 'utf8');
const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);
const { findSite, DEFAULT_CLEARABLE_TYPES } = sandbox.TemporaryLocales;

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Plain reference: the pre-summed-area per-tile scan, same candidate order.
function referenceFindSite(zone, locale, opts) {
  const keys = Object.keys(locale.tiles).map(k => k.split(',').map(Number));
  const minC = Math.min(...keys.map(k => k[0])), maxC = Math.max(...keys.map(k => k[0]));
  const minR = Math.min(...keys.map(k => k[1])), maxR = Math.max(...keys.map(k => k[1]));
  const clearance = opts.clearanceTiles ?? 2;
  const w = maxC - minC + 1 + clearance * 2, h = maxR - minR + 1 + clearance * 2;
  if (w > zone.cols || h > zone.rows) return null;
  const clearable = opts.clearableTypes || DEFAULT_CLEARABLE_TYPES;
  const tileAt = (x, y) => zone.tiles[y]?.[x] || null;
  const blocked = (x, y) => {
    const t = tileAt(x, y);
    if (!t) return true;
    if (t.water || t.path || t.ramp || t.waterfall || t.invisiblePath) return true;
    if (!t.occupiedBy) return false;
    const obj = zone.objects.find(o => o.id === t.occupiedBy);
    if (!obj || obj.localeMeta) return true;
    return !clearable.has(obj.type);
  };
  const candidates = [];
  for (let y = 0; y <= zone.rows - h; y++) for (let x = 0; x <= zone.cols - w; x++) candidates.push({ x, y });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(opts.rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const c of candidates) {
    let ok = true, target = null;
    for (let yy = c.y; ok && yy < c.y + h; yy++) for (let xx = c.x; ok && xx < c.x + w; xx++) {
      if (blocked(xx, yy)) { ok = false; break; }
      const th = (tileAt(xx, yy).height) || 0;
      if (opts.requiresFlatGround !== false) {
        if (target === null) target = th;
        else if (Math.abs(th - target) > 0.05) ok = false;
      }
    }
    if (ok) return { x: c.x, y: c.y };
  }
  return null;
}

function makeZone(seed, cols, rows, objectCount) {
  const rand = lcg(seed);
  const tiles = [];
  for (let y = 0; y < rows; y++) {
    tiles.push([]);
    for (let x = 0; x < cols; x++) {
      tiles[y].push(rand() < 0.02 ? null : {
        height: rand() < 0.15 ? 1 : 0,
        water: rand() < 0.04,
        path: rand() < 0.03,
        ramp: false,
        waterfall: false,
        occupiedBy: null,
      });
    }
  }
  const objects = [];
  const types = ['tree', 'rock', 'unique', 'shrub', 'den'];
  for (let i = 0; i < objectCount; i++) {
    const x = Math.floor(rand() * cols), y = Math.floor(rand() * rows);
    objects.push({ id: `o${i}`, type: types[i % types.length], x, y, w: 1, h: 1, localeMeta: rand() < 0.2 });
    if (tiles[y][x]) tiles[y][x].occupiedBy = `o${i}`;
  }
  if (tiles[1]?.[1]) tiles[1][1].occupiedBy = 'missing-object'; // Unresolvable occupant must block.
  return { cols, rows, tiles, objects, entry: null };
}

const locale = { id: 'probe', tiles: { '0,0': {}, '3,2': {} }, placement: {} };
let compared = 0, placed = 0;
for (let seed = 1; seed <= 120; seed++) {
  const zone = makeZone(seed, 30 + (seed % 40), 24 + (seed % 30), (seed * 7) % 500);
  for (const opts of [{}, { requiresFlatGround: false }, { clearanceTiles: 0 }, { clearanceTiles: 1, clearableTypes: new Set(['tree']) }]) {
    const actual = findSite(zone, locale, { ...opts, rng: lcg(seed * 31) });
    const expected = referenceFindSite(zone, locale, { ...opts, rng: lcg(seed * 31) });
    assert.deepEqual(actual ? { x: actual.x, y: actual.y } : null, expected, `seed ${seed} ${JSON.stringify(opts)}`);
    compared++;
    if (expected) placed++;
  }
}
assert.ok(placed > 50 && placed < compared, `expected a mix of placed/unplaced cases, got ${placed}/${compared}`);
console.log(`ok - findSite matches the per-tile reference scan in ${compared} cases (${placed} placed)`);

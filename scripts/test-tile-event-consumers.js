'use strict';
// Fog reveal and Sense's ore-rock sweep must do their work on tile/area transitions, not on every tick.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// ---- WildernessMap fog reveal -------------------------------------------------
let listeners = new Set();
let worldLookups = 0, now = 0;
const store = new Map();
const player = { x: 5, y: 5 };
const ctx = {
  console, Map, Set, Math, Number, Object, Array, Uint8Array, JSON,
  btoa: v => Buffer.from(v, 'binary').toString('base64'), atob: v => Buffer.from(v, 'base64').toString('binary'),
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  document: { getElementById: () => null },
  WildernessMapGenerator: { zoneMapIds: () => ['zone'] },
  performance: { now: () => now },
  BanditCamps: { perceivedThreats: new Map() }, BountyBoard: { markers: new Map() },
  PlayerTileEvents: { subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('docs/js/wilderness-map.js', 'utf8'), ctx);
ctx.WildernessMap.init({
  _zoneLayouts: new Map([['zone', { cols: 40, rows: 40, tiles: [], localeInstances: [] }]]),
  tothalWorldId: () => { worldLookups++; return 'w'; }, currentTothalYear: () => 1,
  _isZoneArea: a => a === 'zone', getCurrentArea: () => 'zone', showToast() {}, player, TILE: 1, npcWalkers: [], WMAP_ZONE_LABELS: {},
});
assert.equal(listeners.size, 1, 'fog reveal subscribes to PlayerTileEvents');
ctx.WildernessMap.updateFogAroundPlayer();
const afterFirst = worldLookups;
assert(afterFirst > 0, 'first call reveals fog');
for (let i = 0; i < 100; i++) { now += 5; ctx.WildernessMap.updateFogAroundPlayer(); }
assert.equal(worldLookups, afterFirst, 'standing still does no lookups between events');
player.x = 6; for (const l of listeners) l({});
ctx.WildernessMap.updateFogAroundPlayer();
assert(worldLookups > afterFirst, 'a tile event triggers a reveal pass');
const afterEvent = worldLookups;
now += 1500; ctx.WildernessMap.updateFogAroundPlayer();
assert(worldLookups > afterEvent, 'idle recheck still catches world/year changes without an event');
ctx.WildernessMap.init({ ...{}, _zoneLayouts: new Map(), tothalWorldId: () => 'w', currentTothalYear: () => 1, _isZoneArea: () => false, getCurrentArea: () => 'x', showToast() {}, player, TILE: 1, npcWalkers: [], WMAP_ZONE_LABELS: {} });
assert.equal(listeners.size, 1, 're-init replaces rather than stacks the subscription');

// ---- Sense ore-rock sweep in game.js ------------------------------------------
const game = fs.readFileSync('docs/game.js', 'utf8');
const start = game.indexOf('const _senseOreCache');
const end = game.indexOf('\n      }\n', game.indexOf('function _nearbyOreRocksForSense')) + 9;
assert(start > 0 && end > start, 'helper present in game.js');
let area = 'zone', tick = 0, gets = 0, evListener = null;
const rocks = new Map([['10,10', { id: 'a' }], ['11,10', { id: 'b' }], ['90,90', { id: 'far' }]]);
const countingMap = new Proxy(rocks, { get(t, p) { const v = Reflect.get(t, p, t); if (p === 'get') return k => { gets++; return t.get(k); }; return typeof v === 'function' ? v.bind(t) : v; } });
const sandbox = {
  window: { PlayerTileEvents: { subscribe: fn => { evListener = fn; } }, PerceptionMode: { RANGE_TILES: 14 } },
  _zoneMineableRockMeshes: new Map([['zone', countingMap]]), performance: { now: () => tick },
  player: { x: 10, y: 10 }, TILE: 1, Infinity, Math,
};
Object.defineProperty(sandbox, 'currentArea', { get: () => area });
vm.createContext(sandbox);
vm.runInContext(game.slice(start, end) + '\nthis._fn = _nearbyOreRocksForSense;', sandbox);
const sweep = sandbox._fn;
const ids = () => Array.from(sweep(), r => r.id).join(',');
assert.equal(ids(), 'a,b', 'finds nearby rocks only');
const g1 = gets;
for (let i = 0; i < 20; i++) { tick += 20; sweep(); }
assert.equal(gets, g1, 'standing still reuses the cached sweep (no tile lookups)');
sandbox.player.x = 11; evListener({});
sweep();
assert(gets > g1, 'a tile event forces a fresh sweep');
const g2 = gets;
rocks.delete('11,10'); tick += 1500;
assert.equal(ids(), 'a', 'a mined rock disappears at the latest after the safety TTL');
assert(gets > g2, 'TTL rescan happened');
area = 'other';
assert.equal(sweep().length, 0, 'area without an index returns nothing');
console.log('PASS tile-event consumers: fog reveal and Sense ore sweep run on transitions, with idle/TTL safety nets');

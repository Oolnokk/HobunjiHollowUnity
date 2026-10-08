#!/usr/bin/env node
// Executes docs/js/slagothim-traders.js and docs/js/town-mine.js in a VM
// against small synthetic maps: Town Value spawn odds, road-preferring
// routing, the full caravan trip (road camp -> market -> home) with its
// notices, night halts, stock rules, buying, and save/restore.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const CF = 'map_southern_cloud_forest';

function makeZoneLayout() {
  // 40x60: road down column 20 from the town gate (top) to the trade exit (bottom),
  // grass elsewhere, a band of rock with one gap so the road is the sensible way.
  const cols = 40, rows = 60, tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let type = c === 20 ? 'path' : 'grass';
    if (r === 30 && c !== 20) type = 'rock';
    tiles.push({ c, r, type, elevTier: 0, incline: false });
  }
  return { cols, rows, tiles, toTownExit: { col: 20, row: 0 }, tradeExit: { col: 20, row: 59, side: 'south' }, buildings: [], dens: [], localeInstances: [] };
}

function makeHarness({ townValue = 3, season = 'Stormtide' } = {}) {
  const toasts = [];
  const window = {
    __farmLog: () => {},
    CalendarSystem: { constants: { TARGET_DAY_LENGTH_SECONDS: 672 }, currentSeason: () => ({ name: season }) },
    PorakanekiCamps: { occupiedSites: zoneId => zoneId === CF ? [{ x: 24, y: 40, w: 4, h: 4 }] : [] },
    FishCatalog: { entries: [
      { key: 'fish_summer', seasons: 'summer', sellPrice: 20 },
      { key: 'fish_spring', seasons: 'spring', sellPrice: 20 },
      { key: 'fish_winter', seasons: 'winter', sellPrice: 30 },
      { key: 'fish_any', seasons: 'any', sellPrice: 10 },
    ] },
    __hobunjiGameStarted: true,
    DevCompanion: { panels: new Map(), registerPanel(spec) { this.panels.set(spec.id, spec); return true; } },
    TrinketSystem: { DEFINITIONS: { harlyaoA: { id: 'harlyaoA', source: 'harlyaoRuin', attunementCost: 2, displayName: 'A' } }, grant: () => 'uid' },
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/town-mine.js'), 'utf8'), context);
  window.TownMine.restore({ townValue });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/slagothim-traders.js'), 'utf8'), context);
  const zone = makeZoneLayout();
  const townGrid = Array.from({ length: 30 }, (_, r) => Array.from({ length: 30 }, (_, c) => ({ type: r === 15 || c === 15 ? 'path' : 'grass' })));
  const calendar = { day: 10, time01: 8 / 24 };
  const ITEM_DEFS = {
    fish_summer: { label: 'Summer Fish', sellPrice: 20 }, fish_spring: { label: 'Spring Fish', sellPrice: 20 },
    fish_winter: { label: 'Winter Fish', sellPrice: 30 }, fish_any: { label: 'Any Fish', sellPrice: 10 },
    yellowDew: { label: 'Yellow Dew', sellPrice: 9, tags: ['Dry Season'] }, greenDew: { label: 'Green Dew', sellPrice: 9, tags: ['Wet Season'] },
  };
  const metals = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  metals.forEach((m, i) => { ITEM_DEFS[`bar_${m}`] = { label: `Bar ${i + 1}`, sellPrice: 4 + (i + 1) * 3 }; });
  const inventory = { gold: 10000 };
  let saves = 0;
  window.SlagothimTraders.init({
    calendar, inventory, ITEM_DEFS, BASE_PRICES: {},
    EXTERIOR_ZONES: {
      [CF]: { label: 'Southern Cloud Forest', townReturnCol: 15, townReturnRow: 28 },
      map_northern_cliffs: { label: 'Northern Cliffs', townReturnCol: 15, townReturnRow: 1 },
      map_western_slope: { label: 'Western Slope', townReturnCol: 1, townReturnRow: 15 },
      map_eastern_mire: { label: 'Eastern Mire', townReturnCol: 28, townReturnRow: 15 },
    },
    VERDIGRIS_METAL_KEYS: metals, metalBarItemKey: key => `bar_${key}`,
    getZoneLayout: id => (id === CF || id.startsWith('map_')) ? zone : null,
    getTownGrid: () => townGrid, isTownTileWalkable: () => true,
    getCurrentArea: () => 'farm', getPlayerTile: () => ({ col: 1, row: 1 }),
    tothalWorldId: () => 'test-world', showToast: message => toasts.push(message), save: () => { saves++; },
  });
  const T = window.SlagothimTraders;
  const step = hours => {
    calendar.time01 += hours / 24;
    while (calendar.time01 >= 1) { calendar.time01 -= 1; calendar.day += 1; }
    T.update(0.016);
  };
  return { window, T, calendar, toasts, inventory, zone, step, saves: () => saves };
}

// ── Town Value gates ─────────────────────────────────────────────────
{
  const { T, window } = makeHarness();
  const { dailySpawnChance, maxActiveCaravans } = T.__test;
  assert.equal(dailySpawnChance(0), 0, 'no caravans before Town Value rises');
  assert.ok(Math.abs(dailySpawnChance(1) - T.TUNING.DAILY_CHANCE_BASE) < 1e-9);
  assert.ok(dailySpawnChance(4) > dailySpawnChance(2), 'odds rise with Town Value');
  assert.equal(dailySpawnChance(50), T.TUNING.DAILY_CHANCE_MAX, 'odds are capped (never clockwork)');
  assert.equal(maxActiveCaravans(1), 1);
  assert.equal(maxActiveCaravans(T.TUNING.HIGH_TOWN_VALUE), 2);
  // TownMine sale bonus.
  assert.equal(window.TownMine.salePriceMultiplier(0), 1);
  assert.ok(Math.abs(window.TownMine.salePriceMultiplier(5) - 1.15) < 1e-9);
  assert.ok(Math.abs(window.TownMine.salePriceMultiplier(99) - 1.3) < 1e-9, 'sale bonus caps at +30%');
  assert.equal(window.TownMine.applySaleBonus(100, 5), 115);
  assert.equal(window.TownMine.applySaleBonus(0, 5), 0);
}

// ── Spawning only happens with Town Value >= 1 ──────────────────────
{
  const { T, step } = makeHarness({ townValue: 0 });
  for (let i = 0; i < 24 * 20; i++) step(1);
  assert.equal(T.debugSnapshot().caravans.length, 0, 'Town Value 0 never spawns a caravan');
}
{
  const { T, step } = makeHarness({ townValue: 10 });
  let seen = 0;
  for (let i = 0; i < 24 * 40; i++) { step(1); seen = Math.max(seen, T.debugSnapshot().caravans.length); }
  assert.ok(seen >= 1, 'high Town Value eventually spawns caravans');
  assert.ok(seen <= 2, 'never more than the active cap');
}

// ── Routing follows the road ─────────────────────────────────────────
{
  const { T, zone } = makeHarness();
  const grid = T.__test.buildZoneGrid('test', zone);
  const route = T.__test.findRoute(grid, { c: 5, r: 2 }, { c: 5, r: 57 });
  assert.ok(route, 'route found');
  const cols = route.map(index => index % grid.cols);
  assert.ok(cols.includes(20), 'route goes through the gap/road rather than through rock');
  assert.ok(route.every(index => grid.cost[index] >= 0), 'route never crosses blocked tiles');
}

// ── A full trip: arrival notice, road camp, market, home ────────────
{
  const { T, toasts, step, calendar } = makeHarness();
  const caravan = T.spawnCaravan(calendar.day, (calendar.day + calendar.time01) * 24);
  assert.ok(caravan, 'caravan spawned');
  assert.match(toasts[0], /southern road/, 'arrival is announced at the region entrance');
  assert.match(toasts[0], /market around/, 'arrival notice gives an ETA to the market');
  const firstLeg = T.__test.legRoute(caravan, 0);
  assert.equal(firstLeg.pauses[0]?.kind, 'camp', 'stops at the Porakaneki camp near the road');
  let sawMarket = false;
  for (let i = 0; i < 24 * 4 * 8 && T.debugSnapshot().caravans.length; i++) {
    step(0.25);
    if (caravan.legs[caravan.legIndex]?.area === 'town' && caravan.pauseLeft > 0) sawMarket = true;
  }
  assert.ok(sawMarket, 'caravan stops at the town market');
  assert.ok(toasts.some(t => /set up at the town market/.test(t)), 'market arrival is announced');
  assert.ok(toasts.some(t => /packing up/.test(t)), 'market departure is announced');
  assert.equal(T.debugSnapshot().caravans.length, 0, 'caravan leaves by the southern road and is removed');
}

// ── Night halts travel ───────────────────────────────────────────────
{
  const { T } = makeHarness();
  const caravan = T.__test.createCaravan(1);
  T.__test.legRoute(caravan, 0);
  caravan.dist = 3;
  T.__test.advance(caravan, 1 * 24 + 22, 4); // 22:00 -> 02:00
  assert.equal(caravan.dist, 3, 'no movement at night');
  T.__test.advance(caravan, 1 * 24 + 6, 1); // 06:00 -> 07:00
  assert.ok(caravan.dist > 3, 'moves again by day');
}

// ── Stock rules ──────────────────────────────────────────────────────
{
  const { T } = makeHarness({ townValue: 2, season: 'Stormtide' });
  const fish = T.__test.outOfSeasonFish('Stormtide').map(f => f.key).sort();
  assert.deepEqual([...fish], ['fish_summer', 'fish_winter'], 'only out-of-season fish');
  assert.deepEqual([...T.__test.outOfSeasonProduce('Stormtide')], ['yellowDew'], 'wet season sells dry-season produce');
  let mulberry = 7;
  const rng = () => { mulberry = (mulberry * 1103515245 + 12345) % 2147483648; return mulberry / 2147483648; };
  const counts = [0, 0, 0];
  for (let i = 0; i < 2000; i++) {
    const stock = T.__test.rollStock(rng, 2);
    const ceilingTier = 3; // Town Value 2 => metals up to tier 3.
    const high = stock.filter(e => e.kind === 'item' && /^bar_m(\d)$/.test(e.key) && Number(e.key.slice(5)) > ceilingTier).reduce((s, e) => s + e.qty, 0);
    counts[Math.min(2, high)]++;
    for (const entry of stock) assert.ok(entry.price > 0 && entry.qty > 0);
  }
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2] && counts[2] > 0, `high-tier bars: usually 0, sometimes 1, rarely 2 (${counts})`);
}

// ── Buying + save/restore ────────────────────────────────────────────
{
  const { T, inventory, calendar } = makeHarness();
  const caravan = T.spawnCaravan(calendar.day, null);
  caravan.stock = [{ id: 'item:fish_winter', kind: 'item', key: 'fish_winter', qty: 1, price: 66, label: 'Winter Fish' }];
  const result = T.buy(caravan.id, 'item:fish_winter');
  assert.equal(result.ok, true);
  assert.equal(inventory.fish_winter, 1);
  assert.equal(inventory.gold, 10000 - 66);
  assert.equal(T.buy(caravan.id, 'item:fish_winter').ok, false, 'limited stock');
  caravan.dist = 12.5;
  const saved = JSON.parse(JSON.stringify(T.serialize()));
  T.restore(null);
  assert.equal(T.debugSnapshot().caravans.length, 0);
  T.restore(saved);
  const restored = T.debugSnapshot().caravans[0];
  assert.equal(restored.id, caravan.id);
  assert.equal(restored.dist, 12.5);
  assert.deepEqual([...restored.stock], ['Winter Fish×0@66g']);
}

// ── Dev Companion panel ──────────────────────────────────────────────
(async () => {
  const { T, window } = makeHarness({ townValue: 0 });
  const panel = window.DevCompanion.panels.get('slagothim-traders');
  assert.ok(panel, 'registers a Dev Companion panel');
  assert.equal(panel.when(), true);
  assert.match(panel.render().summary, /TV 0/);
  assert.equal((await panel.onAction('townValue', { delta: 1 })).townValue, 1, '+1 raises Town Value through TownMine');
  assert.equal(window.TownMine.getTownValue(), 1);
  assert.equal((await panel.onAction('townValue', { value: 5 })).townValue, 5);
  const spawned = await panel.onAction('spawn', {});
  assert.equal(spawned.ok, true, 'spawn button brings a caravan in');
  const view = panel.render();
  assert.ok(view.actions.some(action => action.id === 'skip' && action.args.id === spawned.id), 'per-caravan controls are listed');
  const caravan = T.debugSnapshot().caravans[0];
  assert.equal((await panel.onAction('skip', { id: spawned.id })).ok, true);
  assert.notEqual(T.debugSnapshot().caravans[0].dist + T.debugSnapshot().caravans[0].pauseLeft, caravan.dist + caravan.pauseLeft, 'skip moves the caravan to its next stop');
  const refused = await panel.onAction('goTo', { id: spawned.id }); // Harness has no travelTo and the player is on the farm.
  assert.equal(refused.ok, false, 'Go to fails cleanly instead of teleporting within the wrong area');
  assert.equal((await panel.onAction('dismiss', { id: spawned.id })).ok, true);
  assert.equal(T.debugSnapshot().caravans.length, 0, 'dismiss removes it');
  console.log('slagothim traders: ok');
})().catch(error => { console.error(error); process.exit(1); });

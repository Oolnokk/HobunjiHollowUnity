'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/hud-update.js', 'utf8'); // Used to exercise the actual runtime lore-economy integration rather than duplicating its formulas here.
const timers = []; // Used to deterministically advance the post-contact trench verification without real wall-clock delays.
const toastLog = []; // Used to verify the mobile-visible dig reward feedback path remains available.
const tile = { type: 'grass', water: 0 }; // Used as the authoritative mutable reticle tile through fresh dig, re-dig, fill, and second fresh dig transitions.
const inventory = { gold: 1000, mulch: 7, ore_gold: 0 }; // Uses the legacy wallet key deliberately while asserting physical ore goes to its own stack.
const itemDefs = { // Provides a small economy surface sufficient to verify Mulch-relative gold and high-value bronze floors.
  mulch: { label: 'Mulch', sellPrice: 5 },
  ore_gold: { label: 'Gold Ore', sellPrice: 500 },
  bar_gold: { label: 'Gold Bar', sellPrice: 5000 },
  bar_lowTinBronze: { label: 'Low-Tin Bronze Bar', sellPrice: 25 },
  bar_tinBronze: { label: 'Tin Bronze Bar', sellPrice: 30 },
  bar_highTinBronze: { label: 'High-Tin Bronze Bar', sellPrice: 35 },
  bar_arsenicalBronze: { label: 'Arsenical Bronze Bar', sellPrice: 40 },
  bar_leadedBronze: { label: 'Leaded Bronze Bar', sellPrice: 45 },
};
const noopButton = { addEventListener() {} }; // Satisfies HudUpdate's existing item-scroll button initialization.
const fakeAudio = { playObjectSfxKey() { return true; } }; // Supplies the same configured contact boundary the live shovel uses.
const context = {
  console,
  Date,
  Math,
  Object,
  Number,
  JSON,
  WeakSet,
  Array,
  setTimeout(fn) { timers.push(fn); return timers.length; },
  document: { getElementById() { return null; }, body: null },
  window: {
    AudioSystem: fakeAudio,
    CalendarSystem: { currentSeason: () => ({ emoji: '', name: 'Test' }), getHour: () => 12, formatCalendarDate: () => 'Testday' },
    FormatUtils: { formatClock: () => '12:00', toolEmoji: () => '', actionName: value => value },
  },
};
vm.runInNewContext(source, context, { filename: 'hud-update.js' });

const deps = { // Mirrors only the HudUpdate dependencies touched during initialization and the lore-economy dig path.
  ITEM_DEFS: itemDefs,
  inventory,
  TileType: { TRENCH: 'trench' },
  itemPrev: noopButton,
  itemNext: noopButton,
  cycleActiveInventoryItem() {},
  refreshItemScroll() {},
  refreshActionBar() {},
  getReticleTile: () => ({ col: 3, row: 4 }),
  getActiveTileAt: () => tile,
  getCurrentArea: () => 'farm',
  showToast(message) { toastLog.push(message); },
  clampInventoryStack() {},
  buildInventoryGrid() {},
  saveMemberWorldData() {},
};
context.window.HudUpdate.init(deps);

assert.equal(itemDefs.ore_gold.sellPrice, 6, 'Gold Ore must sell for exactly one ganang more than Mulch');
assert.equal(itemDefs.bar_gold.sellPrice, 31, 'Gold Bar must remain cheap after refining common Gold Ore');
assert.equal(itemDefs.bar_lowTinBronze.sellPrice, 400, 'Low-Tin Bronze must receive the bronze value floor');
assert.equal(itemDefs.bar_tinBronze.sellPrice, 500, 'Tin Bronze must receive the bronze value floor');
assert.equal(itemDefs.bar_highTinBronze.sellPrice, 650, 'High-Tin Bronze must receive the bronze value floor');
assert.equal(context.window.HobunjiCurrencyLore.name, 'ganang', 'legacy inventory.gold must be presented as ganang currency');
assert.equal(context.window.HobunjiCurrencyLore.meaning, 'bronze money', 'ganang must explicitly mean bronze money rather than a metal name');
assert.equal(context.window.HobunjiCurrencyLore.kind, 'currency', 'ganang must be classified as currency, never as a metal or ore');
assert.equal(context.window.HobunjiCurrencyLore.suffix, 'g', 'the Tankan-script g glyph remains the currency suffix');

const formatCurrencyText = context.window.HobunjiCurrencyLore.formatText; // Uses the same conservative renderer installed in the browser for legacy UI copy.
assert.equal(formatCurrencyText('Not enough gold.'), 'Not enough ganang.', 'legacy insufficient-funds copy must call the currency ganang');
assert.equal(formatCurrencyText("Not enough gold for the smith's labor."), "Not enough ganang for the smith's labor.", 'smith labor copy must call the currency ganang');
assert.equal(formatCurrencyText('Reward: 25 gold'), 'Reward: 25 ganang', 'spelled-out numeric currency rewards must become ganang');
assert.equal(formatCurrencyText('Gold reward'), 'Ganang reward', 'currency reward labels must become ganang');
assert.equal(formatCurrencyText('Gold Ore'), 'Gold Ore', 'physical Gold Ore names must remain gold');
assert.equal(formatCurrencyText('1 Gold Ore'), '1 Gold Ore', 'counted physical Gold Ore must never become ganang ore');
assert.equal(formatCurrencyText('12 gold ores'), '12 gold ores', 'lowercase/plural counted Gold Ore must never become ganang ore');
assert.equal(formatCurrencyText('Gold Bar'), 'Gold Bar', 'physical Gold Bar names must remain gold');
assert.equal(formatCurrencyText('3 Gold Bars'), '3 Gold Bars', 'counted physical Gold Bars must never become ganang bars');
assert.equal(formatCurrencyText('2 gold ingots'), '2 gold ingots', 'other counted physical gold forms must remain gold');
assert.equal(formatCurrencyText('gold-colored trim'), 'gold-colored trim', 'ordinary color language must not be rewritten as currency');

for (const file of [ // These are the known legacy callers from the repo-wide copy audit; their rendered insufficient-funds text is normalized centrally without renaming internal wallet fields.
  'docs/js/metal-craft-shop.js',
  'docs/js/farm-crates.js',
  'docs/js/farm-panel.js',
  'docs/js/combat/combat-core.js',
  'docs/js/barn-incubator.js',
]) {
  const fileText = fs.readFileSync(file, 'utf8');
  const matches = fileText.match(/Not enough gold[^'"`\n]*/gi) || [];
  for (const legacyCopy of matches) {
    assert(!/Not enough gold/i.test(formatCurrencyText(legacyCopy)), `${file} legacy currency copy must normalize to ganang at render time`);
  }
}

context.window.AudioSystem.playObjectSfxKey('dig');
assert.equal(inventory.ore_gold, 0, 'contact alone must never mint ore before the tile actually becomes a hole');
tile.type = 'trench';
while (timers.length) timers.shift()();
assert.equal(inventory.ore_gold, 1, 'a real non-trench -> trench transition must award exactly one Gold Ore');
assert.ok(toastLog.includes('Dug up 1 Gold Ore.'), 'fresh-hole gold needs mobile-visible feedback');

context.window.AudioSystem.playObjectSfxKey('dig');
while (timers.length) timers.shift()();
assert.equal(inventory.ore_gold, 1, 're-digging an existing trench must not award more Gold Ore');

tile.type = 'grass';
context.window.AudioSystem.playObjectSfxKey('dig');
tile.type = 'trench';
while (timers.length) timers.shift()();
assert.equal(inventory.ore_gold, 2, 'filling then digging a genuinely new hole must award Gold Ore again');
assert.equal(inventory.gold, 1000, 'dig rewards must never mutate the legacy ganang wallet field');

const mineConfig = JSON.parse(fs.readFileSync('docs/config/town-mine.json', 'utf8')); // Used to keep physical gold out of both mine ore bands and ladder prestige requirements.
assert(!mineConfig.oreTierOreKeys.flat().includes('gold'), 'Gold must not spawn as a high-tier town-mine ore');
assert(!mineConfig.ladderMetalKeys.includes('gold'), 'Gold must not remain the prestige ladder metal');

console.log('lore economy regression: ok');

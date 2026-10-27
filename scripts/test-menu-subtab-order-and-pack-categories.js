'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Supplies the production pack category classifier to these checks.
const navSource = fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8'); // Supplies controller section priorities without duplicating their logic.
const inventorySource = fs.readFileSync('docs/js/inventory-ui.js', 'utf8'); // Confirms clothing participates in its new Pack tab.
const htmlSource = fs.readFileSync('docs/index.html', 'utf8'); // Confirms the authored category buttons and section ids are present.

function between(source, start, end) {
  const from = source.indexOf(start); // First boundary locates the exact production function/constant.
  const until = source.indexOf(end, from + start.length); // Next declaration is the end of the extracted unit.
  assert(from >= 0 && until > from, `Could not find source boundaries for ${start}`);
  return source.slice(from, until);
}

const itemDefs = { // Representative existing and future item families exercise overlapping filters.
  fish: { cat: 'material', tags: ['Fish'] },
  copperOre: { cat: 'material', tags: ['Ore'] },
  bronzeBar: { cat: 'material', tags: ['Metal Bar'] },
  herb: { cat: 'material', tags: ['Reagent', 'Alchemy'] },
  meat: { cat: 'material', tags: ['Meat'] },
  bread: { cat: 'processed', tags: ['Food'] },
  seeds: { cat: 'seed', tags: [] },
  crate: { cat: 'livestock', tags: ['Livestock'] },
  pick: { cat: 'tool', tags: ['Tool'] },
  lyre: { cat: 'instrument', tags: ['Instrument'] },
  scroll: { cat: 'scroll', tags: ['Scroll'] },
  deed: { cat: 'buildingPlan', tags: ['Deed'] },
  dye: { cat: 'dye', tags: ['Dye'] },
  log: { cat: 'material', tags: ['Wood'] },
  unknown: { cat: 'curiosity', tags: [] },
  taggedOther: { cat: 'other', tags: ['Food'] },
  potionRecipe: { cat: 'processed', tags: ['Alchemy', 'Recipe'] },
  barnPlan: { cat: 'processed', tags: ['Building Plan'] },
  nonReagentPotion: { cat: 'processed', tags: ['Alchemy'] },
  animalBaby: { cat: 'material', tags: [] },
  cookedMeal: { cat: 'food', tags: ['Cooked Food'] },
};
const classifierSource = between(gameSource, '      function matchesPackCategory(cat, key) {', '      function getInventoryStackKeys(cat = \'all\') {'); // Uses actual shipping/pack classification helper.
const matches = vm.runInNewContext(classifierSource + '\n matchesPackCategory', { ITEM_DEFS: itemDefs }); // Test the real function against an intentionally small catalog.
for (const [category, key, expected] of [
  ['all', 'fish', true], ['fish', 'fish', true], ['fish', 'log', false],
  ['food', 'fish', true], ['food', 'cookedMeal', true],
  ['ore', 'copperOre', true], ['ore', 'bronzeBar', true], ['reagent', 'herb', true],
  ['food', 'bread', true], ['food', 'meat', true], ['processed', 'bread', true],
  ['material', 'fish', true], ['seed', 'seeds', true], ['livestock', 'crate', true],
  ['tool', 'pick', true], ['tool', 'lyre', true], ['plans', 'scroll', true],
  ['plans', 'deed', true], ['dye', 'dye', true], ['other', 'unknown', true],
  ['other', 'log', false], ['clothing', 'fish', false],
  ['other', 'taggedOther', false], ['food', 'taggedOther', true],
  ['plans', 'potionRecipe', true], ['plans', 'barnPlan', true],
  ['reagent', 'nonReagentPotion', false],
]) {
  assert.equal(matches(category, key), expected, `${category} correctly filters ${key}`);
}

const mapSource = between(navSource, '  const MENU_SUBTAB_PRIORITY_BY_PANE = Object.freeze({', '  const subtabsByGroup = new Map();'); // Preserves the real per-pane configuration.
const sorterSource = between(navSource, '  function prioritizeMenuSubtabs(group, sections) {', '  function prepareSubtabs(group, panel, selectedId = null, offset = 0) {'); // Uses the real LB/RB sequence sorter.
const prioritize = vm.runInNewContext(mapSource + '\n' + sorterSource + '\n prioritizeMenuSubtabs'); // Tests navigation without mounting a browser.
function ordered(paneId, ids) {
  const fakeOwner = { closest: () => ({ id: paneId }) }; // Models a group's owning pause-menu pane.
  return Array.from(prioritize(fakeOwner, ids.map(id => ({ id }))), section => section.id);
}
assert.deepEqual(ordered('mpFarm', ['farmSectionCustomize', 'farmSectionStorage', 'farmSectionLayout', 'farmSectionLivestock']), ['farmSectionLayout', 'farmSectionLivestock', 'farmSectionStorage', 'farmSectionCustomize']);
assert.deepEqual(ordered('mpTasks', ['tasksSectionWanted', 'tasksSectionRumors', 'tasksSectionQuestLog']), ['tasksSectionQuestLog', 'tasksSectionRumors', 'tasksSectionWanted']);
assert.deepEqual(ordered('mpSettings', ['settingsSection0', 'settingsSection7', 'settingsSectionAudio']), ['settingsSectionAudio', 'settingsSection7', 'settingsSection0']);
assert.deepEqual(ordered('unknown', ['first', 'second']), ['first', 'second'], 'Unconfigured/dynamic pane orders remain untouched');

const categories = [...htmlSource.matchAll(/class="inv-cat(?: active)?" data-cat="([^"]+)"/g)].map(match => match[1]); // Matches the real Pack filter bar, not the shipping filters.
assert.equal(new Set(categories).size, 16, 'Sixteen distinct Pack filters are present');
assert.equal(categories[0], 'all', 'All remains the default and first choice');
for (const category of ['food', 'fish', 'ore', 'reagent', 'livestock', 'tool', 'clothing', 'plans', 'dye', 'other']) {
  assert(categories.includes(category), `Pack filter ${category} is reachable`);
}
for (const sectionId of ['tasksSectionQuestLog', 'tasksSectionWanted', 'tasksSectionRumors', 'invGridArea']) {
  assert(htmlSource.includes(`id="${sectionId}"`), `Stable navigation target ${sectionId} exists`);
}
const mainTabs = [...htmlSource.matchAll(/class="mp-tab(?: active)?"\s+data-mpanel="([^"]+)"/g)].map(match => match[1]); // DOM order drives actual bumper navigation between main pages.
assert.deepEqual(mainTabs.slice(0, 11), ['inventory', 'loadout', 'progress', 'crafting', 'map', 'tasks', 'calendar', 'farm', 'stable', 'relationships', 'settings'], 'Main tabs keep Character, World, Home and System destinations together');
assert.equal(new Set(mainTabs).size, mainTabs.length, 'No main tab is duplicated or lost');
assert(inventorySource.includes("activeCategory === 'clothing'"), 'Clothing tiles appear on their dedicated filter');
assert(inventorySource.includes('const searchQuery = window.InventorySearch?.query'), 'Clothing respects the Pack search field');


class ClothingButton {
  constructor(uid, label) {
    this.uid = uid; this.textContent = label; this.children = []; this.clicks = 0;
  }
  getAttribute(key) { return key === 'data-key' ? this.uid : null; }
  querySelector() { return null; }
  click() { this.clicks++; }
}
class ClothingTile {
  constructor() {
    this.dataset = {}; this.style = {}; this.className = '';
    this.classList = { add() {}, remove() {} };
    this.children = []; this.handlers = {};
  }
  setAttribute(key, value) { if (key === 'data-key') this.dataset.key = value; }
  appendChild(child) { this.children.push(child); }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  click() { this.handlers.click(); }
  remove() { const index = clothingGrid.tiles.indexOf(this); if (index >= 0) clothingGrid.tiles.splice(index, 1); }
}
let sourceButtons = [new ClothingButton('jacket-1', 'Émbroidered Jacket')]; // First authoring pass, later replaced with a new DOM button with the same appearance.
let activeCategory = 'clothing'; // Simulates Pack tab/filter selection.
let clothingSearch = ''; // Simulates the shared normalized inventory search query.
const clothingSource = { querySelectorAll: () => sourceButtons }; // Mirrors the hidden live clothing renderer.
const clothingGrid = {
  dataset: {}, tiles: [],
  querySelectorAll(selector) { return selector === '.pack-clothing-tile' ? this.tiles : []; },
  querySelector() { return null; },
  appendChild(tile) { tile.parentNode = this; this.tiles.push(tile); },
};
const clothingDocument = {
  getElementById(id) { return id === 'invPackClothing' ? clothingSource : id === 'invGrid' ? clothingGrid : null; },
  querySelector() { return { dataset:{ cat:activeCategory } }; },
  querySelectorAll() { return []; },
  createElement() { return new ClothingTile(); },
};
const clothingWindow = { InventorySearch:{
  get query() { return clothingSearch; },
  matches(key, def) { return (key + ' ' + def.label).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').includes(clothingSearch); },
} };
const clothingSourceCode = between(inventorySource, '  function syncPackClothingTiles() {', '  function decoratePackSlots() {'); // Exercises the real Pack clothing tile synchronization.
const syncClothingTiles = vm.runInNewContext(clothingSourceCode + '\n syncPackClothingTiles', { document:clothingDocument, window:clothingWindow });
syncClothingTiles();
assert.equal(clothingGrid.tiles.length, 1, 'Clothing appears even when the stack grid has no items');
const originalButton = sourceButtons[0]; // Captured only for verifying it is no longer used after a rebuild.
sourceButtons = [new ClothingButton('jacket-1', 'Émbroidered Jacket')]; // Identical visual fingerprint, new action owner.
syncClothingTiles();
clothingGrid.tiles[0].click();
assert.equal(sourceButtons[0].clicks, 1, 'Tile invokes the current clothing action after rerender');
assert.equal(originalButton.clicks, 0, 'Tile does not invoke stale clothing actions');
activeCategory = 'other';
syncClothingTiles();
assert.equal(clothingGrid.tiles[0].style.display, 'none', 'Other does not show clothing');
activeCategory = 'clothing'; clothingSearch = 'embroidered';
syncClothingTiles();
assert.equal(clothingGrid.tiles[0].style.display, '', 'Clothing search uses accented-name normalization');
clothingSearch = 'not-present';
syncClothingTiles();
assert.equal(clothingGrid.tiles[0].style.display, 'none', 'Unmatched clothing search hides tile');
assert(gameSource.includes('const packClothingVisible'), 'Empty-state messaging handles searches containing only clothing');

console.log('Pack categories, live clothing actions/search, and frequency-first menu navigation passed');

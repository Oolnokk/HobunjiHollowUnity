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
};
const classifierSource = between(gameSource, '      function matchesPackCategory(cat, key) {', '      function getInventoryStackKeys(cat = \'all\') {'); // Uses actual shipping/pack classification helper.
const matches = vm.runInNewContext(classifierSource + '\n matchesPackCategory', { ITEM_DEFS: itemDefs }); // Test the real function against an intentionally small catalog.
for (const [category, key, expected] of [
  ['all', 'fish', true], ['fish', 'fish', true], ['fish', 'log', false],
  ['ore', 'copperOre', true], ['ore', 'bronzeBar', true], ['reagent', 'herb', true],
  ['food', 'bread', true], ['food', 'meat', true], ['processed', 'bread', true],
  ['material', 'fish', true], ['seed', 'seeds', true], ['livestock', 'crate', true],
  ['tool', 'pick', true], ['tool', 'lyre', true], ['plans', 'scroll', true],
  ['plans', 'deed', true], ['dye', 'dye', true], ['other', 'unknown', true],
  ['other', 'log', false], ['clothing', 'fish', false],
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
assert(inventorySource.includes("activeCategory === 'clothing'"), 'Clothing tiles appear on their dedicated filter');
assert(inventorySource.includes('const searchQuery = window.InventorySearch?.query'), 'Clothing respects the Pack search field');

console.log('Pack categories, clothing search, and frequency-first controller sub-tabs passed');

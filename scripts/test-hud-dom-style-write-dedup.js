'use strict';

// Executes the shipped HUD renderers with tracked DOM writes, without a browser or WebGL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..'); // Used to load the runtime modules under test.

function trackedElement() {
  const writes = []; // Used to assert redundant render calls cause no DOM mutations.
  const state = { textContent: '', innerHTML: '', className: '' }; // Used as observable property storage.
  const classes = new Set(); // Tracks the visible/open class on prompt roots.
  const element = { writes, dataset: {}, style: new Proxy({}, {
    set(target, property, value) { writes.push('style.' + String(property)); target[property] = value; return true; },
  }) };
  for (const property of ['textContent', 'innerHTML', 'className']) {
    Object.defineProperty(element, property, {
      get() { return state[property]; },
      set(value) { writes.push(property); state[property] = value; },
      configurable: true,
    });
  }
  element.classList = {
    contains(name) { return classes.has(name); },
    add(name) { writes.push('classList.add'); classes.add(name); },
    remove(name) { writes.push('classList.remove'); classes.delete(name); },
  };
  return element;
}

function createBuffRoot() {
  const bar = trackedElement(); // Supplies the two selectors resolved after each structural rebuild.
  let markup = '';
  let fills = [];
  let fractions = [];
  bar.markupWrites = 0;
  Object.defineProperty(bar, 'innerHTML', {
    get() { return markup; },
    set(value) {
      bar.markupWrites++;
      markup = value;
      fills = Array.from(value.matchAll(/data-fill="([^"]+)"/g), match => {
        const element = trackedElement(); element.dataset.fill = match[1]; return element;
      });
      fractions = Array.from(value.matchAll(/data-fraction="([^"]+)"/g), match => {
        const element = trackedElement(); element.dataset.fraction = match[1]; return element;
      });
    },
  });
  bar.querySelectorAll = selector => {
    bar.selectorReads = (bar.selectorReads || 0) + 1;
    if (selector.includes('data-fill')) return fills;
    if (selector.includes('data-fraction')) return fractions;
    throw new Error('Unexpected buff selector: ' + selector);
  };
  bar.fills = () => fills;
  bar.fractions = () => fractions;
  return bar;
}

let buffRoot = createBuffRoot(); // Swapped later to verify cache invalidation on DOM-root replacement.
const buffWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/effect-buff-bar.js'), 'utf8'), {
  window: buffWindow, document: { getElementById: () => buffRoot },
});
let seconds = 3600; // Provider countdown used to exercise quantized progress updates.
let fraction = '2/10'; // Provider text used to verify live fraction changes without icon rebuild.
buffWindow.EffectBuffBar.registerProvider('alchemy', () => [{
  key: 'boost', label: 'Boost', icon: '*', remainingS: seconds, durationS: 3600, fractionLabel: fraction,
}]);
assert.equal(buffRoot.markupWrites, 1, 'first effect builds the icon once');
const firstWidthWrites = buffRoot.fills()[0].writes.length; // Tracks unnecessary countdown reassignments.
const firstSelectorReads = buffRoot.selectorReads; // Proves steady-state refresh never performs DOM queries.
for (let i = 0; i < 10; i++) buffWindow.EffectBuffBar.refresh();
assert.equal(buffRoot.markupWrites, 1, 'unchanged effect list retains markup');
assert.equal(buffRoot.selectorReads, firstSelectorReads, 'steady-state uses cached DOM nodes');
assert.equal(buffRoot.fills()[0].writes.length, firstWidthWrites, 'unchanged countdown does not rewrite width');
seconds = 3599;
buffWindow.EffectBuffBar.refresh();
assert.equal(buffRoot.fills()[0].writes.length, firstWidthWrites, 'sub-tenth-percent countdown does not invalidate style');
seconds = 3400;
buffWindow.EffectBuffBar.refresh();
assert.equal(buffRoot.fills()[0].style.width, '94.4%', 'meaningful countdown change still repaints');
fraction = '1/10';
buffWindow.EffectBuffBar.refresh();
assert.equal(buffRoot.markupWrites, 1, 'fraction update does not replace icon markup');
assert.equal(buffRoot.fractions()[0].textContent, '1/10', 'fraction update retains live text');
assert(buffWindow.EffectBuffBar.getDebug().skippedWrites > 10, 'mobile diagnostics track skipped writes');
buffRoot = createBuffRoot();
buffWindow.EffectBuffBar.refresh();
assert.equal(buffRoot.markupWrites, 1, 'replaced HUD root rebuilds its cached icons');
seconds = 0;
buffWindow.EffectBuffBar.refresh();
assert.equal(buffRoot.style.display, 'none', 'expired effect hides the bar');

const elements = new Map(); // Supplies stable pre-existing child nodes for the action prompt.
for (const id of ['actionPrompt', 'apBtn', 'apCancel', 'apStatus', 'apPanicWrap', 'apPanicFill']) {
  elements.set(id, trackedElement());
}
const promptWindow = { InputBindings: { buttonLabel: binding => binding } };
const promptDocument = {
  getElementById: id => elements.get(id) || null,
  createElement: () => trackedElement(),
  head: { appendChild() {} },
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/action-prompt-ui.js'), 'utf8'), {
  window: promptWindow, document: promptDocument,
});
promptWindow.ActionPromptUI.init({
  inputBindings: { desktop: { interact: 'E' }, controller: { interact: 'A' } },
  getLastInputDevice: () => 'desktop',
});
let pressed = 0; // Used to verify retained handlers call the current action, not the original action.
const promptOptions = {
  actionId: 'interact', verb: 'Cast', cancelText: 'Cancel', statusText: 'Ready',
  statusType: 'good', panicPercent: 30,
  onPress: () => { pressed += 1; }, onCancel: () => { pressed += 10; },
};
promptWindow.ActionPromptUI.showActionPrompt(promptOptions);
const promptWrites = () => [...elements.values()].reduce((sum, el) => sum + el.writes.length, 0);
const firstPromptWrites = promptWrites(); // Snapshot after the initial visible DOM setup.
const originalHandler = elements.get('apBtn').onpointerup; // The same handler must survive callback replacement.
promptWindow.ActionPromptUI.showActionPrompt({
  ...promptOptions, onPress: () => { pressed += 2; }, onCancel: () => { pressed += 20; },
});
assert.equal(promptWrites(), firstPromptWrites, 'identical prompt refresh performs no DOM writes');
assert.equal(elements.get('apBtn').onpointerup, originalHandler, 'pointer handler stays stable');
elements.get('apBtn').onpointerup({ stopPropagation() {} });
elements.get('apCancel').onpointerup({ stopPropagation() {} });
assert.equal(pressed, 22, 'latest action and cancel callbacks are dispatched');
promptWindow.ActionPromptUI.showActionPrompt({ ...promptOptions, panicPercent: 45 });
assert.equal(elements.get('apPanicFill').style.width, '45%', 'changing panic still updates the bar');
const beforeHide = promptWrites(); // Used to confirm hiding the same prompt twice is idempotent.
promptWindow.ActionPromptUI.hideActionPrompt();
assert.equal(promptWrites(), beforeHide + 1, 'hiding removes the open class once');
promptWindow.ActionPromptUI.hideActionPrompt();
assert.equal(promptWrites(), beforeHide + 1, 'already hidden prompt is not mutated');
elements.get('apBtn').onpointerup({ stopPropagation() {} });
assert.equal(pressed, 22, 'retained handler cannot activate a hidden prompt');
assert(promptWindow.ActionPromptUI.getDebug().skippedWrites > 0, 'prompt diagnostics track skipped writes');

// The status-pill writer is exercised through the real module as well.
const hudWindow = {
  CalendarSystem: { currentSeason: () => ({ emoji: '*', name: 'Summer' }), getHour: () => 9, formatCalendarDate: () => 'Day 1' },
  FormatUtils: { formatClock: () => '09:00', toolEmoji: () => '*', actionName: () => 'Work' },
};
const pill = {}; // Collects one tracked element per live status HUD field.
for (const field of ['spSeason', 'spWeather', 'spTime', 'spDay', 'spTool', 'spTile', 'spWater', 'spGoldAmount', 'spItem', 'spItemDiv', 'itemIcon', 'itemName', 'itemCount', 'itemBtnEl', 'isPrevIconEl', 'isNextIconEl']) {
  pill[field] = trackedElement();
}
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/hud-update.js'), 'utf8'), {
  window: hudWindow, document: { body: null }, console,
});
const item = { key: 'seed', label: 'Seed', icon: '*' }; // Used by the desktop pill and item-scroll presentation.
const tile = { type: 'grass', water: 0 }; // Used by the reticle field renderer.
const deps = {
  ...pill, itemPrev: { addEventListener() {} }, itemNext: { addEventListener() {} },
  ITEM_DEFS: {}, TOOL_ITEM_DEFS: {}, inventory: { gold: 7, seed: 2 }, calendar: { isRaining: false, weather: 'clear' },
  tileStyles: { grass: { label: 'Grass' } }, MAX_WATER: 100, RAIN_RATE: 1,
  getInventoryStackItems: () => [item], getActiveInventoryItem: () => item,
  getActiveItemIndex: () => 0, getReticleTile: () => ({ col: 0, row: 0 }),
  getActiveTileAt: () => tile, getHeldMode: () => 'none', getActiveTool: () => 'hoe',
  getActiveAction: () => 'till', getCurrentArea: () => 'farm', getIsDesktop: () => true,
  isDesktop: true, isMenuOpen: () => false, refreshActionBar() {},
  itemIconForKey: () => null, applyItemSpriteIcon() {}, clearItemSpriteIcon() {},
  equipmentSlots: {},
};
hudWindow.HudUpdate.init(deps);
hudWindow.HudUpdate.updateHud();
const itemStyleWrites = pill.spItem.writes.filter(entry => entry === 'style.display').length;
const dividerStyleWrites = pill.spItemDiv.writes.filter(entry => entry === 'style.display').length;
hudWindow.HudUpdate.updateHud();
assert.equal(pill.spItem.writes.filter(entry => entry === 'style.display').length, itemStyleWrites, 'desktop item style does not rewrite every frame');
assert.equal(pill.spItemDiv.writes.filter(entry => entry === 'style.display').length, dividerStyleWrites, 'desktop item divider style does not rewrite every frame');

console.log('HUD DOM style-write dedup regression checks passed.');

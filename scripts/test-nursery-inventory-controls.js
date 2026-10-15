'use strict';

const assert = require('node:assert/strict'); // Assertions for the production Nursery header and Pack actions.
const fs = require('node:fs'); // Reads the shipped UI functions without duplicating their behavior.
const vm = require('node:vm'); // Executes UI functions with small deterministic DOM/dependency stand-ins.
const gridSource = fs.readFileSync('docs/js/livestock-nursery-grid.js', 'utf8'); // Source of the enhanced Farm header.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Source of the selected Pack item's destination actions.

function gridFunction(name) {
  const start = gridSource.indexOf(`  function ${name}(`); // Start of the real production function.
  const end = gridSource.indexOf('\n  function ', start + 1); // Next top-level function bounds the extracted body.
  assert.ok(start >= 0 && end > start, `${name} is available`);
  return gridSource.slice(start, end);
}

let collapsed = true; // Authoritative Nursery state as read from the existing disclosure.
let labelWrites = 0; // Detects repeated light-DOM text mutations that could wake the legacy Nursery observer.
let labelText = ''; // Stores the label behind the instrumented title's textContent accessor.
const title = { // Minimal button stand-in used to inspect the visible count and accessible disclosure state.
  attributes: {},
  get textContent() { return labelText; },
  set textContent(value) { labelWrites++; labelText = value; },
  setAttribute(key, value) { this.attributes[key] = value; },
};
const shadow = { getElementById: id => id === 'title' ? title : null }; // Header-only shadow DOM fixture.
const section = { // Keeps legacy disclosure state and the enhanced header in the same section.
  dataset: {},
  shadowRoot: null,
  attachShadow() { this.shadowRoot = shadow; return shadow; },
  querySelector: selector => selector === '.nursery-grid-disclosure' ? title : { getAttribute: () => String(!collapsed) },
};
const headerContext = vm.createContext({ // Only the production header's dependencies are supplied.
  window: { LivestockNursery: { toggleFarmInventory() { collapsed = !collapsed; } } },
});
vm.runInContext(`${gridFunction('buildShadow')}\n${gridFunction('updateHeader')}`, headerContext);
headerContext.buildShadow(section);
assert.match(shadow.innerHTML, /<slot name="disclosure"><\/slot>/, 'enhanced header projects the light-DOM disclosure into the visible header');
headerContext.updateHeader(section, [{ id: 'saved_baby' }]);
assert.equal(title.attributes['aria-expanded'], 'false');
assert.equal(title.hidden, false, 'grid reveals the controller-discoverable light-DOM disclosure');
assert.equal(section.dataset.nurseryCollapsed, '1');
assert.match(title.textContent, /▸.*1 babies/, 'collapsed header still shows saved baby count and expand arrow');
headerContext.updateHeader(section, [{ id: 'saved_baby' }]);
assert.equal(labelWrites, 1, 'unchanged header decoration does not emit another light-DOM text mutation');
headerContext.window.LivestockNursery.toggleFarmInventory();
headerContext.updateHeader(section, [{ id: 'saved_baby' }]);
assert.equal(title.attributes['aria-expanded'], 'true', 'visible header opens the same inventory as the legacy disclosure');
assert.equal(section.dataset.nurseryCollapsed, '0', 'expanded header releases the grid from collapsed styling');
headerContext.window.LivestockNursery.toggleFarmInventory();
headerContext.updateHeader(section, [{ id: 'saved_baby' }]);
assert.equal(title.attributes['aria-expanded'], 'false', 'visible header also collapses the inventory');

const menuStart = gameSource.indexOf('          if (LIVESTOCK_ITEM_KINDS[key] && count > 0) {'); // Actual animal/egg action block in selectInventoryItem.
const menuEnd = gameSource.indexOf("          mkBtn('Drop  (coming soon)'", menuStart); // Bounds only the deployment actions.
assert.ok(menuStart >= 0 && menuEnd > menuStart);
const menuSource = gameSource.slice(menuStart, menuEnd); // Executes shipped button wiring, including callback bodies.

for (const key of ['grehlrCrate', 'drenkirraEgg']) {
  for (const ok of [true, false]) {
    const buttons = []; // Captures visible action ordering and executable callbacks.
    const calls = []; // Captures the deployment destination and selected genotype variant.
    const refreshes = []; // Ensures failed/permission-denied transfers do not trigger success refreshes or saves.
    const context = vm.createContext({
      key, count: 2, stack: { variant: 'selected-genotype' },
      LIVESTOCK_ITEM_KINDS: { grehlrCrate: 'grehlr', drenkirraEgg: 'drenkirra' },
      mkBtn(label, style, callback) { buttons.push({ label, callback }); },
      showToast() {},
      buildInventoryGrid() { refreshes.push('inventory'); },
      refreshActionBar() { refreshes.push('actions'); },
      saveMemberWorldData() { refreshes.push('save'); },
      window: {
        FarmAnimals: {
          addFromItem(item, options) { calls.push({ item, options }); return { ok, message: 'transfer result' }; },
          addToStable() { throw new Error('Nursery button must use the farm destination'); },
        },
        HudUpdate: { refreshItemScroll() { refreshes.push('hud'); } },
        FarmPanel: { render() { refreshes.push('farm'); } },
      },
    });
    vm.runInContext(menuSource, context);
    assert.deepEqual(buttons.map(button => button.label), ['Add to Nursery', 'Add to Stable'], 'Nursery precedes Stable for babies and fertile eggs');
    buttons[0].callback();
    assert.equal(calls.length, 1, 'one click attempts exactly one transfer');
    assert.equal(calls[0].item, key);
    assert.equal(calls[0].options.inventoryVariant, 'selected-genotype', 'deployment receives the exact selected animal/egg stack');
    assert.deepEqual(refreshes, ok ? ['inventory', 'hud', 'actions', 'save', 'farm'] : [], 'only successful transfers persist and refresh both inventories');
    buttons.length = 0;
    context.count = 0;
    vm.runInContext(menuSource, context);
    assert.equal(buttons.length, 0, 'exhausted stacks cannot offer deployment');
    context.count = 1;
    context.key = 'stone';
    vm.runInContext(menuSource, context);
    assert.equal(buttons.length, 0, 'ordinary items never offer animal deployment');
  }
}

console.log('Nursery inventory header and Pack destination controls passed.');

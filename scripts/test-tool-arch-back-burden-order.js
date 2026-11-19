'use strict';
// Exercises the real radial tool selector with and without a back-carried Burden.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/action-arc-ui.js'), 'utf8'); // Production presenter under test.

function makeHarness(initialBurden, initialTool = 'adventuring') {
  const elements = []; // Records DOM slots in rendered order for assertions.
  const selectedTools = []; // Detects accidental tool switches while browsing the burden.
  let burden = initialBurden; // Simulates the burden being picked up or removed between openings.
  let activeTool = initialTool; // Supplies the production selector's currently held tool.
  let takeCount = 0; // Counts actual take-from-back commits.

  function createElement() {
    const el = {
      className: '', innerHTML: '', style: {}, removed: false,
      remove() { this.removed = true; },
    }; // Minimal DOM element carrying the same CSS class and content the real arch writes.
    el.classList = {
      add(name) {
        if (!el.className.split(' ').includes(name)) el.className += ' ' + name;
      },
      remove(name) {
        el.className = el.className.split(' ').filter(token => token !== name).join(' ');
      },
    }; // Keeps the selected class observable without browser layout.
    return el;
  }

  const document = {
    documentElement: {},
    body: { appendChild(el) { elements.push(el); } },
    createElement,
    getElementById() { return null; },
    addEventListener() {},
  }; // Only the DOM operations used when opening the tool selector are necessary.
  const window = {
    innerWidth: 800, innerHeight: 600,
    SCRATCHBONES_CONFIG: { game: { mobileControls: {} } },
    Shattercasks: {
      backCarriedInfo() { return burden; },
      toolArchAction() { return null; },
      takeFromBack() { takeCount++; burden = null; return true; },
    },
    Spyglass: { endAim() {}, stow() {} },
    AdventuringTools: { entries() { return []; } },
  }; // One shared namespace for the real selector and burden runtime contract.
  const toolBtn = { style: {}, addEventListener() {} }; // Listener registration is enough for the menu API.
  const equipmentSlots = { shovel: 'shovel', hoe: 'hoe', weapon: 'sword' }; // Ordinary tool positions must stay unchanged.
  const defs = { shovel: {}, hoe: {}, sword: {} }; // Icons do not affect ordering.
  const context = vm.createContext({
    window, document,
    getComputedStyle: () => ({ getPropertyValue: () => '8px' }),
  }); // Executes the full shipped selector rather than matching its source text.

  vm.runInContext(source, context, { filename: 'action-arc-ui.js' });
  window.ActionArcUI.init({
    toolBtn,
    WHEEL_SLOTS: ['shovel', 'hoe', 'weapon'],
    equipmentSlots,
    TOOL_ITEM_DEFS: defs,
    getActiveTool: () => activeTool,
    toolSelectIconHTML: () => '🔧',
    setHeldMode() {},
    setLastHeldFarmTool() {},
    setActiveTool(value) { activeTool = value; selectedTools.push(value); },
  });

  const slots = () => elements.filter(el => !el.removed && el.className.split(' ').includes('arc-slot')); // Returns only the current menu.
  const labelOf = el => el.innerHTML.match(/<span class="arc-label">([^<]+)<\/span>/)?.[1]; // Reads the actual displayed caption.

  return {
    open() { window._desktopSelectionArc.openTool(); },
    labels() { return slots().map(labelOf); },
    selectedLabel() { return labelOf(slots().find(el => el.className.split(' ').includes('arc-active'))); },
    scroll(dir) { window._desktopSelectionArc.scrollTool(dir); },
    commit() { window._desktopSelectionArc.commit(); },
    selectedTools,
    takeCount: () => takeCount,
    menuOpen: () => window._desktopSelectionArc.toolMenuOpen(),
    setBurden(next) { burden = next; },
  };
}

const noBurden = makeHarness(null);
noBurden.open();
assert.deepEqual(noBurden.labels(), ['Adventuring Tools', 'Shovel', 'Hoe', 'Weapon'],
  'without a burden, the regular arch and its gateway keep their existing positions');
assert.equal(noBurden.selectedLabel(), 'Shovel',
  'an active Adventuring Tool defaults to the first real farm tool');

const carried = makeHarness({ displayName: 'Witch Bomb' });
carried.open();
assert.deepEqual(carried.labels(), ['Adventuring Tools', 'Witch Bomb', 'Shovel', 'Hoe', 'Weapon'],
  'the carried burden appears immediately after Adventuring Tools and before Shovel');
assert.equal(carried.selectedLabel(), 'Shovel',
  'the optional burden must not become the default selection');
carried.scroll(-1);
assert.equal(carried.selectedLabel(), 'Witch Bomb', 'scrolling backward from Shovel highlights the burden');
assert.deepEqual(carried.selectedTools, [], 'highlighting a burden never equips a synthetic tool');
carried.commit();
assert.equal(carried.takeCount(), 1, 'committing the selected burden uses the existing take-from-back action');
assert.deepEqual(carried.selectedTools, [], 'taking the burden does not alter the equipped farm tool');
assert.equal(carried.menuOpen(), false, 'a committed burden closes the tool menu');

carried.open();
assert.deepEqual(carried.labels(), ['Adventuring Tools', 'Shovel', 'Hoe', 'Weapon'],
  'after taking the burden, reopening the arch removes its transient slot');

const selectedHoe = makeHarness({ displayName: 'Shattercask' }, 'hoe');
selectedHoe.open();
assert.equal(selectedHoe.selectedLabel(), 'Hoe', 'an already selected real tool retains its highlighting');
console.log('Tool arch back-burden ordering and selection regression passed.');

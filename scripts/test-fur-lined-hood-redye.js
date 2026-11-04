#!/usr/bin/env node
'use strict';

// Production redye-handler regression: cloth dye may change, genetic fur and hidden ink may not.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8'); // Tested code, rather than a second redye implementation.
const dyes = [
  { id: 'red', label: 'Red', hex: '#bb3344' },
  { id: 'blue', label: 'Blue', hex: '#3355cc' },
]; // Available fabric colors for the simulated owner.

function element(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, textContent: '',
    isConnected: true, classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { this.children.push(child); return child; },
    prepend(child) { this.children.unshift(child); return child; },
    setAttribute(name, value) { this[name] = value; },
    set innerHTML(value) { this._innerHTML = value; this.children.length = 0; },
    get innerHTML() { return this._innerHTML || ''; },
  };
}

async function testRedye() {
  const elements = new Map(); // Captures real redye UI controls for assertions and simulated clicks.
  for (const id of ['dyePanel', 'dyePanelTitle', 'dyePanelSubslots', 'dyePanelGroups', 'dyePanelPreview', 'dyePanelCancel', 'dyePanelClose', 'dyePanelApply']) {
    elements.set(id, element());
  }
  const document = {
    currentScript: { src: 'https://example.test/docs/js/clothing-weaving-system.js' },
    documentElement: { dataset: {} }, head: { appendChild() {} }, body: { appendChild() {} },
    getElementById(id) { return elements.get(id) || null; },
    createElement: element, querySelectorAll() { return []; }, addEventListener() {},
  };
  const dyeSystem = {
    ensureCollection() {}, getCatalog() { return dyes; },
    owns(id) { return dyes.some(dye => dye.id === id); },
    getById(id) { return dyes.find(dye => dye.id === id) || null; },
    toClothingColor(dye) { return { hex: dye.hex, label: dye.label, dyeId: dye.id }; },
    ownedByHue() { return [{ label: 'Dyes', dyes }]; },
  };
  const window = {
    DyeSystem: dyeSystem, SCRATCHBONES_CONFIG: { game: { account: { shopCatalog: [] } } },
    addEventListener() {}, setTimeout() { return 0; },
  }; // Minimal runtime for the actual public ClothingWeavingSystem API.
  const context = vm.createContext({
    window, document, URL, console, performance: { now: () => 0 },
    MutationObserver: class { observe() {} }, Image: class {},
    fetch: async () => ({ ok: false, status: 404 }),
  }); // Intentionally missing cosmetic network art; dye mutations must not require a canvas.
  vm.runInContext(source, context, { filename: 'clothing-weaving-system.js', timeout: 5000 });
  const api = window.ClothingWeavingSystem; // Authoritative public redye handler invoked below.
  assert.equal(typeof api?.openExtendedRedyePanel, 'function');
  const item = {
    uid: 'lined-test', slot: 'hood', baseCosmeticId: 'fur_lined_hood',
    cosmeticId: 'fur_lined_hood#loom:lined-test', baseLabel: 'Fur-lined Hood',
    label: 'Pale Cream Fur-lined Hood', furTrimColorName: 'Pale Cream',
    articleDyeIds: ['red'], colorA: dyeSystem.toClothingColor(dyes[0]),
    colorB: null, colorC: null, weightUnits: 2, weaving: null,
  }; // Unpatterned newly-crafted hood with a natural trim, not a dye B.

  await api.openExtendedRedyePanel(item);
  assert.equal(elements.get('dyePanelSubslots').children.length, 1, 'only base fabric A is editable');
  assert.equal(item.colorC, null, 'opening redye does not create hidden ink');
  assert.equal(elements.get('dyePanelPreview').children.filter(child => child.className === 'dye-preview-chip').length, 1, 'only A has a preview swatch');

  const chooseDye = index => {
    const group = elements.get('dyePanelGroups').children[0]; // Real generated hue-group structure.
    const swatch = group?.children?.[1]?.children?.[index]; // Dye button created by renderGroups.
    assert.equal(typeof swatch?.onclick, 'function', 'missing dye swatch');
    swatch.onclick();
  };
  chooseDye(1);
  assert.equal(item.colorA?.dyeId, 'blue', 'fabric dye changes hood body');
  assert.equal(item.colorB, null, 'fur trim is never a conventional B dye');
  assert.equal(item.colorC, null, 'hidden dye C stays empty in preview');
  assert.equal(item.furTrimColorName, 'Pale Cream', 'fur color is immutable');
  elements.get('dyePanelApply').onclick();
  assert.equal(item.colorC, null, 'apply does not add an invisible ink dye');
  assert.deepEqual(item.articleDyeIds, ['red', 'blue'], 'only actually applied fabric dyes are recorded');
  assert.equal(item.label, 'Pale Cream Fur-lined Hood');

  await api.openExtendedRedyePanel(item);
  chooseDye(0);
  elements.get('dyePanelCancel').onclick();
  assert.equal(item.colorA?.dyeId, 'blue', 'cancel restores prior fabric color');
  assert.equal(item.colorC, null, 'cancel leaves pattern ink unchanged');
  assert.equal(item.furTrimColorName, 'Pale Cream', 'cancel leaves natural trim intact');
  console.log('Fur-lined Hood redye isolation and cancellation passed');
}

testRedye().catch(error => { console.error(error); process.exitCode = 1; });

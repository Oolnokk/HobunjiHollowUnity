'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const carpenterSource = fs.readFileSync('docs/js/carpenter-shop.js', 'utf8');
const stock = JSON.parse(fs.readFileSync('docs/config/shops/shop-stock.json', 'utf8'));
const incubator = stock.shops?.carpenterBarnPlans?.additions?.incubator;

assert(incubator, 'incubator must be configured as a carpenter barn addition');
assert.equal(incubator.planItem, 'barnIncubatorPlan', 'barn addition owns its plan item in shop config');
assert.equal(incubator.price, 5000, 'week-scale incubator price remains shop-configurable');
assert(!stock.shops?.carpenterHouseDeeds?.pieces?.incubator, 'incubator must never leak into farmhouse deed stock');

class FakeButton {
  constructor() { this.listeners = {}; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  before(node) { this.controls = node; }
  click() { this.listeners.click?.(); }
}

class FakeNode {
  constructor(id = '') {
    this.id = id;
    this.className = '';
    this.textContent = '';
    this.children = [];
    this._innerHTML = '';
    this._button = null;
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    if (!this._innerHTML) this.children = [];
    if (/data-(?:tier|deed|bp|barn-addition)=/.test(this._innerHTML)) this._button = new FakeButton();
  }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute() {}
  addEventListener(type, fn) { this[type] = fn; }
  querySelector(selector) {
    if (/^\[data-(?:tier|deed|bp|barn-addition)\]$/.test(selector)) return this._button;
    return null;
  }
}

const goldDisplay = new FakeNode('cpGoldDisplay');
const list = new FakeNode('carpenterShopList');
const document = {
  getElementById(id) {
    if (id === 'cpGoldDisplay') return goldDisplay;
    if (id === 'carpenterShopList') return list;
    return null;
  },
  createElement() { return new FakeNode(); },
};

const inventory = { gold: 6000 };
const toasts = [];
let townValue = 0; // Larger barn additions are a Town Value perk (shop-stock minTownValue).
const window = {
  TownMine: { getTownValue: () => townValue },
  InventoryStacks: require('./lib/inventory-stacks'),
  ConditionRegistry: { entryEligible: () => true },
  LootRolling: { getShopStock: () => stock.shops },
};
window.window = window;

vm.runInNewContext(fs.readFileSync('docs/js/shop-quantity.js', 'utf8'), { window, document, console });
vm.runInNewContext(carpenterSource, { window, document, console }, { filename: 'carpenter-shop.js' });
window.CarpenterShop.init({
  inventory,
  getBarnTiers: () => ({}),
  getHousePieceDeeds: () => ({}),
  FURNITURE_BLUEPRINT_CATALOG: [],
  lootShopWorldState: () => ({}),
  esc: value => String(value),
  showToast: (message, ok) => toasts.push({ message, ok }),
  buildInventoryGrid() {},
  saveMemberWorldData() {},
});
window.CarpenterShop.render();

{
  const lockedRow = list.children.find(node => node.innerHTML.includes('Barn Incubator Addition'));
  assert(lockedRow, 'a Town-Value-locked addition is still listed');
  assert(!lockedRow._button, 'locked addition has no live buy button below its Town Value');
  assert(/Requires Town Value 1/.test(lockedRow.innerHTML), 'locked row says what Town Value it needs');
  const smallRow = list.children.find(node => node.innerHTML.includes('Small Incubator Plan'));
  assert(smallRow?._button, 'Town Value 0 additions stay buyable');
}
townValue = 1;
window.CarpenterShop.render();

const additionHeader = list.children.find(node => node.textContent === '🪚 Barn Additions');
assert(additionHeader, 'carpenter renders a distinct Barn Additions section');
const incubatorRow = list.children.find(node => node.innerHTML.includes('Barn Incubator Addition'));
assert(incubatorRow, 'configured incubator is visible in carpenter stock');
assert(incubatorRow.innerHTML.includes(incubator.desc), 'shop row uses the config-authored addition description');
assert(incubatorRow._button, 'incubator row exposes a buy button');

incubatorRow._button.click();
assert.equal(inventory.gold, 1000, 'buying the incubator subtracts its configured 5000g price');
assert.equal(inventory.barnIncubatorPlan, 1, 'buying the addition grants its configured plan item');
assert(toasts.some(entry => entry.ok && /Barn Incubator Addition/.test(entry.message)), 'purchase reports success');

// The canonical shop must be the only incubator purchase route; the runtime module merely registers definitions.
const incubatorSource = fs.readFileSync('docs/js/barn-incubator.js', 'utf8');
assert(!incubatorSource.includes('function buyIncubatorPlan('), 'no independent purchase handler can bypass Town Value or capacity');
assert(!incubatorSource.includes('function decorateCarpenterShop('), 'no duplicate incubator listing');
assert.equal(list.children.filter(node => node.innerHTML.includes('Barn Incubator Addition')).length, 1);
inventory.gold = 20000;
window.CarpenterShop.render();
const bulkRow = list.children.find(node => node.innerHTML.includes('Barn Incubator Addition'));
bulkRow._button.controls.children[2].click();
bulkRow._button.click();
assert.equal(inventory.barnIncubatorPlan, 3);
assert.equal(inventory.gold, 10000);
console.log('carpenter barn addition tests passed');

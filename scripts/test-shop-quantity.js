'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = { InventoryStacks: { MAX_TOTAL: 9999 } };
function node() {
  return { children: [], listeners: {}, attributes: {}, appendChild(child) { this.children.push(child); }, before(child) { this.controls = child; },
    setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { if (!this.disabled) this.listeners.click?.(); } };
}
vm.runInNewContext(fs.readFileSync('docs/js/shop-quantity.js', 'utf8'), { window, document: { createElement: node } });
const Q = window.ShopQuantity;
assert.equal(Q.max({ gold: 40, mulch: 9990 }, { price: 3, grants: { mulch: 5 } }), 1);
assert.equal(Q.max({ gold: 100, fish: 5 }, { price: 10, tradeCost: { fish: 2 }, grants: { potion: 1 } }), 2);
assert.equal(Q.max({ gold: 100, fish: 9999 }, { price: 10, tradeCost: { fish: 2 }, grants: { fish: 3 } }), 0);
assert.equal(Q.max({ gold: 100, fish: 9999 }, { price: 10, tradeCost: { fish: 2 }, grants: { fish: 2 } }), 10);
assert.equal(Q.max({ gold: 100 }, { price: 0, limit: 3 }), 3);
assert.equal(Q.max({ gold: 10 }, { price: -1 }), 0);
assert.equal(Q.max({ gold: 10 }, { price: NaN }), 0);
for (const bad of [0, -1, 1.1, Infinity, NaN, '2', 4]) assert.equal(Q.valid(bad, 3), false);
let limit = 3, purchased = 0;
const button = node();
Q.attach(button, { maximum: () => limit, price: 5, purchase: quantity => { purchased += quantity; limit -= quantity; } });
const [minus, value, plus] = button.controls.children;
assert.equal(value.textContent, '1');
assert.equal(minus.attributes['aria-disabled'], 'true');
assert.equal(minus.attributes['data-ctrl-inspect'], '');
plus.click(); plus.click(); plus.click();
assert.equal(value.textContent, '3');
assert.equal(plus.attributes['aria-disabled'], 'true');
assert.equal(plus.attributes['data-ctrl-inspect'], '');
assert.equal(button.textContent, 'Buy ×3 · 15g');
minus.click();
assert.equal(value.textContent, '2');
button.click();
assert.equal(purchased, 2);
assert.equal(value.textContent, '1');
button.click();
assert.equal(purchased, 3);
assert.equal(button.disabled, true);
assert.equal(button.textContent, 'Unavailable');
assert.equal(Q.max({ gold: 20 }, { price: 5, tradeCost: null, grants: null }), 4);
// Resources may change while a quantity is selected. Never buy a silently reduced amount.
let changingMax = 4, changingBought = 0;
const changingButton = node();
Q.attach(changingButton, { maximum: () => changingMax, price: 2, purchase: count => { changingBought += count; } });
const changingControls = changingButton.controls.children;
changingControls[2].click();
changingControls[2].click();
changingMax = 2;
changingButton.click();
assert.equal(changingBought, 0, 'a stale selected amount requires another explicit purchase');
assert.equal(changingControls[1].textContent, '2');
changingButton.click();
assert.equal(changingBought, 2);
// Exercise the actual General Store transaction, including a multi-unit order and barter.
const storeSource = fs.readFileSync('docs/js/general-store.js', 'utf8');
const start = storeSource.indexOf('  function configuredGrants(');
const end = storeSource.indexOf('  function goodsForShop(', start);
assert.ok(start >= 0 && end > start);
const inventory = { gold: 100, fish: 6, mulch: 9989 };
let saves = 0, qualityUnits = 0, renders = 0, acquiredUnits = 0;
window.CookingSystem = { recordItemQuality(key, stars, units) {
  assert.equal(key, 'mulch'); assert.equal(stars, 3); qualityUnits += units;
} };
window.AlchemySystem = { recordPotionAcquisition(key, units) { acquiredUnits += units; } };
const deps = { inventory, showToast() {}, buildInventoryGrid() {}, refreshActionBar() {}, saveMemberWorldData() { saves++; } };
const store = vm.runInNewContext(storeSource.slice(start, end) + '\n({ buyGeneralStoreItem, goodsLimit })', {
  window, deps, renderGeneralStorePage() { renders++; }
});
const bundle = { name: 'Mulch Bundle', price: 7, tradeCost: { fish: 2 }, gives: { mulch: 5 }, qualityStars: 3 };
assert.equal(store.goodsLimit(bundle), 2);
assert.equal(store.goodsLimit({ price: 2, gives: { mulch: 1 }, tradeCost: null }), 10);
store.buyGeneralStoreItem(bundle, 3);
assert.deepEqual(inventory, { gold: 100, fish: 6, mulch: 9989 }, 'oversized orders never partially charge or grant');
assert.equal(saves, 0);
store.buyGeneralStoreItem(bundle, 2);
assert.deepEqual(inventory, { gold: 86, fish: 2, mulch: 9999 }, 'price, barter and grants scale together');
assert.equal(qualityUnits, 10);
assert.equal(acquiredUnits, 10);
assert.equal(saves, 1);
assert.equal(renders, 1);
console.log('Shop quantity limits, in-place controls and bulk transaction passed.');

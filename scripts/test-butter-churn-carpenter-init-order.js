#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const domContentLoadedListeners = []; // Used to prove the carpenter succeeds before deferred food-processing hooks run.
const window = {
  ProceduralFurniture: { CATALOG: {} },
};
const document = {
  readyState: 'loading',
  addEventListener(event, callback) {
    if (event === 'DOMContentLoaded') domContentLoadedListeners.push(callback);
  },
};

const context = vm.createContext({ window, document, console });
vm.runInContext(fs.readFileSync('docs/js/food-processing.js', 'utf8'), context, { filename: 'food-processing.js' });
vm.runInContext(fs.readFileSync('docs/js/carpenter-shop.js', 'utf8'), context, { filename: 'carpenter-shop.js' });

assert.equal(document.readyState, 'loading', 'test remains in parser-time production state');
assert(domContentLoadedListeners.length > 0, 'food-processing still has a deferred compatibility retry');

const blueprints = []; // Used as the same shared catalog game.js injects into CarpenterShop.init().
window.CarpenterShop.init({ FURNITURE_BLUEPRINT_CATALOG: blueprints });

const churnBlueprint = blueprints.find(entry => entry.key === 'butterChurnFurnitureBlueprint');
assert(churnBlueprint, 'Butter Churn blueprint is registered during the carpenter production init');
assert.equal(churnBlueprint.furnitureKey, 'butterChurnFurniture', 'carpenter blueprint crafts the Butter Churn furniture item');
assert.equal(blueprints.filter(entry => entry.key === 'butterChurnFurnitureBlueprint').length, 1, 'parser-time registration does not duplicate the Butter Churn blueprint');

console.log('butter churn carpenter init-order regression passed');

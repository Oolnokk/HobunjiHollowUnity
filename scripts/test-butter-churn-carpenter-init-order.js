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

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Production initialization order used by the Pack's item metadata registration.
const earlyFurnitureCall = 'window.HobunjiFoodProcessing?.ensureProcessingFurnitureDef?.(PROCESSING_FURNITURE_DEFS);'; // Early furniture def hook that must precede item registration.
const earlyBlueprintCall = 'window.HobunjiFoodProcessing?.ensureBlueprint?.(FURNITURE_BLUEPRINT_CATALOG);'; // Early recipe hook that must precede blueprint registration.
const defsIndex = gameSource.indexOf(earlyFurnitureCall); // Start of the real bootstrap snippet exercised below.
const blueprintIndex = gameSource.indexOf(earlyBlueprintCall); // End of the bootstrap snippet and recipe-registration order check.
assert(defsIndex > gameSource.indexOf('const FURNITURE_BLUEPRINT_CATALOG = ['), 'late-added furniture is registered after the base blueprint catalog is assembled');
assert(blueprintIndex > defsIndex, 'churn furniture and blueprint hooks run together during game bootstrap');
assert(defsIndex < gameSource.indexOf('Object.values(PROCESSING_FURNITURE_DEFS).forEach'), 'churn furniture is registered before ITEM_DEFS/inventoryItems are populated');
assert(blueprintIndex < gameSource.indexOf('FURNITURE_BLUEPRINT_CATALOG.forEach'), 'churn blueprint is registered before the Pack item metadata is populated');
vm.runInContext(`
  const PROCESSING_FURNITURE_DEFS = {}; // Used to verify parser-time furniture registration.
  const FURNITURE_BLUEPRINT_CATALOG = []; // Used to verify parser-time recipe registration.
  ${gameSource.slice(defsIndex, blueprintIndex + earlyBlueprintCall.length)}
  window.__earlyButterChurnDefs = PROCESSING_FURNITURE_DEFS;
  window.__earlyButterChurnBlueprints = FURNITURE_BLUEPRINT_CATALOG;
`, context, { filename: 'game-furniture-bootstrap.js' });
assert.equal(window.__earlyButterChurnDefs.butterChurn?.itemKey, 'butterChurnFurniture', 'Butter Churn is a registered physical item before the Pack metadata is generated');
assert(window.__earlyButterChurnBlueprints.some(entry => entry.key === 'butterChurnFurnitureBlueprint'), 'purchased churn recipes enter the Pack item registry before it is built');

const blueprints = []; // Used as the same shared catalog game.js injects into CarpenterShop.init().
window.CarpenterShop.init({ FURNITURE_BLUEPRINT_CATALOG: blueprints });

const churnBlueprint = blueprints.find(entry => entry.key === 'butterChurnFurnitureBlueprint');
assert(churnBlueprint, 'Butter Churn blueprint is registered during the carpenter production init');
assert.equal(churnBlueprint.furnitureKey, 'butterChurnFurniture', 'carpenter blueprint crafts the Butter Churn furniture item');
assert.equal(blueprints.filter(entry => entry.key === 'butterChurnFurnitureBlueprint').length, 1, 'parser-time registration does not duplicate the Butter Churn blueprint');

console.log('butter churn carpenter init-order regression passed');

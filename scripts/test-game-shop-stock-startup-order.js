#!/usr/bin/env node
'use strict';

// Exercise game.js's ACTUAL asynchronous shop-stock admission and deferred
// replay snippets. A cached database can resolve while BARN_TIERS is still in
// its lexical temporal-dead-zone, before the farm catalog is initialized.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8'); // Real production startup code, not a reimplemented mock.
const bootStart = game.indexOf('let shopStockCatalogReady = false;');
const bootEndMark = 'window.LootRolling.loadLootShopConfig();';
const bootEnd = game.indexOf(bootEndMark, bootStart);
assert(bootStart !== -1 && bootEnd > bootStart, 'shop stock startup guard must be installed before the async load');
const boot = game.slice(bootStart, bootEnd + bootEndMark.length);

const readyStart = game.indexOf('shopStockCatalogReady = true;', bootEnd);
const readyEnd = game.indexOf('\n      }', readyStart);
assert(readyStart > bootEnd && readyEnd > readyStart, 'late catalog registration must replay an early shop load');
const ready = game.slice(readyStart, readyEnd + '\n      }'.length);

function runCase(delivery) {
  // Hoisted function below deliberately reads late lexical declarations:
  // a premature config callback must never be allowed to enter it.
  const fixture = `
    const notifications = []; // Assertions inspect precisely when the real callback applies a shop.
    const window = { LootRolling: {
      init(deps) { this.deps = deps; },
      loadLootShopConfig() { if (delivery === 'early') this.deps.applyLoadedShopStock(); },
      deliver() { this.deps.applyLoadedShopStock(); }
    }};
    const weaponDamageTypeForTool = () => 'blunt';
    const currentArea = 'town', _playerData = {}, calendar = {};
    function _applyLoadedShopStock() {
      notifications.push({barn: BARN_TIERS.small.label, house: HOUSE_PIECE_CATALOG.starter.label});
    }
    ${boot}
    let BARN_TIERS = { small: {label: 'Little Barn'} };
    let HOUSE_PIECE_CATALOG = { starter: {label: 'House'} };
    ${ready}
    if (delivery === 'late') window.LootRolling.deliver();
    return notifications;
  `;
  return new Function('delivery', fixture)(delivery);
}

for (const timing of ['early', 'late']) {
  const events = runCase(timing); // Both cached (early) and network (late) completions must synchronize shop stock once.
  assert.deepEqual(events, [{barn:'Little Barn',house:'House'}], timing + ' shop stock application');
}
assert.deepEqual(runCase('absent'), [], 'no catalog was loaded, so synchronous defaults remain untouched');
console.log('PASS shop stock cached/late/absent startup: no BARN_TIERS TDZ or duplicate application');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const game = source('docs/game.js');
const alcohol = source('docs/js/alcohol-gameplay-bridge.js');
const inventoryMetadata = source('docs/js/inventory-action-metadata-bridge.js');
const controls = source('docs/config/scratchbones-config.js');
const combat = source('docs/js/combat/combat-core.js');
const loader = source('docs/js/combat/combat-config-loader.js');
// Mobile Pixel Probe diagnostics expose the populated action-arch slots.
const pixelProbe = source('docs/js/pixel-probe.js');

assert.doesNotMatch(alcohol, /\['Space', 'Enter', 'KeyE'\]/,
  'consumption must not intercept literal desktop keys');
assert.doesNotMatch(alcohol, /btn\(\?:Item\)\?Action\[1-5\][\s\S]{0,200}consumeHeldItem/,
  'consumption must not intercept action-button pointer events outside normal dispatch');
assert.match(alcohol, /getHeldItemAction[\s\S]*?action: 'consume_held_item'/,
  'the alcohol bridge exposes a semantic consumable action');
assert.match(alcohol, /const heldMode = itemDeps\?\.getHeldMode\?\.\(\);[\s\S]*?heldMode !== 'item'/,
  'consumable eligibility uses synchronous held mode instead of waiting for a rendered plane');

assert.match(game, /getHeldItemAction\?\.\(\);\s*if \(consumeAction\) btns\.unshift\(consumeAction\);/,
  'a held consumable occupies item action slot 1');
assert.match(game, /if \(item && item\.seedFor\)[\s\S]{0,500}?const plantAct\s*=\s*'plant_' \+ cropName;[\s\S]{0,500}?btns\.push\(/,
  'every selected seedFor entry routes through the generic numbered plant action');
assert.match(game, /isCookedFood[\s\S]{0,300}?action: 'consume_food_item'/,
  'generated cooked meals expose a numbered Eat action');
assert.match(game, /activeAction === 'consume_food_item'[\s\S]{0,300}?CookingSystem\.eat\(/,
  'generated cooked meals consume through CookingSystem from normal action dispatch');
assert.match(game, /const isItemButton = b =>[\s\S]{0,500}?consume_held_item[\s\S]{0,500}?consume_food_item[\s\S]{0,500}?plant_[\s\S]{0,500}?place_[\s\S]{0,500}?spawn_[\s\S]{0,500}?harvest/,
  'mobile item-button packing recognizes consume, plant, place, spawn, and harvest actions');
assert.match(game, /window\.FarmCrates\?\.init\(\{[\s\S]*?getHeldMode: \(\) => heldMode/,
  'the consumable bridge receives the current semantic held mode');
assert.match(game, /const actionButtonKey = btns\.map[\s\S]*?\|\$\{actionButtonKey\}`/,
  'the action-bar cache invalidates when a dynamic item action appears');
assert.match(game, /activeAction === 'consume_held_item'[\s\S]*?consumeHeldItem\?\.\(\)/,
  'normal action dispatch consumes the selected item');
assert.match(game, /\^action\(\\d\+\)\$[\s\S]*?runActionButtonAtSlot/,
  'configurable action bindings continue to route by semantic slot');
assert.match(game, /function runInteractAction\(\)[\s\S]*?action === 'consume_held_item'[\s\S]*?!isItemAction\(b\.action\)/,
  'Interact excludes consume, plant, place, and harvest item actions');
assert.match(game, /if \(key === 'e' && isDesktop\)[\s\S]*?if \(!wasHeld\) runInteractAction\(\);/,
  'a desktop E tap uses world Interact after the tool-wheel hold check');
assert.match(pixelProbe, /Mobile action arch:/,
  'Pixel Probe reports all mobile action-arch slots without desktop devtools');

const inventoryStart = game.indexOf('const inventoryItems = ['); // Used to audit every currently authored seed-bearing item instead of naming a hand-picked subset.
const inventoryEnd = game.indexOf('];', inventoryStart);
assert.ok(inventoryStart >= 0 && inventoryEnd > inventoryStart, 'inventory item registry is present');
const inventoryBlock = game.slice(inventoryStart, inventoryEnd); // Used to scope seed consistency checks to selectable inventory entries.
const seedEntries = [...inventoryBlock.matchAll(/\{[^{}\n]*key:\s*'([^']+)'[^{}\n]*seedFor:\s*'([^']+)'[^{}\n]*\}/g)]; // Used to enumerate all authored seeds in the held-item scroll.
assert.ok(seedEntries.length > 0, 'at least one held seed entry is authored');
for (const [, seedKey, cropKey] of seedEntries) {
  const escapedSeedKey = seedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Used to safely match the current seed key inside ITEM_DEFS.
  assert.match(game, new RegExp(`\\b${escapedSeedKey}\\s*:\\s*\\{[^\\n]*cat:\\s*'seed'`),
    `${seedKey} (${cropKey}) has a canonical seed definition`);
}

for (let slot = 1; slot <= 5; slot++) {
  const binding = new RegExp(`\\{\\s*"id":\\s*"action${slot}"[^\\n]*"desktop":\\s*"[^"]+"[^\\n]*"controller":\\s*"[^"]+"[^\\n]*\\}`); // Used to verify each mobile-visible semantic slot remains reachable from keyboard and controller.
  assert.match(controls, binding, `action${slot} has both desktop and controller bindings`);
}

assert.match(inventoryMetadata, /Object\.assign\(entry, \{ \.\.\.definition, \.\.\.entry \}\);/,
  'canonical metadata enriches selectable entries without overwriting scroll-owned context fields');
assert.match(inventoryMetadata, /originalInit\(injectedDeps\);[\s\S]{0,120}?syncInventoryEntries\(injectedDeps\);/,
  'inventory metadata synchronizes immediately after cooking/item registration');

const bridgeWindow = {}; // Used to exercise the future-CookingSystem hook without requiring a browser.
vm.runInNewContext(inventoryMetadata, { window: bridgeWindow });
const fakeCookingSystem = {
  init(injectedDeps) { return injectedDeps; },
  registerIngredientItems() { return true; },
}; // Used to verify late CookingSystem assignment receives the bridge wrappers.
bridgeWindow.CookingSystem = fakeCookingSystem;
const heldCropEntry = { key: 'redberries', icon: '🍓', label: 'REDBERRIES', max: 99 }; // Used to model the minimal scroll entry that previously lost food semantics.
const heldFishEntry = { key: 'testFish', icon: '🐟', label: 'TEST FISH', max: 99 }; // Used to model canonical fish, whose ITEM_DEFS category is material but which is still ordinary edible food.
const fakeCookingDeps = {
  ITEM_DEFS: {
    redberries: { icon: '🍓', label: 'Redberries', cat: 'crop', tags: ['Crop', 'Berry'] },
    testFish: { icon: '🐟', label: 'Test Fish', cat: 'material', tags: ['Fish', 'Common'] },
  },
  inventoryItems: [heldCropEntry, heldFishEntry],
}; // Used to prove canonical food metadata becomes visible to the held-item resolver while presentation remains stable.
bridgeWindow.CookingSystem.init(fakeCookingDeps);
assert.equal(heldCropEntry.cat, 'crop', 'raw crop category reaches the selectable held item');
assert.deepEqual(Array.from(heldCropEntry.tags), ['Crop', 'Berry'], 'raw crop tags reach the selectable held item');
assert.equal(heldCropEntry.label, 'REDBERRIES', 'scroll-owned presentation survives metadata synchronization');
assert.ok(Array.from(heldFishEntry.tags).includes('Food'), 'canonical fish gains the held-food semantic tag');
assert.equal(heldFishEntry.cat, 'material', 'fish keeps its canonical inventory category while becoming edible');

const metadataModuleIndex = loader.indexOf('inventory-action-metadata-bridge.js'); // Used to verify the bridge installs before the consumable provider in the parser-blocking compatibility bootstrap.
const alcoholBridgeIndex = loader.indexOf('alcohol-gameplay-bridge.js');
assert.ok(metadataModuleIndex >= 0 && alcoholBridgeIndex > metadataModuleIndex,
  'inventory action metadata bridge loads before alcohol gameplay action discovery');

const areaSet = combat.indexOf('devDeps.setCurrentArea(targetArea);');
const townBuild = combat.indexOf('devDeps.buildTownScene?.();', areaSet);
const gridRead = combat.indexOf('devDeps.getActiveGrid?.();', townBuild);
assert.ok(areaSet >= 0 && townBuild > areaSet && gridRead > townBuild,
  'blackout travel builds town before reading its grid and attaching scene objects');
assert.match(game, /window\.DevSpawner\?\.init\(\{[\s\S]*?buildTownScene,[\s\S]*?buildZoneScene,/,
  'blackout travel receives the town-scene builder');

const elevationBridge = loader.indexOf('town-player-body-elevation-bridge.js');
const alcoholBridge = loader.indexOf('alcohol-gameplay-bridge.js?v=');
assert.ok(elevationBridge >= 0 && alcoholBridge > elevationBridge,
  'the latest town body-elevation bridge remains loaded before alcohol gameplay');

console.log('blackout travel and standard item action routing tests passed');

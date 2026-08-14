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
assert.match(inventoryMetadata, /document\.addEventListener\('pointerup'[\s\S]*?syntheticPointerCleanup\(button, event\);[\s\S]*?finishPlantContext\(context\);/,
  'touch Plant taps bypass the stale tool-swing gate while preserving the native pointer cleanup path');
assert.match(inventoryMetadata, /scene\.onBeforeRender[\s\S]*?applyPlantReticleOverride\(scene\);/,
  'held seeds can override the stale active-tool reticle color immediately before rendering');
assert.match(loader, /inventory-action-metadata-bridge\.js\?v=20260813b/,
  'the mobile seed-action bridge revision is cache-busted');

const bridgeWindow = {}; // Used to exercise future-global hooks without requiring a browser.
vm.runInNewContext(inventoryMetadata, { window: bridgeWindow });
const fakeCookingSystem = {
  init(injectedDeps) { return injectedDeps; },
  registerIngredientItems() { return true; },
}; // Used to verify late CookingSystem assignment receives the bridge wrappers.
bridgeWindow.CookingSystem = fakeCookingSystem;
const heldCropEntry = { key: 'redberries', icon: '🍓', label: 'REDBERRIES', max: 99 }; // Used to model the minimal scroll entry that previously lost food semantics.
const heldFishEntry = { key: 'testFish', icon: '🐟', label: 'TEST FISH', max: 99 }; // Used to model canonical fish, whose ITEM_DEFS category is material but which is still ordinary edible food.
const heldSeedEntry = { key: 'redberrySeeds', icon: '🍓', label: 'REDBERRY SEEDS', max: 99, seedFor: 'redberries' }; // Used to exercise the same seedFor metadata the mobile Plant button consumes.
const fakeTile = { type: 'tilled', crop: null, cropAge: 0, cropReady: false, stress: '' }; // Used as the live mutable reticle tile for the mobile planting regression.
const calls = { clamp: 0, refreshItems: 0, buildInventory: 0, refreshActions: 0, saveMember: 0, water: 0, dirty: 0, saveLayout: 0, toast: [] }; // Used to verify the direct mobile route mirrors the ordinary successful farm-mutation side effects.
const fakeCookingDeps = {
  ITEM_DEFS: {
    redberries: { icon: '🍓', label: 'Redberries', cat: 'crop', tags: ['Crop', 'Berry'] },
    testFish: { icon: '🐟', label: 'Test Fish', cat: 'material', tags: ['Fish', 'Common'] },
    redberrySeeds: { icon: '🍓', label: 'Redberry Seeds', cat: 'seed', tags: ['Seed', 'Berry'] },
  },
  inventoryItems: [heldCropEntry, heldFishEntry, heldSeedEntry],
  inventory: { redberrySeeds: 2 },
  clampInventoryStack() { calls.clamp++; },
  refreshItemScroll() { calls.refreshItems++; },
  buildInventoryGrid() { calls.buildInventory++; },
  refreshActionBar() { calls.refreshActions++; },
  saveMemberWorldData() { calls.saveMember++; },
  showToast(message, ok) { calls.toast.push({ message, ok }); },
}; // Used to prove canonical food metadata and direct mobile planting share the same inventory registry.
bridgeWindow.CookingSystem.init(fakeCookingDeps);
assert.equal(heldCropEntry.cat, 'crop', 'raw crop category reaches the selectable held item');
assert.deepEqual(Array.from(heldCropEntry.tags), ['Crop', 'Berry'], 'raw crop tags reach the selectable held item');
assert.equal(heldCropEntry.label, 'REDBERRIES', 'scroll-owned presentation survives metadata synchronization');
assert.ok(Array.from(heldFishEntry.tags).includes('Food'), 'canonical fish gains the held-food semantic tag');
assert.equal(heldFishEntry.cat, 'material', 'fish keeps its canonical inventory category while becoming edible');

const fakeFishingSystem = { init(injectedDeps) { return injectedDeps; } }; // Used to prove the future targeting hook retains the game's real reticle/tile providers.
const fakeHousePieces = { init(injectedDeps) { return injectedDeps; } }; // Used to prove the future farm-world hook retains persistence/permission helpers.
bridgeWindow.Fishing = fakeFishingSystem;
bridgeWindow.HousePieces = fakeHousePieces;
bridgeWindow.Fishing.init({
  getReticleTile: () => ({ col: 4, row: 7 }),
  getActiveTileAt: () => fakeTile,
  getCurrentArea: () => 'farm',
});
bridgeWindow.HousePieces.init({
  hasFarmPermission: permission => permission === 'plant',
  recomputeWater() { calls.water++; },
  markTileDirty(col, row) { assert.deepEqual([col, row], [4, 7]); calls.dirty++; },
  saveFarmLayout() { calls.saveLayout++; },
  scene: null,
});
assert.equal(bridgeWindow.HobunjiInventoryActionMetadataBridge.getDebug().plantingReady, true,
  'mobile planting becomes ready after cooking, targeting, and farm-world init');

const planted = bridgeWindow.HobunjiInventoryActionMetadataBridge.tryPlantAction('plant_redberries');
assert.equal(planted.handled, true, 'the mobile seed bridge claims authored plant actions');
assert.equal(planted.ok, true, 'tilled soil accepts the selected seed immediately');
assert.equal(fakeCookingDeps.inventory.redberrySeeds, 1, 'successful mobile planting consumes exactly one seed');
assert.equal(fakeTile.crop, 'redberries', 'successful mobile planting writes the crop onto the targeted tile');
assert.equal(fakeTile.cropAge, 0, 'new mobile-planted crops start at age zero');
assert.equal(fakeTile.cropReady, false, 'new mobile-planted crops are not prematurely harvestable');
assert.equal(calls.dirty, 1, 'successful mobile planting marks the target tile dirty for visual rebuild');
assert.equal(calls.saveLayout, 1, 'successful mobile planting persists the farm layout');
assert.equal(calls.water, 1, 'successful mobile planting follows the ordinary farm recompute path');
assert.equal(calls.clamp, 1, 'successful mobile planting clamps the consumed seed stack');
assert.equal(calls.refreshItems, 1, 'successful mobile planting refreshes the selected-item HUD');
assert.equal(calls.refreshActions, 1, 'successful mobile planting refreshes action availability');
assert.equal(calls.saveMember, 1, 'successful mobile planting also persists member/world inventory state');

fakeTile.type = 'grass';
fakeTile.crop = null;
const blockedPlant = bridgeWindow.HobunjiInventoryActionMetadataBridge.tryPlantAction('plant_redberries');
assert.equal(blockedPlant.handled, true, 'invalid soil is still handled by the mobile seed route for immediate feedback');
assert.equal(blockedPlant.ok, false, 'grass remains invalid planting soil');
assert.equal(fakeCookingDeps.inventory.redberrySeeds, 1, 'blocked mobile planting does not consume a seed');
assert.equal(calls.dirty, 1, 'blocked mobile planting does not dirty or rebuild the tile');
assert.match(calls.toast.at(-1)?.message || '', /tilled or raised soil/i,
  'blocked mobile planting explains the soil requirement instead of silently doing nothing');

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

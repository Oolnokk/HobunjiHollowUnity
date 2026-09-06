#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {
  HobunjiCookingData: {
    categoryLabels: { oil: 'Oil', butter: 'Butter' },
    items: {
      denaturedStinkOil: {
        id: 'denaturedStinkOil',
        name: 'Denatured Stink Oil',
        categories: ['oil'],
        primaryEffect: 'combat',
        baseBoost: 2,
        processingTier: 'quick',
      },
    },
    itemNameTokenOverrides: { denaturedStinkOil: 'Stink Oil' },
  },
  ProceduralFurniture: { CATALOG: {} },
  // FarmEditor loads before food-processing.js in index.html, matching production.
  FarmEditor: { init(deps) { this.deps = deps; } },
};
const domContentLoadedListeners = [];
const document = {
  readyState: 'loading',
  addEventListener(event, callback) {
    if (event === 'DOMContentLoaded') domContentLoadedListeners.push(callback);
  },
};
const context = vm.createContext({ window, document, console });

vm.runInContext(fs.readFileSync('docs/js/item-processing.js', 'utf8'), context, { filename: 'item-processing.js' });
vm.runInContext(fs.readFileSync('docs/js/food-processing.js', 'utf8'), context, { filename: 'food-processing.js' });

// furniture-placer.js/carpenter-shop.js/crafting-panel.js load after
// food-processing.js in index.html, so their namespaces only appear now —
// food-processing.js must pick them up via its deferred DOMContentLoaded retry.
window.FurniturePlacer = { init(deps) { this.deps = deps; } };
window.CarpenterShop = { init(deps) { this.deps = deps; } };
window.CraftingPanel = { init(deps) { this.deps = deps; } };
document.readyState = 'complete';
assert.equal(domContentLoadedListeners.length, 1, 'food-processing.js defers its furniture/blueprint hooks to DOMContentLoaded');
domContentLoadedListeners.forEach(listener => listener());

const itemDefs = {
  garWolfMilk: {
    label: 'Gar-wolf Milk',
    sellPrice: 10,
    tags: ['Material', 'Milk', 'Gar-wolf'],
    spriteColor: 0xEFF3F8,
  },
  uumkaoiiWhiteDewMilk: {
    label: "White Uumkao'ii Milk",
    sellPrice: 12,
    tags: ['Processed', 'Milk', "Uumkao'ii"],
    cookingCategories: ['whiteMilk'],
    spriteColor: 0xFFFFFF,
  },
  shadewoodNutOil: {
    label: 'Shadewood Nut Oil',
    sellPrice: 14,
    tags: ['Processed', 'Oil', 'Nut'],
    cookingCategories: ['oil'],
    spriteColor: 0x8F6A3F,
  },
  grehlrStinkOil: {
    label: 'Grehlr Stink Oil',
    sellPrice: 18,
    tags: ['Material', 'Stink Oil', 'Grehlr'],
    spriteColor: 0x8A9A3D,
  },
  rock: { label: 'Rock', tags: ['Material'] },
};
window.ItemProcessing.init({
  ITEM_DEFS: itemDefs,
  cropData: {},
  PROCESSING_METHODS: [],
  getInventoryItems: () => [],
});

const butter = window.ItemProcessing.getProcessingOutputs('churning', 'garWolfMilk');
assert.equal(butter?.length, 1, 'white milk produces exactly one churn output');
assert.equal(butter[0].key, 'butter', 'white milk churns into butter');
assert(butter[0].cookingCategories.includes('butter'), 'butter occupies the shared butter recipe category');

const dewButter = window.ItemProcessing.getProcessingOutputs('churning', 'uumkaoiiWhiteDewMilk');
assert.equal(dewButter?.[0]?.key, 'butter', 'white milk variants use the same butter recipe');

const margarine = window.ItemProcessing.getProcessingOutputs('churning', 'shadewoodNutOil');
assert.equal(margarine?.length, 1, 'cooking oil produces exactly one churn output');
assert.equal(margarine[0].key, 'margarine', 'cooking oil churns into margarine');
assert(margarine[0].cookingCategories.includes('butter'), 'margarine can substitute anywhere a butter-category ingredient is accepted');
assert(!margarine[0].cookingCategories.includes('oil'), 'margarine is a butter substitute, not merely the unchanged raw-oil ingredient');

const stinkButter = window.ItemProcessing.getProcessingOutputs('churning', 'grehlrStinkOil');
assert.equal(stinkButter?.[0]?.key, 'stinkButter', 'Grehlr stink oil has the special Stink Butter result');
assert.equal(stinkButter[0].label, 'Stink Butter', 'special stink-fat output is displayed as Stink Butter, not margarine');
assert(stinkButter[0].cookingCategories.includes('butter'), 'Stink Butter also works in normal butter recipe slots');
assert.equal(window.ItemProcessing.getProcessingOutputs('churning', 'rock'), null, 'unrelated materials cannot be churned');

window.ItemProcessing.ensureProcessedItemDef(butter[0]);
window.ItemProcessing.ensureProcessedItemDef(margarine[0]);
window.ItemProcessing.ensureProcessedItemDef(stinkButter[0]);
assert(itemDefs.butter.cookingCategories.includes('butter'), 'registered Butter keeps the butter cooking category');
assert(itemDefs.margarine.cookingCategories.includes('butter'), 'registered Margarine keeps the butter cooking category');
assert(itemDefs.stinkButter.cookingCategories.includes('butter'), 'registered Stink Butter keeps the butter cooking category');
assert(window.ItemProcessing.isWheelEligible('garWolfMilk'), 'milk is selectable while it can feed the churn');
assert(window.ItemProcessing.isWheelEligible('shadewoodNutOil'), 'oil is selectable while it can feed the churn');
assert(window.ItemProcessing.isWheelEligible('grehlrStinkOil'), 'stink oil is selectable while it can feed the churn');
assert.equal(window.ItemProcessing.methodIdleLabel('churning'), 'Needs white milk or oil', 'churn has a specific idle prompt');
assert.match(window.ItemProcessing.processButtonLabel('churning', 'garWolfMilk', butter[0]), /^Churn →/, 'churn action uses the normal processor-button path');

assert(!window.HobunjiCookingData.items.denaturedStinkOil, 'legacy Denatured Stink Oil cooking placeholder is removed');
assert.equal(window.HobunjiCookingData.items.stinkButter?.name, 'Stink Butter', 'legacy stink-oil cooking metadata migrates to Stink Butter');
assert(window.HobunjiCookingData.items.stinkButter.categories.includes('butter'), 'migrated Stink Butter metadata is compatible with butter recipes');

const processingDefs = {};
window.FarmEditor.init({ PROCESSING_FURNITURE_DEFS: processingDefs });
window.FurniturePlacer.init({ PROCESSING_FURNITURE_DEFS: processingDefs });
assert.equal(processingDefs.butterChurn?.itemKey, 'butterChurnFurniture', 'farm/editor registry receives the Butter Churn furniture definition');
assert.equal(processingDefs.butterChurn?.method, 'churning', 'Butter Churn routes through the churning processor method');

const blueprints = [];
window.CarpenterShop.init({ FURNITURE_BLUEPRINT_CATALOG: blueprints });
window.CraftingPanel.init({ FURNITURE_BLUEPRINT_CATALOG: blueprints });
const churnBlueprint = blueprints.find(entry => entry.key === 'butterChurnFurnitureBlueprint');
assert(churnBlueprint, 'Butter Churn blueprint is added to carpenter/crafting catalogs');
assert.equal(churnBlueprint.furnitureKey, 'butterChurnFurniture', 'blueprint crafts the placeable churn furniture item');
assert.equal(blueprints.filter(entry => entry.key === 'butterChurnFurnitureBlueprint').length, 1, 'multiple catalog init hooks do not duplicate the blueprint');

assert(window.ProceduralFurniture.CATALOG.openBarrel?.some(part => part.kind === 'cup'), 'open barrel has a hollow-vessel procedural fallback');
assert(window.ProceduralFurniture.CATALOG.butterChurn?.some(part => part.kind === 'cylinder'), 'Butter Churn fallback includes its vertical plunger');

const openBarrel = JSON.parse(fs.readFileSync('docs/config/furniture-authored/openBarrel.json', 'utf8'));
const openBarrelBody = openBarrel.parts.find(part => part.id === 'open_barrel_body');
const openBarrelLiquid = openBarrel.parts.find(part => part.id === 'open_barrel_liquid');
assert.equal(openBarrelBody?.kind, 'cup', 'open-barrel preset uses the genuinely hollow cup primitive');
assert.equal(openBarrelBody?.topScaleX, 1, 'open barrel is straight-sided at the top');
assert.equal(openBarrelBody?.bottomScaleX, 1, 'open barrel is straight-sided at the bottom');
assert.equal(openBarrelLiquid?.liquidContainerId, 'open_barrel_body', 'preset liquid remains linked to the barrel interior for reuse');
assert.equal(openBarrelLiquid?.liquidLevel, 0, 'reusable open barrel starts empty');
assert.equal(openBarrelLiquid?.surfaceOpacity, 0, 'empty open barrel does not display a phantom liquid surface');

const authoredChurn = JSON.parse(fs.readFileSync('docs/config/furniture-authored/butterChurn.json', 'utf8'));
const churnBody = authoredChurn.parts.find(part => part.id === 'butter_churn_barrel');
const churnRod = authoredChurn.parts.find(part => part.id === 'butter_churn_rod');
const churnGrip = authoredChurn.parts.find(part => part.id === 'butter_churn_grip');
const churnLiquid = authoredChurn.parts.find(part => part.id === 'butter_churn_liquid');
const churnWarp = authoredChurn.processingWarps.find(warp => warp.id === 'butter_churn_plunge_warp');
const churnTimeline = authoredChurn.processTimelines.find(timeline => timeline.id === 'butter_churn_process');
assert.equal(churnBody?.kind, 'cup', 'authored churn is built around the same hollow open barrel');
assert.equal(churnBody?.topScaleX, 1, 'churn barrel remains straight-sided');
assert(churnRod && churnGrip, 'authored churn has the tall stake/plunger and its grip');
assert(churnRod.transform.y > churnBody.transform.y, 'plunger visibly sticks out above the barrel');
assert.equal(churnLiquid?.liquidContainerId, 'butter_churn_barrel', 'churn contents stay constrained to the barrel interior');
assert.equal(churnLiquid?.liquidLevel, 0, 'placed churn looks empty before processing');
assert.equal(churnLiquid?.surfaceOpacity, 0, 'placed churn has no visible idle liquid');
assert.equal(churnWarp?.style, 'stomp', 'plunger uses the existing up/down stomp warp machinery');
assert(churnWarp.partIds.includes('butter_churn_rod') && churnWarp.partIds.includes('butter_churn_grip'), 'plunger animation moves the entire stake assembly');
assert(churnTimeline?.duration > 0, 'churning uses the normal timed-station convention');
const liquidTrack = churnTimeline.liquidTracks.find(track => track.partId === 'butter_churn_liquid');
assert(liquidTrack?.useSubstanceColor, 'live churn contents inherit the processed ingredient/output color');
assert.equal(liquidTrack.keyframes[0].value.opacity, 0, 'churn timeline begins from the empty visual state');
assert(liquidTrack.keyframes.at(-1).value.opacity > 0, 'finished churn batch remains visibly present until collected');

console.log('butter churn processing/furniture tests passed');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Executes the actual crop authority and immediate-input adapter together.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const game = source('docs/game.js'); // Used to pin the exact queue/held-item deadlock that this bridge bypasses.
const bridge = source('docs/js/inventory-action-metadata-bridge.js'); // Used to verify Plant and Harvest share one immediate contextual-item path.

const queueComment = game.indexOf('All other actions are queued to fire at the start of the strike phase'); // Used to locate useActiveAction's generic pendingAction path.
const pendingAssignment = game.indexOf('pendingAction = {', queueComment); // Used to prove ordinary non-immediate actions are still queued for tool animation timing.
const itemModeReturn = game.indexOf("if (heldMode === 'item' || _heldDrinkPhase)"); // Used to locate the held-item early return that strands those queued crop actions.
assert.ok(queueComment >= 0 && pendingAssignment > queueComment && itemModeReturn >= 0,
  'fixture retains the generic strike queue and held-item tool-update early return that caused the crop deadlock');

assert.match(bridge, /function isCropAction\(action\)[\s\S]*?id === 'harvest'[\s\S]*?id\.startsWith\('plant_'\)/,
  'Plant and Harvest are explicitly the only actions claimed by the immediate crop adapter');
assert.match(bridge, /document\.addEventListener\('pointerup'[\s\S]*?cropContext\(action\)[\s\S]*?stopImmediatePropagation\?\.\(\)[\s\S]*?finishCropContext\(context\)/,
  'visible crop-button pointerup is claimed before game.js can enqueue pendingAction');
assert.doesNotMatch(bridge, /event\.isTrusted/,
  'immediate crop routing accepts synthetic keyboard button events as well as physical mouse/touch events');
assert.doesNotMatch(bridge, /touchLikePointer/,
  'immediate crop routing is not restricted to mobile/coarse pointers');
assert.match(bridge, /state\.moved\) return;[\s\S]*?Drag-to-aim remains owned by game\.js/,
  'drag-to-aim remains untouched instead of turning a drag into an accidental crop action');

assert.match(bridge, /hasFarmPermission\?\.\('plant'\)/,
  'Plant preserves the farm planting permission gate');
assert.match(bridge, /hasFarmPermission\?\.\('harvest'\)/,
  'Harvest preserves the separate farm harvesting permission gate');
assert.match(bridge, /recomputeWater\?\.\(false\)[\s\S]*?markTileDirty\?\.\(reticle\.col, reticle\.row\)[\s\S]*?saveFarmLayout\?\.\(\)/,
  'both crop actions preserve water recomputation, tile rebuild, and farm persistence');
assert.match(bridge, /tryCropAction,[\s\S]*?tryPlantAction,[\s\S]*?tryHarvestAction/,
  'the bridge exposes a single generic crop-action API plus backward-compatible specific entry points');

function fixture(roll = 0) {
  const inventory = { needlegrainSeeds: 1 }; // Both input routes receive the same stack and crop definitions.
  const quality = [], xp = [], events = [], sounds = [], saved = []; // Side effects must fire exactly once through the canonical owner.
  const cropData = { needlegrain: { label: 'Needlegrain', emoji: '🌾', cropKey: 'needlegrain', seedKey: 'needlegrainSeeds', idealMin: 0.2, idealMax: 0.5 } }; // Matches the live crop registry shape.
  let tile = { type: 'tilled', crop: 'needlegrain', cropAge: 3, cropReady: true, fertilized: true }; // Fertilizer must end with this crop cycle on every input device.
  let allowed = true; // Simulates the existing independent farmhand permission check.
  const window = {
    CookingSystem: { init() {}, recordItemQuality: (...args) => quality.push(args) },
    Fishing: { init() {} }, HousePieces: { init() {} },
    InventoryStacks: { MAX_TOTAL: 9999 }, GameRandom: { random: () => roll },
    PerkSystem: { rank: () => 5 }, LootRolling: { rollItemStars: () => 3, starRatingText: () => '★★★' },
    SkillSystem: { award: (...args) => xp.push(args) }, HobunjiActivityEvents: { emit: (...args) => events.push(args) },
    AudioSystem: { objectSfxConfig: () => ({ harvest: 'harvest' }), playObjectSfx: key => sounds.push(key) },
  }; // Browser globals retain the real init-hook lifecycle used by the adapter.
  const listeners = new Map(); // Visible action-button taps must reach the same authority as the public crop API.
  const document = { addEventListener: (name, listener) => listeners.set(name, listener) }; // Only input registration needs a DOM in this fixture.
  vm.runInNewContext(bridge, { window, document, console, Event });
  vm.runInNewContext(source('docs/js/crop-planting.js'), { window, console });
  window.CropPlanting.init({ inventory, cropData, CropType: { NONE: '' },
    canPlantCropOnTile: (crop, target) => !!cropData[crop] && ['tilled', 'raised'].includes(target.type) && !target.crop,
    clampInventoryStack: key => { if (inventory[key] <= 0) delete inventory[key]; } });
  window.CookingSystem.init({ inventory, inventoryItems: [{ key: 'needlegrainSeeds', seedFor: 'needlegrain' }], ITEM_DEFS: {} });
  window.Fishing.init({ getReticleTile: () => ({ col: 2, row: 3 }), getActiveTileAt: () => tile, getCurrentArea: () => 'farm' });
  window.HousePieces.init({ hasFarmPermission: () => allowed, saveFarmLayout: () => saved.push(true) });
  function tap(action, moved = false) {
    const button = { dataset: { action }, classList: { contains: () => false, add() {}, remove() {} }, dispatchEvent() {} }; // Native pointer cleanup cannot mutate the crop a second time.
    const event = { pointerId: 1, clientX: 0, clientY: 0, target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} }; // Touch-like tap through the installed listener.
    listeners.get('pointerdown')(event);
    if (moved) listeners.get('pointermove')({ ...event, clientX: 40 });
    listeners.get('pointerup')(event);
  }
  return { window, inventory, quality, xp, events, sounds, saved, tap,
    tile: () => tile, setTile: value => { tile = value; }, setAllowed: value => { allowed = value; } };
}

for (const roll of [0, 0.99]) {
  const direct = fixture(roll), visible = fixture(roll); // Force both a bonus and a non-bonus harvest through both routes.
  const result = direct.window.CropPlanting.harvestCrop(direct.tile()); // Controller/ordinary dispatch already uses this authority.
  visible.tap('harvest');
  assert.equal(visible.inventory.needlegrain, direct.inventory.needlegrain, 'visible input preserves the canonical bonus yield');
  assert.equal(visible.inventory.needlegrain, roll === 0 ? 2 : 1);
  assert.deepEqual(visible.tile(), direct.tile(), 'visible harvesting consumes fertilizer and clears the crop exactly like direct harvesting');
  assert.deepEqual(visible.quality, direct.quality, 'quality count includes every bonus unit');
  assert.equal(visible.quality.length, 1);
  assert.equal(visible.xp.length, 1);
  assert.equal(visible.events.length, 1);
  assert.deepEqual(visible.sounds, ['harvest']);
  assert.equal(visible.saved.length, 1);
  assert.equal(visible.window.HobunjiInventoryActionMetadataBridge.getDebug().lastCrop.amount, result.amount);
  visible.tap('harvest');
  assert.equal(visible.quality.length, 1, 'a stale second tap cannot harvest an empty tile');
}

const planting = fixture(); // Immediate planting also delegates rather than maintaining a second mutation path.
planting.setTile({ type: 'tilled', crop: '' });
planting.tap('plant_needlegrain');
assert.equal(planting.tile().crop, 'needlegrain');
assert.equal('needlegrainSeeds' in planting.inventory, false);
planting.setTile({ type: 'tilled', crop: '' });
planting.tap('plant_needlegrain');
assert.equal(planting.tile().crop, '', 'a deleted seed stack cannot plant again');
const denied = fixture(); // Permission rejection must happen before the canonical mutation.
denied.setAllowed(false); denied.tap('harvest');
assert.equal(denied.tile().cropReady, true);
assert.equal(denied.saved.length, 0);
const drag = fixture(); // Drag-to-aim remains an ordinary input gesture, not an immediate harvest.
drag.tap('harvest', true);
assert.equal(drag.tile().cropReady, true);
assert.equal(drag.saved.length, 0);
const unavailable = fixture(); // Fail closed if the owning module has not finished loading.
delete unavailable.window.CropPlanting;
assert.equal(unavailable.window.HobunjiInventoryActionMetadataBridge.tryHarvestAction().ok, false);
assert.equal(unavailable.tile().cropReady, true);

console.log('immediate crop actions: shared planting/harvesting, bonus yield, fertilizer, quality, events, permissions and drag behavior passed');

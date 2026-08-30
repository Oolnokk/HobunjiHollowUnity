#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const game = source('docs/game.js'); // Used to pin the hidden-tool early-return ordering that caused queued Plant actions to freeze.
const bridge = source('docs/js/held-seed-action-bridge.js'); // Used to verify held seeds dispatch independently of the hidden tool strike loop.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to verify the bridge loads after planting metadata and before consumers.

const itemModeReturn = game.indexOf("if (heldMode === 'item' || _heldDrinkAnimT > 0)"); // Used to locate the item-held early return in updateToolMesh().
const pendingStrike = game.indexOf('if (pendingAction && !strikeFired && progress >= SF)', itemModeReturn); // Used to prove pending actions fire later in the same tool-only update path.
assert.ok(itemModeReturn >= 0 && pendingStrike > itemModeReturn,
  'held item mode returns before the hidden tool strike can fire a queued action');

assert.match(bridge, /document\.addEventListener\('pointerup'[\s\S]*?if \(!dispatchPlant\(action\)\) return;[\s\S]*?stopImmediatePropagation\(\)/,
  'Plant pointer taps dispatch directly, but leave native fallback untouched if the planting owner is not ready');
assert.doesNotMatch(bridge, /function\s+touchLikePointer/,
  'Plant interception does not depend on browsers reporting a touch-specific pointer type');
assert.match(bridge, /currentDesktopBinding\(plant\.slot\)[\s\S]*?if \(!dispatchPlant\(plant\.action\)\) return;/,
  'desktop semantic action bindings dispatch held seeds directly too');
assert.match(bridge, /WebGLRenderer\?\.prototype[\s\S]*?applyPlantReticle\(scene\)[\s\S]*?previousRendererRender\.call/,
  'the held-seed reticle is corrected at the actual renderer boundary after game.js updates it');
assert.match(bridge, /plant\.button\.classList\.contains\('blocked'\)/,
  'the reticle override trusts the same allowed state already computed for the visible Plant button');

let dispatchedAction = null; // Used to prove the bridge delegates mutation to the existing public planting owner rather than duplicating crop rules.
const sandbox = {
  window: {
    HobunjiInventoryActionMetadataBridge: {
      tryPlantAction(action) {
        dispatchedAction = action;
        return { handled: true, ok: true };
      },
    },
  },
};
vm.runInNewContext(bridge, sandbox);
assert.equal(sandbox.window.HobunjiHeldSeedActionBridge.dispatchPlant('plant_redberries'), true,
  'public held-seed dispatch claims a normal plant action');
assert.equal(dispatchedAction, 'plant_redberries',
  'held-seed dispatch delegates the exact semantic crop action to planting metadata bridge');

sandbox.window.HobunjiInventoryActionMetadataBridge.tryPlantAction = () => ({ handled: false, ok: false });
assert.equal(sandbox.window.HobunjiHeldSeedActionBridge.dispatchPlant('plant_redberries'), false,
  'unready planting metadata leaves the native input path available instead of swallowing the action');

const metadataIndex = loader.indexOf('inventory-action-metadata-bridge.js'); // Used to ensure tryPlantAction exists before the held-seed adapter executes.
const seedBridgeIndex = loader.indexOf('held-seed-action-bridge.js'); // Used to verify the new lifecycle adapter is parser-blocking before game.js.
const alcoholIndex = loader.indexOf('alcohol-gameplay-bridge.js'); // Used as the next held-item provider boundary in the existing module order.
assert.ok(metadataIndex >= 0 && seedBridgeIndex > metadataIndex && alcoholIndex > seedBridgeIndex,
  'held-seed lifecycle bridge loads after planting metadata and before later held-item providers');

console.log('held-seed action lifecycle tests passed');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const game = source('docs/game.js'); // Used to pin the exact queue/held-item deadlock that this bridge bypasses.
const bridge = source('docs/js/inventory-action-metadata-bridge.js'); // Used to verify Plant and Harvest share one immediate contextual-item path.

const queueComment = game.indexOf('All other actions are queued to fire at the start of the strike phase'); // Used to locate useActiveAction's generic pendingAction path.
const pendingAssignment = game.indexOf('pendingAction = {', queueComment); // Used to prove ordinary non-immediate actions are still queued for tool animation timing.
const itemModeReturn = game.indexOf("if (heldMode === 'item' || _heldDrinkAnimT > 0)"); // Used to locate the held-item early return that strands those queued crop actions.
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
assert.match(bridge, /rollItemStars\?\.\('farming'\)/,
  'Harvest preserves farming quality rolls');
assert.match(bridge, /recordItemQuality\?\.\(crop, stars, 1\)/,
  'Harvest records the rolled crop quality');
assert.match(bridge, /SkillSystem\?\.award\?\.\('farming'/,
  'Harvest still awards farming skill XP');
assert.match(bridge, /tile\.crop = '';/,
  'Harvest clears the crop using the canonical CropType.NONE value');
assert.match(bridge, /recomputeWater\?\.\(false\)[\s\S]*?markTileDirty\?\.\(reticle\.col, reticle\.row\)[\s\S]*?saveFarmLayout\?\.\(\)/,
  'both crop actions preserve water recomputation, tile rebuild, and farm persistence');
assert.match(bridge, /tryCropAction,[\s\S]*?tryPlantAction,[\s\S]*?tryHarvestAction/,
  'the bridge exposes a single generic crop-action API plus backward-compatible specific entry points');

console.log('immediate crop action routing tests passed');

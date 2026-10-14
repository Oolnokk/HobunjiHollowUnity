#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function replaceOnce(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor in ${file}: ${before.slice(0, 100)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor in ${file}: ${before.slice(0, 100)}`);
  fs.writeFileSync(file, source.slice(0, first) + after + source.slice(first + before.length));
}

const weaving = 'docs/js/clothing-weaving-system.js';
replaceOnce(
  weaving,
  "  let lastError = null; // Most recent recoverable integration/rendering error for mobile diagnostics.\n",
  "  let lastError = null; // Most recent recoverable integration/rendering error for mobile diagnostics.\n  let lastCraftQuality = null; // Mobile-visible record of the cloth quality groups consumed by the most recent loom craft.\n"
);

replaceOnce(
  weaving,
  "  function reweaveMaterialCost(item) {\n    const fullCost = WOOL_COST_BY_SLOT[item?.slot] || 1;\n    return Math.max(1, Math.ceil(fullCost / 2)); // Wool is an indivisible stack item, so odd half-costs round up instead of introducing fractional inventory counts.\n  }\n",
  "  function reweaveMaterialCost(item) {\n    const fullCost = WOOL_COST_BY_SLOT[item?.slot] || 1;\n    return Math.max(1, Math.ceil(fullCost / 2)); // Wool is an indivisible stack item, so odd half-costs round up instead of introducing fractional inventory counts.\n  }\n\n  function consumeWoolWithQuality(itemKey, amount) {\n    const units = Math.max(1, Math.floor(Number(amount) || 1)); // Used as the exact wool count consumed by this garment.\n    const consumeTrackedQuality = window.CookingSystem?.consumeQualityByPolicy; // Reuses the shared 1–5★ inventory buckets instead of creating a second cloth-quality store.\n    if (typeof consumeTrackedQuality === 'function') {\n      const result = consumeTrackedQuality.call(window.CookingSystem, itemKey, units, 'lowest'); // Ordinary automatic consumption protects the player's best-quality stock, matching the rest of inventory crafting.\n      if (!result || !Number.isFinite(Number(result.stars))) return null;\n      return {\n        stars: clamp(Math.round(Number(result.stars)), 1, 5),\n        groups: Array.isArray(result.groups) ? result.groups.map(group => ({ stars: clamp(Math.round(Number(group?.stars)), 1, 5), amount: Math.max(0, Math.floor(Number(group?.amount) || 0)) })).filter(group => group.amount > 0) : [],\n        fallback: false,\n      };\n    }\n\n    const inventory = equipmentDeps?.inventory; // Legacy/bootstrap fallback keeps loom crafting usable if CookingSystem is genuinely unavailable.\n    if (!inventory || Number(inventory[itemKey]) < units) return null;\n    inventory[itemKey] -= units;\n    equipmentDeps?.clampInventoryStack?.(itemKey);\n    return { stars: 3, groups: [{ stars: 3, amount: units }], fallback: true };\n  }\n"
);

replaceOnce(
  weaving,
  "    inventory[material.itemKey] -= cost;\n    equipmentDeps?.clampInventoryStack?.(material.itemKey);\n    const uid = 'gcloth_loom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); // Unique instance id keeps weight/pattern/dyes bound to this literal garment.\n",
  "    const materialQuality = consumeWoolWithQuality(material.itemKey, cost); // Consumes the same wool units from the shared quality buckets and returns their weighted-average star result.\n    if (!materialQuality) {\n      lastError = `Could not resolve ${cost} ${material.label} quality unit${cost === 1 ? '' : 's'}.`;\n      equipmentDeps?.showToast?.('Could not resolve cloth quality for this craft.', false);\n      return false;\n    }\n    lastCraftQuality = { itemKey: material.itemKey, cost, stars: materialQuality.stars, groups: clone(materialQuality.groups), fallback: materialQuality.fallback }; // Used by Pixel Probe/mobile diagnostics to verify exactly which quality units fed the garment.\n    const uid = 'gcloth_loom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); // Unique instance id keeps weight/pattern/dyes bound to this literal garment.\n"
);

replaceOnce(
  weaving,
  "      sellPrice: 0,\n      weaveMaterial: material.id,\n",
  "      sellPrice: 0,\n      qualityStars: materialQuality.stars, // Literal woven garment quality is the rounded weighted average of every cloth unit consumed by this craft.\n      weaveMaterial: material.id,\n"
);

replaceOnce(
  weaving,
  "      portraitPatterns: { ...portraitPatternStats, cacheSize: patternedCanvasCache.size, pending: pendingPatternCanvasPromises.size, gateReaders: portraitGateReaders, gateWriterActive: portraitGateWriterActive, gateWaitingWriters: portraitGateWaitingWriters, gatePreferReaders: portraitGatePreferReaders }, // Mobile-visible counters expose cache behavior plus ordinary-vs-woven gate ownership without a console.\n      lastError,\n",
  "      portraitPatterns: { ...portraitPatternStats, cacheSize: patternedCanvasCache.size, pending: pendingPatternCanvasPromises.size, gateReaders: portraitGateReaders, gateWriterActive: portraitGateWriterActive, gateWaitingWriters: portraitGateWaitingWriters, gatePreferReaders: portraitGatePreferReaders }, // Mobile-visible counters expose cache behavior plus ordinary-vs-woven gate ownership without a console.\n      lastCraftQuality: clone(lastCraftQuality), // Mobile-visible proof of the input quality groups and averaged star result used by the latest loom craft.\n      lastError,\n"
);

replaceOnce(
  weaving,
  "wovenIconVisualKey, reweaveMaterialCost, resolvedPatternMeshScale",
  "wovenIconVisualKey, reweaveMaterialCost, consumeWoolWithQuality, craftFromLoom, resolvedPatternMeshScale"
);

const equipment = 'docs/js/equipment-panel.js';
replaceOnce(
  equipment,
  "      sellPrice: item.sellPrice || 0,\n      // A loom-crafted article",
  "      sellPrice: item.sellPrice || 0,\n      qualityStars: Number.isFinite(Number(item.qualityStars)) ? Math.max(1, Math.min(5, Math.round(Number(item.qualityStars)))) : null, // Preserves literal woven quality when moving a garment from Pack into permanent Gear.\n      // A loom-crafted article"
);

const favor = 'docs/js/favor-heart-balance.js';
replaceOnce(
  favor,
  "  function activeGiftStars() {\n    if (activeGiftContext?.kind !== 'item') return null;\n    return activeGiftContext.stars;\n  }\n",
  "  function activeGiftStars() {\n    if (activeGiftContext?.kind !== 'item' && activeGiftContext?.kind !== 'clothing') return null;\n    return Number.isFinite(Number(activeGiftContext.stars)) ? Number(activeGiftContext.stars) : null;\n  }\n"
);

replaceOnce(
  favor,
  "  function captureHeldGift() {\n    const held = giftingDeps?.getHeldGiftItem?.(); // Used to snapshot the exact held stack before NpcGifting consumes it.\n    if (!held) return null;\n    if (held.kind !== 'item') return { kind: held.kind || 'other', key: held.key || null, stars: null, held };\n    const trackedStars = Number(window.CookingSystem?.peekLowestQuality?.(held.key)); // Used to match the quality bucket NpcGifting is about to consume.\n",
  "  function captureHeldGift() {\n    const held = giftingDeps?.getHeldGiftItem?.(); // Used to snapshot the exact held stack before NpcGifting consumes it.\n    if (!held) return null;\n    if (held.kind === 'clothing') {\n      const wovenStars = Number(held?.instance?.qualityStars); // Used to make literal woven garment quality participate in the same Favor multiplier as other starred gifts.\n      return { kind: 'clothing', key: held?.instance?.uid || held.key || null, stars: Number.isFinite(wovenStars) ? clamp(Math.round(wovenStars), 1, 5) : null, held };\n    }\n    if (held.kind !== 'item') return { kind: held.kind || 'other', key: held.key || null, stars: null, held };\n    const trackedStars = Number(window.CookingSystem?.peekLowestQuality?.(held.key)); // Used to match the quality bucket NpcGifting is about to consume.\n"
);

const weavingTest = 'scripts/test-clothing-weaving-system.js';
replaceOnce(
  weavingTest,
  "windowStub.EquipmentPanel.init(equipmentDeps);\nconst lightTunic = {\n",
  "windowStub.EquipmentPanel.init(equipmentDeps);\n\n// Loom cloth quality uses the shared bucket consumer, averages every required unit, and consumes exactly once.\nconst wovenQualityCalls = [];\nwindowStub.CookingSystem = {\n  consumeQualityByPolicy(key, amount, policy) {\n    wovenQualityCalls.push({ key, amount, policy });\n    equipmentDeps.inventory[key] = Math.max(0, Number(equipmentDeps.inventory[key]) - amount);\n    return { stars: 4, groups: [{ stars: 3, amount: 1 }, { stars: 4, amount: 1 }, { stars: 5, amount: 1 }] };\n  },\n};\nconst qualityInventoryBefore = equipmentDeps.inventory.lightWool; // Used to prove the quality-aware consumer replaces, rather than duplicates, the old raw wool decrement.\nconst qualityResult = api.__test.consumeWoolWithQuality('lightWool', 3);\nassert.deepEqual(wovenQualityCalls.at(-1), { key: 'lightWool', amount: 3, policy: 'lowest' }, 'woven clothing consumes every required cloth unit through the shared lowest-quality-first policy');\nassert.equal(qualityResult.stars, 4, 'three consumed cloth qualities resolve to their shared rounded weighted-average star quality');\nassert.equal(equipmentDeps.inventory.lightWool, qualityInventoryBefore - 3, 'quality-aware cloth consumption removes exactly the recipe cost once');\nequipmentDeps.inventory.lightWool = qualityInventoryBefore;\n\nconst craftSource = fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8'); // Used to guard the private loom path that stores the averaged result on the literal garment.\nassert.match(craftSource, /const materialQuality = consumeWoolWithQuality\(material\.itemKey, cost\)/, 'loom crafting resolves material quality before constructing the garment');\nassert.match(craftSource, /qualityStars: materialQuality\.stars/, 'loom-crafted garments persist their averaged material quality');\n\nconst lightTunic = {\n"
);

const favorTest = 'scripts/test-favor-heart-balance.js';
replaceOnce(
  favorTest,
  "assert.equal(inventory.egg, 0, 'quality bookkeeping still consumes one inventory unit per gift');\n\n// NpcRapport already mutates state.favor by point deltas; v4 deliberately leaves that point-space mutation alone.\n",
  "assert.equal(inventory.egg, 0, 'quality bookkeeping still consumes one inventory unit per gift');\n\n// Woven clothing carries literal star quality instead of an inventory quality bucket; it uses the same stars/5 Favor authority without trying to consume CookingSystem quality.\nconst consumedBeforeWovenGift = consumedQuality.length; // Used to prove instance clothing never removes a second stack-quality unit.\nheld = { kind: 'clothing', key: 'wovenGift', instance: { uid: 'woven-gift-4star', qualityStars: 4 } };\ninventory.wovenGift = 1;\nNpcGifting.offerGift({ rec: { id: 'woven_quality' }, giftScore: 10 });\nassert.equal(rawState('woven_quality').favor, 8, 'four-star woven clothing scales a loved +10 gift to +8 Favor');\nassert.equal(rewards.at(-1)?.text, '+8 Favor', 'woven clothing quality scales the player-facing Favor reward too');\nassert.equal(consumedQuality.length, consumedBeforeWovenGift, 'woven clothing quality is instance metadata and does not consume a CookingSystem quality bucket');\n\n// NpcRapport already mutates state.favor by point deltas; v4 deliberately leaves that point-space mutation alone.\n"
);

console.log('Applied woven clothing quality + gift-value patch.');

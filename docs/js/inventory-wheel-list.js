// The item wheel's list (window.InventoryWheelList): owned, wheel-eligible
// inventory stacks in catalog order. Every held-item consumer reads it: the
// active-item scroll, the desktop selection arc (action-arc-ui.js),
// refreshActionBar's held-item resolution, the two inventory "Hold" buttons.
// Extracted from game.js, which calls init(deps) once and delegates
// getInventoryStackItems() here.
//
// Building it runs ItemProcessing.isWheelEligible over every owned item
// (processing outputs for every method, the churn check, a catalog scan):
// ~3 ms a build in the user's town trace, where it was rebuilt every frame
// (checkTransitionSpots → refreshActionBar). The list only changes when the
// owned keys, their definitions, the item catalog, the manually held item or
// the eligibility provider change, and every read checks all of those; so a
// valid list is now reused across frames, and rebuilt at least every
// REFRESH_MS anyway for what those checks cannot see (late-loaded recipe or
// alchemy data, a definition edited in place). setCrossFrameEnabled(false)
// (Settings → Render optimizations → "Reuse the item wheel list across
// frames") restores the once-per-frame rebuild.
(() => {
  'use strict';
  if (window.InventoryWheelList) return;

  const REFRESH_MS = 500;
  let deps = null; // { inventory, ITEM_DEFS, inventoryItems, getInventoryStackKeys, getManualHeldItem, getFrameSerial }
  let crossFrame = true;
  const cache = { frame: -1, builtAt: -Infinity, keys: [], defs: [], catalog: [], held: null, eligible: null, stacks: [], reads: 0, builds: 0, crossFrameReuses: 0 };
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function init(injected) {
    deps = injected;
    cache.frame = -1; cache.builtAt = -Infinity; cache.eligible = null; // Reinitialization cannot inherit another world's wheel list.
    return window.InventoryWheelList;
  }

  function sameInputs(eligible, held) {
    const { inventory, ITEM_DEFS, inventoryItems } = deps;
    if (cache.eligible !== eligible || cache.held !== held || inventoryItems.length !== cache.catalog.length) return false;
    // Validate membership without allocating/filtering a new key array on every
    // hot read. Direct inventory mutations remain visible in the same frame.
    let i = 0;
    for (const key in inventory) {
      if (!Object.prototype.hasOwnProperty.call(inventory, key) || key === 'gold' || !ITEM_DEFS[key] || !(inventory[key] > 0)) continue;
      if (key !== cache.keys[i] || ITEM_DEFS[key] !== cache.defs[i]) return false;
      i++;
    }
    if (i !== cache.keys.length) return false;
    for (let j = 0; j < inventoryItems.length; j++) if (inventoryItems[j] !== cache.catalog[j]) return false;
    return true;
  }

  function getStackItems() {
    const { inventory, ITEM_DEFS, inventoryItems } = deps;
    const eligible = window.ItemProcessing.isWheelEligible; // A replacement eligibility provider also invalidates the list.
    const held = deps.getManualHeldItem();
    const frame = deps.getFrameSerial();
    cache.reads++;
    const fresh = cache.frame === frame || (crossFrame && now() - cache.builtAt < REFRESH_MS);
    if (fresh && sameInputs(eligible, held)) {
      if (cache.frame !== frame) { cache.crossFrameReuses++; cache.frame = frame; }
      return cache.stacks;
    }
    // isWheelEligible decides what the wheel may cycle; items it excludes stay fully visible and sellable in
    // the inventory grid (see its own comment in item-processing.js, and selectInventoryItem's Hold button).
    const itemsByKey = new Map(); // Reuses the first catalog entry, matching the previous Array.find behavior.
    inventoryItems.forEach(item => { if (!itemsByKey.has(item.key)) itemsByKey.set(item.key, item); });
    cache.stacks = deps.getInventoryStackKeys('all').filter(eligible).map(key => itemsByKey.get(key) || {
      key,
      icon: ITEM_DEFS[key].icon,
      label: ITEM_DEFS[key].label.toUpperCase(),
      max: 99,
    });
    cache.frame = frame;
    cache.builtAt = now();
    const keys = Object.keys(inventory).filter(key => key !== 'gold' && ITEM_DEFS[key] && (inventory[key] || 0) > 0); // Allocate only on cache rebuild.
    cache.keys = keys;
    cache.defs = keys.map(key => ITEM_DEFS[key]);
    cache.catalog = inventoryItems.slice();
    cache.held = held;
    cache.eligible = eligible;
    cache.builds++;
    return cache.stacks;
  }

  window.InventoryWheelList = Object.freeze({
    REFRESH_MS,
    init,
    getStackItems,
    crossFrameEnabled: () => crossFrame,
    setCrossFrameEnabled(value) { crossFrame = value !== false; return crossFrame; },
    // Counters for the item-sprite diagnostics (Pixel Probe) and the perf log.
    snapshot: () => ({ reads: cache.reads, builds: cache.builds, frame: cache.frame, crossFrameReuses: cache.crossFrameReuses, crossFrame }),
  });
})();

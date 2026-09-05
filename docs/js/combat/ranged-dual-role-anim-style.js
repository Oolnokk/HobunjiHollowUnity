// Slot-aware animation-style adapter for items that can be equipped as both
// melee weapons and ranged weapons. game.js resolves animStyle from one shared
// item definition, so this getter preserves the melee style in the weapon slot
// and reports `ranged` only while that same item occupies the active ranged slot.
(() => {
  'use strict';

  const VERSION = 1;
  const DUAL_ROLE_SHAPES = new Set(['kylie', 'bshuakauitl']);
  const patched = new Set(); // Used by the mobile debug snapshot and idempotent patching.

  function install(itemKey, def) {
    if (!def || def.__dualRoleRangedAnimStyleInstalled) return false;
    const shapeKey = def.shapeKey || itemKey;
    if (!DUAL_ROLE_SHAPES.has(shapeKey)) return false;
    const meleeAnimStyle = def.animStyle || 'sweep'; // Used whenever this dual-role item is not the actively drawn ranged weapon.
    Object.defineProperty(def, '__dualRoleRangedAnimStyleInstalled', { configurable: true, value: true });
    Object.defineProperty(def, '__dualRoleMeleeAnimStyle', { configurable: true, writable: true, value: meleeAnimStyle });
    Object.defineProperty(def, 'animStyle', {
      configurable: true,
      enumerable: true,
      get() {
        const activeTool = window.Combat?.deps?.getActiveTool?.();
        const activeRanged = window.RangedWeapons?.equippedRangedKey?.();
        return activeTool === 'ranged' && activeRanged === itemKey ? 'ranged' : this.__dualRoleMeleeAnimStyle;
      },
      set(value) {
        if (value && value !== 'ranged') this.__dualRoleMeleeAnimStyle = value;
      },
    });
    patched.add(itemKey);
    return true;
  }

  function refresh() {
    const defs = window.Combat?.deps?.TOOL_ITEM_DEFS;
    if (!defs) return false;
    let changed = 0;
    for (const [itemKey, def] of Object.entries(defs)) if (install(itemKey, def)) changed++;
    if (changed) window.__farmLog?.(`[ranged-dual-role] installed slot-aware animStyle on ${changed} item(s).`, 'combat');
    return patched.size > 0;
  }

  let attempts = 0; // Used to stop bootstrap polling after generated equipment definitions should exist.
  const timer = setInterval(() => {
    attempts++;
    if ((window.HobunjiRangedWeaponArchetypes?.patchGeneratedDefinitions?.() && refresh()) || attempts >= 160) clearInterval(timer);
  }, 50);

  window.HobunjiDualRoleRangedAnimStyle = {
    version: VERSION,
    refresh,
    debugSnapshot: () => ({ version: VERSION, patchedItems: [...patched] }),
  };
})();

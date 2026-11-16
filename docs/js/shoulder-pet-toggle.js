// Shoulder pet quick toggle (Alt+P, wired through js/qol-hotkeys.js).
//
// Dequips the active shoulder pet, or re-equips the one that was last
// dequipped (falling back to the first eligible stable entry). Only the
// stable's active-shoulder-pet id changes, exactly like equipping it from the
// Stable tab, so the existing companion/compositor code does the rest.
(() => {
  'use strict';

  let deps = null; // { getStable, getActiveId, setActiveId, saveStable, stableEntryRole, showToast }
  let dequippedId = null; // The pet to restore on the next toggle.

  function init(nextDeps) { deps = nextDeps || null; }

  function eligible(entry) {
    return !!entry && !entry.stowed && deps.stableEntryRole(entry) === 'shoulderPet';
  }

  function nameOf(entry) { return entry?.name || 'Shoulder pet'; }

  // Returns 'dequipped', 'equipped' or null when there is nothing to toggle.
  function toggle() {
    if (!deps) return null;
    const stable = deps.getStable() || [];
    const activeId = deps.getActiveId();
    if (activeId) {
      const entry = stable.find(item => item.id === activeId);
      dequippedId = activeId;
      deps.setActiveId(null);
      deps.saveStable();
      deps.showToast(`${nameOf(entry)} hops down from your shoulder`, true, true);
      return 'dequipped';
    }
    const remembered = stable.find(item => item.id === dequippedId);
    const next = eligible(remembered) ? remembered : stable.find(eligible);
    if (!next) {
      deps.showToast('No shoulder pet to equip', false, true);
      return null;
    }
    deps.setActiveId(next.id);
    deps.saveStable();
    deps.showToast(`${nameOf(next)} perches on your shoulder`, true, true);
    return 'equipped';
  }

  window.ShoulderPetToggle = { init, toggle };
})();

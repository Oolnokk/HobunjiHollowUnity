// Single-write gear + world-member transactions for Garanki's enchanting services.
// Reuse CharacterMetaSave.update so pending character patches and world membership remain coherent.
(() => {
  'use strict';
  let deps = null; // Live gear, inventory and member-capture accessors supplied by game.js.
  let attempts = 0; // Mobile transaction diagnostics: requests attempted.
  let commits = 0; // Mobile transaction diagnostics: successful writes.
  let rollbacks = 0; // Mobile transaction diagnostics: rejected writes/mutations.
  let lastError = null; // Most recent rejection, visible without desktop devtools.

  function init(injectedDeps) { deps = injectedDeps; }
  function persistBoth() {
    if (!deps?.getGearInventory || !deps?.captureMemberWorldData || !window.CharacterMetaSave?.update) return false;
    return window.CharacterMetaSave.update((character, meta) => {
      const captured = deps.captureMemberWorldData(meta); // Canonical world-member serializer; preserves all existing fields.
      if (!captured) throw new Error('Cannot capture member state');
      character.gearInventory = deps.getGearInventory(); // Same write also saves character-scoped weapons and enchantments.
    }) === true;
  }
  function run({ inventoryKeys = [], mutate } = {}) {
    attempts++;
    if (!deps?.getGearInventory || !deps?.inventory || typeof mutate !== 'function') {
      lastError = 'Transaction not initialized';
      return { ok: false, reason: 'unavailable' };
    }
    const gear = deps.getGearInventory(); // Live object must be restored in place if persistence fails.
    if (!gear || typeof gear !== 'object') return { ok: false, reason: 'gear' };
    let snapshot;
    try { snapshot = JSON.stringify(gear); }
    catch (error) { lastError = 'Gear snapshot failed: ' + String(error); return { ok: false, reason: 'snapshot' }; }
    if (!snapshot) return { ok: false, reason: 'snapshot' };
    const keys = new Set(['gold', ...inventoryKeys]); // Only inventory fields touched by this operation are snapshotted.
    const bagBefore = [...keys].map(key => [key, Object.hasOwn(deps.inventory, key), deps.inventory[key]]);
    const rollback = () => {
      const restored = JSON.parse(snapshot);
      for (const key of Object.keys(gear)) delete gear[key];
      Object.assign(gear, restored);
      for (const [key, existed, value] of bagBefore) {
        if (existed) deps.inventory[key] = value;
        else delete deps.inventory[key];
      }
      rollbacks++;
      deps.buildInventoryGrid?.();
      deps.buildEquipmentSlots?.();
    };
    try {
      const result = mutate();
      if (!result || result.ok !== true) { rollback(); return result || { ok: false, reason: 'mutation' }; }
      if (!persistBoth()) {
        rollback();
        lastError = 'Gear/member save rejected';
        deps.showToast?.('Could not save the enchanting changes. No ganang or items were spent.', false);
        return { ok: false, reason: 'save' };
      }
      commits++;
      lastError = null;
      return result;
    } catch (error) {
      rollback();
      lastError = String(error?.message || error);
      console.warn('[gear-member-transaction] Rolled back failed mutation:', error);
      return { ok: false, reason: 'exception' };
    }
  }
  function debugSnapshot() { return { attempts, commits, rollbacks, lastError, initialized: !!deps }; }
  window.GearMemberTransaction = Object.freeze({ init, run, debugSnapshot });
  window.DevCompanion?.registerStateProvider?.('gearMemberTransaction', debugSnapshot);
})();
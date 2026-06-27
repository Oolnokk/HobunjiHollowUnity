// Combat loadout — the 4 swappable ability slots bound to the weapon tool's
// two inputs (tap1/hold1 = tool action 1, tap2/hold2 = tool action 2).
// Ability modules (combo, quick attacks, holds, ...) call
// Combat.abilities.register() to offer themselves for a slot family; the
// player picks which registered ability occupies each slot via
// Combat.loadout.setSlot() (UI for that lands in a later combat-loadout-ui
// module). Persisted per-character, mirroring game.js's own
// saveGearInventory()/spawnPlayerAvatar() pattern, but self-contained here
// since window.__hobunjiPlayerProfile and localStorage are plain globals —
// this module doesn't need anything from game.js's closure to load or save.
(() => {
  "use strict";
  if (!window.Combat) { console.error('combat-loadout.js requires combat-core.js to load first'); return; }

  const SLOT_IDS = ['tap1', 'tap2', 'hold1', 'hold2'];
  const SLOT_FAMILY = { tap1: 'tap', tap2: 'tap', hold1: 'hold', hold2: 'hold' };

  // These ids don't have to be registered yet for the loadout to reference
  // them — combat-combo.js/combat-quickattacks.js/combat-counter-shield.js/
  // etc. (later commits) self-register under exactly these ids. Until they
  // do, combat-input.js's dispatcher falls back to the legacy cut/slash
  // weapon swing for the tap slots, and no-ops for the (currently
  // nonexistent) hold slots.
  const DEFAULT_LOADOUT = {
    tap1: 'swingCombo',
    tap2: 'opportunistJab',
    hold1: 'chargedBreaker',
    hold2: 'counterShield',
  };

  const abilities = new Map();
  let loadout = { ...DEFAULT_LOADOUT };

  function registerAbility(id, def) {
    abilities.set(id, { ...def, id, label: def.label || id });
  }

  function unregisterAbility(id) {
    abilities.delete(id);
  }

  function getAbility(id) {
    return abilities.get(id) || null;
  }

  function listAbilitiesForFamily(family) {
    return Array.from(abilities.values()).filter(a => a.slotFamily === family);
  }

  function getLoadout() {
    return { ...loadout };
  }

  function getSlot(slotId) {
    return loadout[slotId] ?? null;
  }

  // Returns false (and leaves the loadout unchanged) if slotId is invalid or
  // abilityId belongs to the wrong slot family (e.g. a hold ability can't be
  // assigned to a tap slot). Registration order doesn't matter for this
  // check — an ability not registered yet is allowed through so the default
  // loadout above can reference ids before their modules load.
  function setSlot(slotId, abilityId) {
    if (!SLOT_IDS.includes(slotId)) return false;
    const def = abilities.get(abilityId);
    if (def && def.slotFamily !== SLOT_FAMILY[slotId]) return false;
    loadout[slotId] = abilityId;
    persist();
    return true;
  }

  function serialize() {
    return { ...loadout };
  }

  function load(saved) {
    loadout = { ...DEFAULT_LOADOUT };
    if (saved && typeof saved === 'object') {
      for (const slotId of SLOT_IDS) {
        if (typeof saved[slotId] === 'string' && saved[slotId]) loadout[slotId] = saved[slotId];
      }
    }
  }

  function persist() {
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      if (!meta || !window.__hobunjiPlayerProfile?.characterId) return;
      const ch = (meta.characters || []).find(c => c.id === window.__hobunjiPlayerProfile.characterId);
      if (ch) {
        ch.combatLoadout = serialize();
        localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
      }
    } catch {}
  }

  function loadFromProfile(playerData) {
    load(playerData?.combatLoadout);
  }

  document.addEventListener('hobunjiPlayerReady', (e) => loadFromProfile(e.detail));
  // Mirrors game.js's own race-condition guard: if onboarding already fired
  // before this listener was registered, __hobunjiPlayerProfile is already set.
  if (window.__hobunjiPlayerProfile) loadFromProfile(window.__hobunjiPlayerProfile);

  window.Combat.abilities = {
    register: registerAbility,
    unregister: unregisterAbility,
    get: getAbility,
    listForFamily: listAbilitiesForFamily,
  };
  window.Combat.loadout = {
    SLOT_IDS,
    SLOT_FAMILY,
    get: getLoadout,
    getSlot,
    setSlot,
    serialize,
    load,
  };
})();

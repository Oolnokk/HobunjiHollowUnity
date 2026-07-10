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

  // Each slot is further restricted to a fixed ability category (finer than
  // slotFamily's plain tap/hold split): tap1 is always the weapon's own
  // Combo (see below — not player-selectable), tap2 only takes a Quick
  // Attack, hold1 takes either a Defensive or Offensive hold, and hold2
  // only takes an Offensive hold.
  const SLOT_CATEGORIES = {
    tap1: ['combo'],
    tap2: ['quickAttack'],
    hold1: ['defensiveHold', 'offensiveHold'],
    hold2: ['offensiveHold'],
  };

  // These ids don't have to be registered yet for the loadout to reference
  // them — combat-combo.js/combat-quickattacks.js/combat-counter-shield.js/
  // etc. (later commits) self-register under exactly these ids. Until they
  // do, combat-input.js's dispatcher falls back to the legacy cut/slash
  // weapon swing for the tap slots, and no-ops for the (currently
  // nonexistent) hold slots. tap1 has no default entry — it's never stored,
  // see getSlot()/setSlot() below.
  const DEFAULT_LOADOUT = {
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

  // Narrower than listAbilitiesForFamily — filters by the ability's own
  // `category` (combo/quickAttack/defensiveHold/offensiveHold) rather than
  // just its tap/hold family, matching a slot's SLOT_CATEGORIES entry.
  function listAbilitiesForCategories(categories) {
    return Array.from(abilities.values()).filter(a => categories.includes(a.category));
  }

  // tap1 (the Combo slot) is never player-chosen — it always reflects
  // whichever combo matches the currently equipped weapon (game.js's
  // currentComboAbilityId(), wired in as deps), so its "loadout" value is
  // computed live rather than stored, and always reflects any weapon swap
  // immediately without needing its own equip-time hook.
  function comboAbilityId() {
    return window.Combat.deps?.currentComboAbilityId?.() || 'swingCombo';
  }

  function getLoadout() {
    return { ...loadout, tap1: comboAbilityId() };
  }

  function getSlot(slotId) {
    if (slotId === 'tap1') return comboAbilityId();
    return loadout[slotId] ?? null;
  }

  // Returns false (and leaves the loadout unchanged) if slotId is invalid,
  // abilityId belongs to the wrong slot family, or (once registered) the
  // wrong category for that slot. tap1 can never be set — it's derived, not
  // stored (see comboAbilityId() above). Registration order doesn't matter
  // for the category/family check — an ability not registered yet is
  // allowed through so the default loadout above can reference ids before
  // their modules load.
  function setSlot(slotId, abilityId) {
    if (slotId === 'tap1') return false;
    if (!SLOT_IDS.includes(slotId)) return false;
    const def = abilities.get(abilityId);
    if (def && def.slotFamily !== SLOT_FAMILY[slotId]) return false;
    if (def && !SLOT_CATEGORIES[slotId].includes(def.category)) return false;
    loadout[slotId] = abilityId;
    persist();
    return true;
  }

  function serialize() {
    // tap1 is derived, never persisted.
    const { tap1, ...rest } = loadout;
    return { ...rest };
  }

  function load(saved) {
    loadout = { ...DEFAULT_LOADOUT };
    if (saved && typeof saved === 'object') {
      for (const slotId of SLOT_IDS) {
        if (slotId === 'tap1') continue;
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
    listForCategories: listAbilitiesForCategories,
  };
  window.Combat.loadout = {
    SLOT_IDS,
    SLOT_FAMILY,
    SLOT_CATEGORIES,
    get: getLoadout,
    getSlot,
    setSlot,
    serialize,
    load,
  };
})();

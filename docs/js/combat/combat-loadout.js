// Combat loadout — the 4 swappable ability slots bound to the weapon tool's
// two inputs (tap1/hold1 = tool action 1, tap2/hold2 = tool action 2).
// Ability modules (combo, quick attacks, holds, ...) call
// Combat.abilities.register() to offer themselves for a slot family; the
// player picks which registered ability occupies each slot via
// Combat.loadout.setSlot() (UI for that lands in a later combat-loadout-ui
// module).
//
// tap2/hold1/hold2 are stored per equipped weapon (game.js's
// currentWeaponKey() — the gear-inventory item key, e.g. 'hatchet') rather
// than as one global loadout: switching weapons switches which Quick
// Attack/Held picks are active, and each weapon remembers its own the next
// time it's re-equipped. This is independent of each ability's own 5-level
// upgrade progression (combat-progression.js), which stays global across
// every weapon. Persisted per-character, mirroring game.js's own
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
  // Attack, hold2 (paired with tap2's own input — see combat-input.js's
  // slot 2) takes either a Defensive or Offensive hold, and hold1 (paired
  // with the Combo's input) only takes an Offensive hold — holding the
  // combo button should never be able to put you in a defensive stance.
  const SLOT_CATEGORIES = {
    tap1: ['combo'],
    tap2: ['quickAttack'],
    hold1: ['offensiveHold'],
    hold2: ['defensiveHold', 'offensiveHold'],
  };

  // These ids don't have to be registered yet for the loadout to reference
  // them — combat-combo.js/combat-quickattacks.js/combat-counter-shield.js/
  // etc. (later commits) self-register under exactly these ids. Until they
  // do, combat-input.js's dispatcher falls back to the legacy cut/slash
  // weapon swing for the tap slots, and no-ops for the (currently
  // nonexistent) hold slots. tap1 has no default entry — it's never stored,
  // see getSlot()/setSlot() below. Applied to any weapon key that hasn't
  // been configured yet — see weaponLoadout() below.
  const DEFAULT_SLOT_LOADOUT = {
    tap2: 'opportunistJab',
    hold1: 'chargedBreaker',
    hold2: 'counterShield',
  };

  const abilities = new Map();
  // weaponKey -> { tap2, hold1, hold2 } — see weaponKey()/weaponLoadout()
  // below. Keys are lazily created on first setSlot() for that weapon;
  // reading an unconfigured weapon's loadout just returns the defaults
  // above without creating an entry.
  let loadoutsByWeapon = {};

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

  // Keys tap2/hold1/hold2's per-weapon storage — game.js's
  // currentWeaponKey() (the equipped gear-inventory item key), or 'none'
  // while nothing's equipped so the loadout UI still has somewhere to work
  // against.
  function weaponKey() {
    return window.Combat.deps?.currentWeaponKey?.() || 'none';
  }

  function weaponLoadout(key) {
    return loadoutsByWeapon[key] || DEFAULT_SLOT_LOADOUT;
  }

  function getLoadout() {
    return { ...weaponLoadout(weaponKey()), tap1: comboAbilityId() };
  }

  function getSlot(slotId) {
    if (slotId === 'tap1') return comboAbilityId();
    return weaponLoadout(weaponKey())[slotId] ?? null;
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
    const key = weaponKey();
    if (!loadoutsByWeapon[key]) loadoutsByWeapon[key] = { ...DEFAULT_SLOT_LOADOUT };
    loadoutsByWeapon[key][slotId] = abilityId;
    persist();
    return true;
  }

  function serialize() {
    return JSON.parse(JSON.stringify(loadoutsByWeapon));
  }

  function load(saved) {
    loadoutsByWeapon = {};
    if (!saved || typeof saved !== 'object') return;
    for (const [key, slots] of Object.entries(saved)) {
      if (!slots || typeof slots !== 'object') continue;
      const clean = {};
      for (const slotId of ['tap2', 'hold1', 'hold2']) {
        if (typeof slots[slotId] === 'string' && slots[slotId]) clean[slotId] = slots[slotId];
      }
      if (Object.keys(clean).length) loadoutsByWeapon[key] = clean;
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

// Weapon/tool idle stance bootstrap. EquipmentPanel is the existing narrow
// owner of tool definitions, slot assignments, and held-tool meshes; capture
// its normal init(deps) call rather than widening game.js with another system.
(() => {
  'use strict';

  let stanceInitDeps = null; // Last EquipmentPanel init payload, used if the stance script finishes loading afterward.
  let equipmentPanelValue = window.EquipmentPanel || null; // Temporary value behind the pre-definition window accessor below.

  function initializeStancesIfReady() {
    if (!stanceInitDeps || !window.WeaponToolStances?.init) return;
    window.WeaponToolStances.init(stanceInitDeps);
  }

  function wrapEquipmentPanel(panel) {
    if (!panel || panel.__weaponToolStanceInitWrapped) return panel;
    const originalInit = panel.init; // Existing EquipmentPanel initializer remains authoritative and runs first.
    if (typeof originalInit !== 'function') return panel;

    panel.init = function weaponToolStanceAwareEquipmentInit(injectedDeps) {
      const result = originalInit.call(this, injectedDeps); // Preserve all existing equipment/inventory initialization behavior.
      stanceInitDeps = injectedDeps;
      initializeStancesIfReady();
      return result;
    };
    Object.defineProperty(panel, '__weaponToolStanceInitWrapped', { value: true, configurable: true });
    return panel;
  }

  if (equipmentPanelValue) {
    equipmentPanelValue = wrapEquipmentPanel(equipmentPanelValue);
    window.EquipmentPanel = equipmentPanelValue;
  } else {
    // equipment-panel.js is parser-loaded later than combat-loadout.js. Intercept
    // its one assignment, wrap init, then immediately restore a normal writable
    // global property so no later code has to know this bootstrap existed.
    Object.defineProperty(window, 'EquipmentPanel', {
      configurable: true,
      enumerable: true,
      get() { return equipmentPanelValue; },
      set(value) {
        equipmentPanelValue = wrapEquipmentPanel(value);
        Object.defineProperty(window, 'EquipmentPanel', {
          value: equipmentPanelValue,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      },
    });
  }

  if (!window.WeaponToolStances && typeof document !== 'undefined') {
    const existingScript = document.querySelector('script[data-weapon-tool-stances]'); // Prevents duplicate loads if this script is re-evaluated in dev mode.
    if (!existingScript) {
      const script = document.createElement('script'); // Dynamically loads the isolated stance runtime without adding another game.js dependency.
      script.src = 'js/weapon-tool-stances.js?v=20260814a';
      script.async = false;
      script.dataset.weaponToolStances = 'true';
      script.onload = initializeStancesIfReady;
      script.onerror = () => window.__farmLog?.('[weapon-stance] failed to load js/weapon-tool-stances.js', 'warn');
      (document.head || document.documentElement).appendChild(script);
    }
  } else {
    initializeStancesIfReady();
  }
})();

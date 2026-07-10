// Combat loadout UI — lets the player view/swap which ability occupies each
// of the weapon tool's 4 category-locked slots (see combat-loadout.js's
// SLOT_CATEGORIES: tap1 Combo/auto, tap2 Quick Attack, hold1 Defensive-or-
// Offensive Held, hold2 Offensive Held), and for whichever ability currently
// sits in each slot, pick that ability's 5-level upgrade tree one choice at
// a time (see combat-progression.js). Pure DOM wiring against window.Combat/
// window.CombatProgression's public API — no game.js changes needed, since
// the panel already lives inside #menuPanel and is covered by the menu's
// existing input-blocking (menuOpen/paused).
(() => {
  "use strict";
  if (!window.Combat?.loadout) { console.error('combat-loadout-ui.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const SLOTS = [
    { id: 'tap1', name: 'Combo', desc: 'Left click (desktop) tapped quickly. Always your equipped weapon’s own 3-hit combo — not player-chosen.', readOnly: true },
    { id: 'tap2', name: 'Quick Attack', desc: 'Right click (desktop) tapped quickly. Choose which conditional technique fires.' },
    { id: 'hold1', name: 'Held — Defensive or Offensive', desc: 'Left click held past a beat. Choose a defensive stance or a heavy release.' },
    { id: 'hold2', name: 'Held — Offensive', desc: 'Right click held past a beat. Choose a heavy release.' },
  ];

  // Which slot (if any) currently has its level-options picker expanded —
  // { abilityId, level } or null. Not persisted; purely local UI state.
  let expandedFor = null;

  function levelStateClass(abilityId, level) {
    if (window.CombatProgression.getChosenOption(abilityId, level)) return 'chosen';
    return window.CombatProgression.isLevelAvailable(abilityId, level) ? 'available' : 'locked';
  }

  function renderLevelPicker(container, abilityId) {
    // The option POOL a not-yet-chosen level offers follows whichever
    // weapon is equipped right now (see combat-progression.js's file
    // header) — an already-chosen level's label instead comes from
    // getChosenOption(), which resolves via the weapon type that was
    // active when that choice was made, not the current one.
    const weaponType = window.Combat.deps?.currentWeaponDamageType?.() || 'sharp';
    const liveTree = window.CombatProgression.getTree(abilityId, weaponType);
    if (!liveTree) return; // abilities with no defined tree (shouldn't happen) render nothing

    const levels = document.createElement('div');
    levels.className = 'loadout-levels';
    for (let level = 1; level <= 5; level++) {
      const state = levelStateClass(abilityId, level);
      const box = document.createElement('div');
      box.className = 'loadout-level ' + state;
      const num = document.createElement('span');
      num.className = 'lv-num';
      num.textContent = 'Lv' + level;
      box.appendChild(num);
      const labelSpan = document.createElement('span');
      labelSpan.className = 'lv-label';
      if (state === 'chosen') {
        labelSpan.textContent = window.CombatProgression.getChosenOption(abilityId, level)?.label || '';
      } else if (state === 'available') {
        labelSpan.textContent = 'Choose';
        box.addEventListener('click', () => {
          expandedFor = (expandedFor?.abilityId === abilityId && expandedFor?.level === level) ? null : { abilityId, level };
          render();
        });
      } else {
        labelSpan.textContent = 'Locked';
      }
      box.appendChild(labelSpan);
      levels.appendChild(box);
    }
    container.appendChild(levels);

    if (expandedFor && expandedFor.abilityId === abilityId) {
      const options = liveTree[expandedFor.level - 1];
      const panel = document.createElement('div');
      panel.className = 'loadout-options';
      options.forEach((option, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'loadout-option-btn';
        const name = document.createElement('div');
        name.className = 'loadout-option-name';
        name.textContent = option.label;
        const desc = document.createElement('div');
        desc.className = 'loadout-option-desc';
        desc.textContent = option.desc;
        btn.appendChild(name);
        btn.appendChild(desc);
        btn.addEventListener('click', () => {
          window.CombatProgression.choose(abilityId, expandedFor.level, idx);
          expandedFor = null;
          render();
        });
        panel.appendChild(btn);
      });
      container.appendChild(panel);
    }
  }

  function render() {
    const pane = document.getElementById('combatLoadoutPane');
    if (!pane) return;
    pane.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'settings-section-title';
    title.textContent = 'Weapon Tool Loadout';
    pane.appendChild(title);

    // Quick Attack/Held picks below are stored per equipped weapon (see
    // combat-loadout.js) — a different weapon has its own independent set.
    const weaponLabel = window.Combat.deps?.currentWeaponLabel?.() || 'No weapon equipped';
    const weaponNote = document.createElement('div');
    weaponNote.className = 'loadout-slot-combo-note';
    weaponNote.style.marginBottom = '6px';
    weaponNote.textContent = `Quick Attack / Held picks below are saved for: ${weaponLabel}`;
    pane.appendChild(weaponNote);

    for (const slot of SLOTS) {
      const card = document.createElement('div');
      card.className = 'loadout-slot';

      const head = document.createElement('div');
      head.className = 'loadout-slot-head';

      const label = document.createElement('div');
      label.className = 'settings-label';
      const name = document.createElement('div');
      name.className = 'settings-name';
      name.textContent = slot.name;
      const desc = document.createElement('div');
      desc.className = 'settings-desc';
      desc.textContent = slot.desc;
      label.appendChild(name);
      label.appendChild(desc);
      head.appendChild(label);

      const abilityId = window.Combat.loadout.getSlot(slot.id);

      if (slot.readOnly) {
        const readout = document.createElement('div');
        readout.className = 'settings-name';
        readout.textContent = window.Combat.abilities.get(abilityId)?.label || abilityId;
        head.appendChild(readout);
      } else {
        const select = document.createElement('select');
        select.className = 'settings-select';
        select.id = 'combatLoadout_' + slot.id;

        const categories = window.Combat.loadout.SLOT_CATEGORIES[slot.id];
        for (const ability of window.Combat.abilities.listForCategories(categories)) {
          const opt = document.createElement('option');
          opt.value = ability.id;
          opt.textContent = ability.label;
          if (ability.id === abilityId) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => {
          window.Combat.loadout.setSlot(slot.id, select.value);
          expandedFor = null;
          render();
        });
        head.appendChild(select);
      }

      card.appendChild(head);
      if (slot.readOnly) {
        const note = document.createElement('div');
        note.className = 'loadout-slot-combo-note';
        note.textContent = 'Auto-selected by your equipped weapon’s swing style.';
        card.appendChild(note);
      }

      if (abilityId) renderLevelPicker(card, abilityId);

      pane.appendChild(card);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    const tab = document.querySelector('.mp-tab[data-mpanel="loadout"]');
    if (tab) tab.addEventListener('click', () => { expandedFor = null; render(); });
  });
})();

// Combat loadout UI — lets the player view/swap which ability occupies each
// of the weapon tool's 4 category-locked slots (see combat-loadout.js's
// SLOT_CATEGORIES: tap1 Combo/auto, tap2 Quick Attack, hold1 Defensive-or-
// Offensive Held, hold2 Offensive Held), and for whichever ability currently
// sits in each slot, pick (or later change) that ability's 5-level upgrade
// tree one choice at a time (see combat-progression.js) — gated by the
// currently equipped tool's own Mastery level and paid for with Motes of
// Prowess. Pure DOM wiring against window.Combat/window.CombatProgression's
// public API — no game.js changes needed, since the panel already lives
// inside #menuPanel and is covered by the menu's existing input-blocking
// (menuOpen/paused).
(() => {
  "use strict";
  if (!window.Combat?.loadout) { console.error('combat-loadout-ui.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const SLOTS = [
    { id: 'tap1', name: 'Combo', desc: 'Left click (desktop) tapped quickly. Always your equipped weapon’s own 3-hit combo — not player-chosen.', readOnly: true },
    { id: 'tap2', name: 'Quick Attack', desc: 'Right click (desktop) tapped quickly. Choose which conditional technique fires.' },
    { id: 'hold1', name: 'Held — Defensive or Offensive', desc: 'Left click held past a beat. Choose a defensive stance or a heavy release.' },
    { id: 'hold2', name: 'Held — Offensive', desc: 'Right click held past a beat. Choose a heavy release.' },
  ];

  // Which level (if any) currently has its options picker expanded — an
  // abilityId+level pair (toolKey is implicitly whatever's equipped right
  // now, since the whole pane re-renders on any equip change). Not
  // persisted; purely local UI state.
  let expandedFor = null;

  function renderRangedLoadout(pane) {
    const ranged = window.RangedWeapons;
    const itemKey = ranged?.equippedRangedKey?.();
    if (!ranged || !itemKey) return;
    const view = ranged.getLoadoutView(itemKey);
    const weaponLabel = ranged.config?.[itemKey]?.label || itemKey;

    const title = document.createElement('div');
    title.className = 'settings-section-title ranged-loadout-title';
    title.textContent = 'Ranged Weapon Loadout';
    pane.appendChild(title);

    const note = document.createElement('div');
    note.className = 'loadout-slot-combo-note';
    note.style.marginBottom = '8px';
    note.textContent = `${weaponLabel} — Mastery ${view.mastery}/5 · Special Ammo ${view.specialAmmo}/${view.specialAmmoMax}`;
    pane.appendChild(note);

    if (window.Combat.deps?.isDevMode?.()) {
      const row = document.createElement('div');
      row.className = 'ranged-loadout-dev-row';
      const masteryBtn = document.createElement('button');
      masteryBtn.type = 'button'; masteryBtn.className = 'ii-btn'; masteryBtn.textContent = '[Dev] +1 Ranged Mastery';
      masteryBtn.addEventListener('click', () => { ranged.devBumpMastery(itemKey); render(); });
      const ammoBtn = document.createElement('button');
      ammoBtn.type = 'button'; ammoBtn.className = 'ii-btn'; ammoBtn.textContent = '[Dev] +1 Special Ammo';
      ammoBtn.addEventListener('click', () => { ranged.grantSpecialAmmo(1); render(); });
      row.append(masteryBtn, ammoBtn);
      pane.appendChild(row);
    }

    for (const rank of [1, 2, 3, 4, 5]) {
      const isBasic = rank % 2 === 1;
      const card = document.createElement('div');
      card.className = 'loadout-slot ranged-rank-card' + (view.mastery < rank ? ' ranged-rank-locked' : '');
      const label = document.createElement('div');
      label.className = 'settings-label';
      const name = document.createElement('div');
      name.className = 'settings-name';
      name.textContent = `Rank ${rank}: ${isBasic ? `Basic Ammo Effect ${(rank + 1) / 2}` : `Special Ammo Slot ${rank / 2}`}`;
      const desc = document.createElement('div');
      desc.className = 'settings-desc';
      desc.textContent = view.mastery < rank
        ? `Unlocks at ${weaponLabel} Mastery ${rank}.`
        : isBasic ? 'Free choice; repeated effects stack.' : 'Free unlocked ammo choice; one shared charge is spent per volley.';
      label.append(name, desc);
      card.appendChild(label);

      const select = document.createElement('select');
      select.className = 'settings-select ranged-loadout-select';
      select.disabled = view.mastery < rank;
      if (isBasic) {
        const empty = document.createElement('option');
        empty.value = ''; empty.textContent = 'Choose an effect';
        select.appendChild(empty);
        for (const effect of ranged.BASIC_AMMO_EFFECTS) {
          const option = document.createElement('option');
          option.value = effect.id; option.textContent = effect.label; option.title = effect.desc;
          if (view.loadout.basicEffects[rank] === effect.id) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener('change', () => { if (select.value) ranged.setBasicEffect(itemKey, rank, select.value); render(); });
      } else {
        for (const ammo of Object.values(ranged.SPECIAL_AMMO_TYPES).filter(entry => view.unlockedSpecialAmmo.includes(entry.id))) {
          const option = document.createElement('option');
          option.value = ammo.id; option.textContent = `${ammo.icon} ${ammo.label}`; option.title = ammo.desc;
          if (view.loadout.specialSlots[rank] === ammo.id) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener('change', () => { ranged.setSpecialSlot(itemKey, rank, select.value); render(); });
      }
      card.appendChild(select);
      pane.appendChild(card);
    }
  }

  function renderLevelPicker(container, toolKey, abilityId) {
    const weaponType = window.Combat.deps?.weaponDamageTypeForTool?.(toolKey) || 'sharp';
    const tree = window.CombatProgression.getTree(abilityId, weaponType);
    if (!tree) return; // abilities with no defined tree (shouldn't happen) render nothing
    const motes = window.Combat.deps?.getMotesOfProwess?.() ?? 0;

    const levels = document.createElement('div');
    levels.className = 'loadout-levels';
    for (let level = 1; level <= 5; level++) {
      const state = window.CombatProgression.getLevelState(toolKey, abilityId, level);
      const cost = window.CombatProgression.moteCostForLevel(level);
      const box = document.createElement('div');
      const num = document.createElement('span');
      num.className = 'lv-num';
      num.textContent = 'Lv' + level;
      box.appendChild(num);
      const labelSpan = document.createElement('span');
      labelSpan.className = 'lv-label';

      if (state === 'chosen') {
        box.className = 'loadout-level chosen';
        labelSpan.textContent = window.CombatProgression.getChosenOption(toolKey, abilityId, level)?.label || '';
        box.title = `Click to change (${cost} mote${cost === 1 ? '' : 's'})`;
        box.addEventListener('click', () => {
          expandedFor = (expandedFor?.abilityId === abilityId && expandedFor?.level === level) ? null : { abilityId, level };
          render();
        });
      } else if (state === 'available') {
        const affordable = motes >= cost;
        box.className = 'loadout-level ' + (affordable ? 'available' : 'insufficient');
        labelSpan.textContent = affordable ? `Choose · ${cost}◆` : `Need ${cost}◆ (have ${motes})`;
        if (affordable) {
          box.addEventListener('click', () => {
            expandedFor = (expandedFor?.abilityId === abilityId && expandedFor?.level === level) ? null : { abilityId, level };
            render();
          });
        }
      } else if (state === 'mastery-locked') {
        box.className = 'loadout-level locked';
        labelSpan.textContent = 'Needs Mastery ' + level;
      } else {
        box.className = 'loadout-level locked';
        labelSpan.textContent = 'Locked';
      }
      box.appendChild(labelSpan);
      levels.appendChild(box);
    }
    container.appendChild(levels);

    if (expandedFor && expandedFor.abilityId === abilityId) {
      const options = tree[expandedFor.level - 1];
      const cost = window.CombatProgression.moteCostForLevel(expandedFor.level);
      const panel = document.createElement('div');
      panel.className = 'loadout-options';
      options.forEach((option, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'loadout-option-btn';
        const name = document.createElement('div');
        name.className = 'loadout-option-name';
        name.textContent = `${option.label} · ${cost}◆`;
        const desc = document.createElement('div');
        desc.className = 'loadout-option-desc';
        desc.textContent = option.desc;
        btn.appendChild(name);
        btn.appendChild(desc);
        btn.addEventListener('click', () => {
          window.CombatProgression.choose(toolKey, abilityId, expandedFor.level, idx);
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

    // Everything below (Quick Attack/Held picks, and every ability's own
    // upgrade tree) is scoped to this one tool instance — see combat-
    // loadout.js/combat-progression.js.
    const toolKey = window.Combat.deps?.currentWeaponKey?.() || 'none';
    const weaponLabel = window.Combat.deps?.currentWeaponLabel?.() || 'No weapon equipped';
    const mastery = window.Combat.deps?.toolMasteryLevel?.(toolKey) ?? 0;
    const motes = window.Combat.deps?.getMotesOfProwess?.() ?? 0;
    const weaponNote = document.createElement('div');
    weaponNote.className = 'loadout-slot-combo-note';
    weaponNote.style.marginBottom = '6px';
    weaponNote.textContent = `${weaponLabel} — Mastery ${mastery}/5 · ${motes}◆ Motes of Prowess`;
    pane.appendChild(weaponNote);

    // Motes are otherwise earned only through play (see MOTES_PER_KILL in
    // game.js's damageCreature) — no starting stipend — so testing anything
    // past level-1 upgrade choices needs a way to mint some. Mirrors the
    // gear-tool item panel's own "[Dev] +1 Mastery" button: hidden unless
    // the global dev-mode toggle (Settings pane) is on.
    if (window.Combat.deps?.isDevMode?.()) {
      const devBtn = document.createElement('button');
      devBtn.type = 'button';
      devBtn.className = 'ii-btn';
      devBtn.style.marginBottom = '10px';
      devBtn.textContent = '[Dev] +1 Mote of Prowess';
      devBtn.addEventListener('click', () => {
        window.Combat.deps?.awardMotesOfProwess?.(1);
        render();
      });
      pane.appendChild(devBtn);
    }

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

      if (abilityId) renderLevelPicker(card, toolKey, abilityId);

      pane.appendChild(card);
    }
    renderRangedLoadout(pane);
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    const tab = document.querySelector('.mp-tab[data-mpanel="loadout"]');
    if (tab) tab.addEventListener('click', () => { expandedFor = null; render(); });
    document.addEventListener('hobunji-ranged-ammo-change', render);
  });
})();

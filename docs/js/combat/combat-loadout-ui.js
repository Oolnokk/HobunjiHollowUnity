// Combat loadout UI — lets the player view/swap which ability occupies each
// of the weapon tool's 4 category-locked slots (see combat-loadout.js's
// SLOT_CATEGORIES: tap1 Combo/auto, tap2 Quick Attack, hold1 Offensive Held,
// hold2 Defensive-or-Offensive Held), and for whichever ability currently
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
    { id: 'hold1', name: 'Held — Offensive', desc: 'Left click held past a beat. Choose a heavy offensive release.' },
    { id: 'hold2', name: 'Held — Defensive or Offensive', desc: 'Right click held past a beat. Choose a defensive stance or a heavy offensive release.' },
  ];

  // Which level (if any) currently has its options picker expanded — an
  // abilityId+level pair (toolKey is implicitly whatever's equipped right
  // now, since the whole pane re-renders on any equip change). Not
  // persisted; purely local UI state.
  let expandedFor = null;
  let lastLoadoutControlChange = null; // Used by the in-menu mobile/controller diagnostic copy button to report the most recent slot mutation.

  function abilitiesForSlot(slotId) {
    const categories = window.Combat.loadout.SLOT_CATEGORIES[slotId]; // Used to keep controller cycling on exactly the same category-filtered list as the existing dropdown.
    return Array.isArray(categories) ? window.Combat.abilities.listForCategories(categories) : [];
  }

  function focusedLoadoutControlId(pane) {
    const controllerTarget = window.ControllerUI?.focusedElement?.(); // Used to preserve the controller navigator's exact dynamic loadout control across a rerender.
    if (controllerTarget?.id && pane.contains(controllerTarget)) return controllerTarget.id;
    const active = document.activeElement; // Used as the keyboard/pointer fallback when controller navigation is not currently authoritative.
    return active?.id && pane.contains(active) ? active.id : null;
  }

  function restoreLoadoutControlFocus(pane, controlId) {
    if (!controlId) return false;
    const next = document.getElementById(controlId); // Used to reconnect ControllerUI to the replacement node created by render().
    if (!next || !pane.contains(next) || next.disabled) return false;
    try { next.focus({ preventScroll: true }); } catch (_) { next.focus(); }
    return true;
  }

  function setSlotChoice(slotId, abilityId, source = 'select', focusId = null) {
    const before = window.Combat.loadout.getSlot(slotId); // Used by diagnostics to distinguish real controller swaps from no-op presses.
    const changed = window.Combat.loadout.setSlot(slotId, abilityId); // Reuses the canonical validation/persistence path rather than mutating loadout state in the UI.
    lastLoadoutControlChange = {
      slotId,
      source,
      before,
      after: changed ? window.Combat.loadout.getSlot(slotId) : before,
      changed: !!changed,
      weaponKey: window.Combat.deps?.currentWeaponKey?.() || 'none',
      at: Date.now(),
    };
    if (!changed) return false;
    expandedFor = null;
    render(focusId || ('combatLoadout_' + slotId));
    return true;
  }

  function cycleSlotChoice(slotId, delta, source, focusId) {
    const abilities = abilitiesForSlot(slotId); // Used to cycle only learned/eligible attacks for this slot.
    if (!abilities.length) return false;
    const currentId = window.Combat.loadout.getSlot(slotId); // Used to anchor the cycle on the actually equipped attack rather than the browser's visual select state.
    const currentIndex = abilities.findIndex(ability => ability.id === currentId); // Used so empty slots can still choose the first/last available technique deterministically.
    const step = delta < 0 ? -1 : 1; // Used to normalize all controller cycle requests to one slot at a time.
    const nextIndex = currentIndex < 0
      ? (step < 0 ? abilities.length - 1 : 0)
      : (currentIndex + step + abilities.length) % abilities.length;
    const nextId = abilities[nextIndex].id; // Used to avoid redundant persistence/rerenders when a slot has only one already-equipped eligible attack.
    if (nextId === currentId) return true;
    return setSlotChoice(slotId, nextId, source, focusId);
  }

  function loadoutDebugState() {
    return {
      weaponKey: window.Combat.deps?.currentWeaponKey?.() || 'none',
      loadout: window.Combat.loadout.get?.() || null,
      focusedControlId: window.ControllerUI?.focusedElement?.()?.id || document.activeElement?.id || null,
      controller: window.ControllerUI?.debugState?.() || null,
      lastLoadoutControlChange,
    };
  }

  async function copyLoadoutDebug() {
    const text = JSON.stringify(loadoutDebugState(), null, 2); // Used as the mobile-copyable controller/loadout report without requiring devtools.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const field = document.createElement('textarea'); // Used as the legacy clipboard fallback on browsers without navigator.clipboard.
      field.value = text;
      field.style.position = 'fixed';
      field.style.left = '-9999px';
      document.body.appendChild(field);
      field.select();
      const copied = !!document.execCommand?.('copy'); // Used to report whether the fallback copy request was accepted.
      field.remove();
      return copied;
    } catch (_) {
      return false;
    }
  }

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
      select.id = 'combatRangedLoadout_' + rank;
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
        select.addEventListener('change', () => { if (select.value) ranged.setBasicEffect(itemKey, rank, select.value); render(select.id); });
      } else {
        for (const ammo of Object.values(ranged.SPECIAL_AMMO_TYPES).filter(entry => view.unlockedSpecialAmmo.includes(entry.id))) {
          const option = document.createElement('option');
          option.value = ammo.id; option.textContent = `${ammo.icon} ${ammo.label}`; option.title = ammo.desc;
          if (view.loadout.specialSlots[rank] === ammo.id) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener('change', () => { ranged.setSpecialSlot(itemKey, rank, select.value); render(select.id); });
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

  function render(preferredFocusId = null) {
    const pane = document.getElementById('combatLoadoutPane');
    if (!pane) return;
    const requestedFocusId = typeof preferredFocusId === 'string' ? preferredFocusId : null; // Used to ignore CustomEvent objects when render is registered directly as an event listener.
    const restoreFocusId = requestedFocusId || focusedLoadoutControlId(pane); // Used to keep repeated controller swaps on the same slot instead of snapping focus back to the menu header.
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
      const devRow = document.createElement('div'); // Used to keep loadout test actions together without introducing another stylesheet dependency.
      devRow.className = 'ranged-loadout-dev-row';
      const devBtn = document.createElement('button');
      devBtn.type = 'button';
      devBtn.className = 'ii-btn';
      devBtn.id = 'combatLoadoutDevMote';
      devBtn.textContent = '[Dev] +1 Mote of Prowess';
      devBtn.addEventListener('click', () => {
        window.Combat.deps?.awardMotesOfProwess?.(1);
        render(devBtn.id);
      });
      const debugBtn = document.createElement('button'); // Used for controller testing on mobile where the browser console is unavailable.
      debugBtn.type = 'button';
      debugBtn.id = 'combatLoadoutControllerDebug';
      debugBtn.className = 'ii-btn';
      debugBtn.textContent = '[Dev] Copy Loadout Controller Debug';
      debugBtn.addEventListener('click', async () => {
        const copied = await copyLoadoutDebug(); // Used to provide immediate visible feedback for the clipboard operation.
        debugBtn.textContent = copied ? '[Dev] Copied Loadout Controller Debug' : '[Dev] Copy Failed';
        setTimeout(() => { if (debugBtn.isConnected) debugBtn.textContent = '[Dev] Copy Loadout Controller Debug'; }, 1200);
      });
      devRow.append(devBtn, debugBtn);
      pane.appendChild(devRow);
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
        const picker = document.createElement('div'); // Used to expose explicit controller-confirmable previous/next controls beside the existing mouse/touch dropdown.
        picker.style.display = 'flex';
        picker.style.alignItems = 'center';
        picker.style.gap = '4px';
        picker.style.minWidth = '0';

        const abilities = abilitiesForSlot(slot.id); // Used by the dropdown and controller buttons so both surfaces expose the identical eligible attack set.
        const canCycle = abilities.length > 0; // Used to keep controller arrow controls focusable even when a slot has only one learned technique.

        const prevBtn = document.createElement('button'); // Used by controller Confirm to choose the previous eligible attack without relying on native select popups.
        prevBtn.type = 'button';
        prevBtn.id = 'combatLoadoutPrev_' + slot.id;
        prevBtn.className = 'ii-btn';
        prevBtn.textContent = '◀';
        prevBtn.title = 'Previous ' + slot.name;
        prevBtn.setAttribute('aria-label', 'Previous ' + slot.name + ' attack');
        prevBtn.disabled = !canCycle;
        prevBtn.addEventListener('click', () => cycleSlotChoice(slot.id, -1, 'controller-prev', prevBtn.id));

        const select = document.createElement('select');
        select.className = 'settings-select';
        select.id = 'combatLoadout_' + slot.id;
        select.style.minWidth = '0';
        select.style.flex = '1 1 auto';
        for (const ability of abilities) {
          const opt = document.createElement('option');
          opt.value = ability.id;
          opt.textContent = ability.label;
          if (ability.id === abilityId) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => {
          if (select.value) setSlotChoice(slot.id, select.value, 'select', select.id);
        });

        const nextBtn = document.createElement('button'); // Used by controller Confirm to choose the next eligible attack while retaining focus after the rerender.
        nextBtn.type = 'button';
        nextBtn.id = 'combatLoadoutNext_' + slot.id;
        nextBtn.className = 'ii-btn';
        nextBtn.textContent = '▶';
        nextBtn.title = 'Next ' + slot.name;
        nextBtn.setAttribute('aria-label', 'Next ' + slot.name + ' attack');
        nextBtn.disabled = !canCycle;
        nextBtn.addEventListener('click', () => cycleSlotChoice(slot.id, 1, 'controller-next', nextBtn.id));

        picker.append(prevBtn, select, nextBtn);
        head.appendChild(picker);
      }

      card.appendChild(head);
      if (slot.readOnly) {
        const note = document.createElement('div');
        note.className = 'loadout-slot-combo-note';
        note.textContent = 'Auto-selected by your equipped weapon’s swing style.';
        card.appendChild(note);
      } else {
        const note = document.createElement('div'); // Used to make the controller path discoverable instead of depending on hidden native-select behavior.
        note.className = 'loadout-slot-combo-note';
        note.textContent = 'Controller: focus ◀ / ▶ and press Confirm to swap attacks. Left/right on the dropdown also changes it.';
        card.appendChild(note);
      }

      if (abilityId) renderLevelPicker(card, toolKey, abilityId);

      pane.appendChild(card);
    }
    renderRangedLoadout(pane);
    restoreLoadoutControlFocus(pane, restoreFocusId);
  }

  window.CombatLoadoutUI = { render, debugState: loadoutDebugState, copyDebug: copyLoadoutDebug };

  document.addEventListener('DOMContentLoaded', () => {
    render();
    const tab = document.querySelector('.mp-tab[data-mpanel="loadout"]');
    if (tab) tab.addEventListener('click', () => { expandedFor = null; render(); });
    document.addEventListener('hobunji-ranged-ammo-change', render);
  });
})();

// Durable livestock-item lineage persistence is isolated from FarmAnimals so
// the existing count-based inventory does not need a save-schema rewrite. The
// module waits for FarmAnimals, wraps its public queue/deploy seams, and stores
// those queued genotypes on the active world member record.
(() => {
  'use strict';
  if (window.LivestockItemGenotypePersistence?.install) { window.LivestockItemGenotypePersistence.install(); return; }
  if (document.querySelector('script[data-hobunji-livestock-genotypes]')) return;
  const script = document.createElement('script'); // Used to load the persistent creature-item lineage adapter once.
  script.src = 'js/livestock-item-genotype-persistence.js?v=20260826a';
  script.async = false;
  script.dataset.hobunjiLivestockGenotypes = 'true';
  script.onload = () => window.LivestockItemGenotypePersistence?.install?.();
  script.onerror = () => window.__farmLog?.('[genotype] failed to load livestock item persistence', 'warn');
  (document.head || document.documentElement).appendChild(script);
})();

// The Compendium is kept in its own file; this already-menu-owned module is
// the narrow bootstrap so index.html/game.js do not need another dependency.
(() => {
  'use strict';
  if (window.CompendiumUI?.install) { window.CompendiumUI.install(); return; }
  if (document.querySelector('script[data-hobunji-compendium]')) return;
  const script = document.createElement('script'); // Used to load the isolated player-facing Compendium module once.
  script.src = 'js/compendium-ui.js?v=20260826farm1';
  script.async = false;
  script.dataset.hobunjiCompendium = 'true';
  script.onload = () => window.CompendiumUI?.install?.();
  script.onerror = () => window.__farmLog?.('[compendium] failed to load js/compendium-ui.js', 'warn');
  (document.head || document.documentElement).appendChild(script);
})();

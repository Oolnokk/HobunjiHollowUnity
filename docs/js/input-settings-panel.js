(() => {
  'use strict';

  // Settings tab's input-binding rows (desktop key bindings, controller
  // bindings, and mode-shift bindings). Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // sibling systems. The actual keydown/keyup gameplay input handlers
  // stay in game.js — this only renders/edits the settings UI that
  // configures what those handlers look up.
  let deps = null;
  const RUNTIME_HELPER_SCRIPTS = [ // Loaded only after game.js reaches this panel's init(), so helper requests cannot race core boot scripts such as water-system.js.
    'js/combat/quick-attack-bonus-indicator.js',
    'js/combat/ranged-hud-reticle.js',
    'js/fullscreen-toggle.js',
    'js/mobile-combat-zoom.js',
  ];

  function ensureRuntimeHelpers() {
    for (const src of RUNTIME_HELPER_SCRIPTS) {
      if (document.querySelector(`script[data-hobunji-runtime-helper="${src}"]`)) continue;
      const script = document.createElement('script'); // Used to attach each small runtime affordance without adding another dependency to the monolithic game loop.
      script.src = src;
      script.async = false;
      script.dataset.hobunjiRuntimeHelper = src;
      script.addEventListener('error', () => console.error(`Failed to load runtime helper: ${src}`));
      document.head.appendChild(script);
    }
  }

  function installPixelProbeArmGuard() {
    const button = document.getElementById('debugProbeArmBtn');
    if (!button || button.dataset.manualArmGuard === '1') return;
    button.dataset.manualArmGuard = '1';

    let pointerIntent = false; // Used to prove a pointer activation actually began on the explicit Debug-tab Pixel Probe button.
    button.addEventListener('pointerdown', event => {
      pointerIntent = true;
      event.stopPropagation();
    }, { capture: true });
    button.addEventListener('pointercancel', () => {
      pointerIntent = false;
    }, { capture: true });
    button.addEventListener('click', event => {
      const pointerActivation = pointerIntent;
      const keyboardActivation = event.detail === 0 && document.activeElement === button; // Enter/Space activation remains available when the probe button itself is focused.
      pointerIntent = false;
      if (pointerActivation || keyboardActivation) {
        // Let the event finish normally. A capture-phase listener runs before
        // a same-node bubble-phase listener regardless of registration order,
        // and calling stopPropagation() here — even though this is already
        // the target — stops the browser from ever reaching that later
        // bubble-phase phase on this same node, so PixelProbe's own
        // (bubble-phase, unconditional) click listener that calls
        // armPixelProbe() would never run, on every click, guard or not.
        // Confirmed empirically: only an explicit `return` with no
        // stopPropagation() call here lets that listener fire afterward.
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation(); // Blocks Settings-open/click-through or programmatic clicks from reaching PixelProbe.armPixelProbe().
    }, { capture: true });
  }

  function setProgressionResetStatus(message, isError = false) {
    const status = document.getElementById('progressionResetStatus'); // Used to surface reset success/failure on mobile without requiring a developer console.
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
    status.style.color = isError ? '#ff9f9f' : '';
  }

  function resetSkillLevelsAndPerks() {
    const skillSystem = window.SkillSystem; // Used to clear every persisted skill XP value through the existing character-save adapter.
    const perkSystem = window.PerkSystem; // Used to refund/remove every purchased perk rank through the existing character-save adapter.
    if (!skillSystem?.SKILLS || !skillSystem?.restore || !skillSystem?.snapshot || !perkSystem?.TREES || !perkSystem?.resetTree) {
      setProgressionResetStatus('Skill/perk reset is unavailable because progression did not finish loading.', true);
      return;
    }
    if (window.confirm && !window.confirm('Reset every skill to level 0 and remove all purchased perk ranks? This cannot be undone.')) return;

    const zeroProgress = Object.fromEntries(Object.keys(skillSystem.SKILLS).map(skillKey => [skillKey, 0])); // Used as the complete zero-XP/zero-level snapshot for every current and future registered skill.
    for (const skillKey of Object.keys(perkSystem.TREES)) perkSystem.resetTree(skillKey);
    skillSystem.restore({ skillExperience: zeroProgress, skillLevels: zeroProgress });
    skillSystem.snapshot();
    perkSystem.render?.();
    setProgressionResetStatus('Reset complete: all skill levels, skill XP, and purchased perk ranks are now 0.');
  }

  function resetMotesOfProwess() {
    const combatDeps = window.Combat?.deps; // Used to reuse the same mote getter/spender and save path as ability progression.
    if (!combatDeps?.getMotesOfProwess || !combatDeps?.spendMotesOfProwess) {
      setProgressionResetStatus('Mote reset is unavailable because combat progression did not finish loading.', true);
      return;
    }
    const currentMotes = Math.max(0, Number(combatDeps.getMotesOfProwess()) || 0); // Used to spend the exact current balance down to zero without minting or directly mutating save data.
    if (currentMotes <= 0) {
      setProgressionResetStatus('Motes of Prowess are already at 0.');
      return;
    }
    if (window.confirm && !window.confirm(`Reset all ${currentMotes} Mote${currentMotes === 1 ? '' : 's'} of Prowess to 0? This cannot be undone.`)) return;
    if (!combatDeps.spendMotesOfProwess(currentMotes)) {
      setProgressionResetStatus('Mote reset failed; the saved balance changed before it could be cleared.', true);
      return;
    }
    setProgressionResetStatus('Reset complete: Motes of Prowess are now 0.');
  }

  function installProgressionResetControls() {
    if (document.getElementById('progressionResetSettingsTitle')) return;
    const modeShiftList = document.getElementById('modeShiftList'); // Used to anchor the new progression section directly after the existing Input settings.
    const anchorRow = modeShiftList?.closest('.settings-row'); // Used to preserve the Settings pane's current section/row layout without editing index.html.
    if (!anchorRow) return;

    const title = document.createElement('div'); // Used as the heading for destructive character-progression reset controls.
    title.id = 'progressionResetSettingsTitle';
    title.className = 'settings-section-title';
    title.style.marginTop = '10px';
    title.textContent = 'Progression';

    const skillRow = document.createElement('div'); // Used to hold the all-skills/all-perks reset action and its explanation.
    skillRow.className = 'settings-row';
    skillRow.innerHTML = '<div class="settings-label"><div class="settings-name">Reset Skill Levels + Perk Points</div><div class="settings-desc">Sets every skill\'s XP/level to 0 and removes every purchased perk rank.</div></div><button type="button" class="settings-small-btn" id="resetSkillProgressBtn">Reset</button>';

    const moteRow = document.createElement('div'); // Used to hold the Motes of Prowess reset action and its explanation.
    moteRow.className = 'settings-row';
    moteRow.innerHTML = '<div class="settings-label"><div class="settings-name">Reset Motes of Prowess</div><div class="settings-desc">Clears your current character\'s Motes of Prowess back to 0.</div></div><button type="button" class="settings-small-btn" id="resetMotesOfProwessBtn">Reset</button>';

    const status = document.createElement('div'); // Used as an in-game debug/result readout so resets can be verified on mobile.
    status.id = 'progressionResetStatus';
    status.className = 'settings-desc';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.margin = '4px 0 8px';
    status.hidden = true;

    anchorRow.after(title, skillRow, moteRow, status);
    document.getElementById('resetSkillProgressBtn')?.addEventListener('click', resetSkillLevelsAndPerks);
    document.getElementById('resetMotesOfProwessBtn')?.addEventListener('click', resetMotesOfProwess);
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    // This init is called by game.js only after its core dependency/bootstrap
    // pass succeeds. Starting optional helper fetches here preserves the
    // parser-serialized startup path and prevents helpers from running against
    // half-initialized game closures if an earlier boot dependency fails.
    installPixelProbeArmGuard();
    ensureRuntimeHelpers();
    installProgressionResetControls();
  }

  function actionDisplayLabel(action) {
    if (!/^action\d+$/.test(action?.id || '')) return action?.label || action?.id || '';
    const slot = Number(action.id.slice('action'.length)); // Used to name the exact visible action-button slot the player is rebinding.
    return `Action Button ${slot}`;
  }

  function notifyBindingChanged(device, actionId) {
    if (!device || !actionId) return;
    const binding = [...(deps?.inputBindings?.[device]?.[actionId] || [])]; // Used by the HUD/action router to refresh the displayed badges immediately after a Settings remap.
    window.dispatchEvent(new CustomEvent('hobunji-input-bindings-changed', {
      detail: { device, actionId, binding },
    }));
  }

  function saveBindingChange(device, actionId) {
    deps.saveInputBindings();
    notifyBindingChanged(device, actionId);
  }

  let cancelActiveBindingListener = null; // Used to guarantee that only the most recently opened desktop slot can hear the next keyboard/mouse input.
  function currentSlots(device, actionId) {
    const bindings = deps.inputBindings[device][actionId]; // Used as the mutable configured slot array for one action/device pair.
    if (Array.isArray(bindings)) return bindings;
    deps.inputBindings[device][actionId] = Array.from({ length: deps.INPUT_DEFAULTS.bindingSlots }, (_, index) => index === 0 ? bindings || null : null);
    return deps.inputBindings[device][actionId];
  }
  function renderConflictSummary() {
    const warning = document.getElementById('controlsConflictWarning');
    if (!warning) return;
    const conflicts = [];
    for (const device of ['desktop', 'controller']) {
      const owners = new Map(); // Used to group every shared physical input with the distinct actions it will trigger.
      for (const action of deps.INPUT_DEFAULTS.actions) for (const code of new Set(currentSlots(device, action.id).filter(Boolean))) {
        if (!owners.has(code)) owners.set(code, []);
        owners.get(code).push(actionDisplayLabel(action));
      }
      for (const [code, actions] of owners) if (actions.length > 1) conflicts.push(`${device === 'desktop' ? 'Desktop' : 'Controller'} ${deps.buttonLabel(code)}: ${actions.join(' + ')}`);
    }
    warning.hidden = conflicts.length === 0;
    warning.textContent = conflicts.length ? `Binding conflicts (all listed actions will trigger): ${conflicts.join(' · ')}` : '';
  }
  function beginDesktopBindingListen(control, actionId, slotIndex) {
    cancelActiveBindingListener?.();
    control.classList.add('is-listening'); control.textContent = 'Press key/mouse…';
    let settled = false; // Used so a near-simultaneous keyboard/mouse event can commit only the first input received.
    const cleanup = () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('pointerdown', onPointerDown, true); control.classList.remove('is-listening'); cancelActiveBindingListener = null; };
    const commit = code => { if (settled) return; settled = true; currentSlots('desktop', actionId)[slotIndex] = code; cleanup(); saveBindingChange('desktop', actionId); renderInputSettings(); };
    const onKeyDown = event => { event.preventDefault(); event.stopImmediatePropagation(); commit(event.code); };
    const onPointerDown = event => { if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return; event.preventDefault(); event.stopImmediatePropagation(); commit(`Mouse${event.button}`); };
    cancelActiveBindingListener = cleanup;
    window.addEventListener('keydown', onKeyDown, true); window.addEventListener('pointerdown', onPointerDown, true);
  }
  function renderInputSettings() {
    cancelActiveBindingListener?.();
    const desktopEl = document.getElementById('desktopInputBindings');
    const controllerEl = document.getElementById('controllerInputBindings');
    const shiftsEl = document.getElementById('modeShiftList');
    function renderDevice(el, device) {
      if (!el) return;
      el.innerHTML = '';
      for (const action of deps.INPUT_DEFAULTS.actions) {
        const row = document.createElement('div'); row.className = 'input-binding-row';
        if (/^action\d+$/.test(action.id)) { row.classList.add('action-button-binding'); row.dataset.actionSlot = action.id.slice('action'.length); row.title = 'Controls the matching visible gameplay action button.'; }
        const label = document.createElement('span'); label.className = 'settings-name'; label.textContent = actionDisplayLabel(action);
        const controls = document.createElement('div'); controls.className = 'input-binding-controls';
        currentSlots(device, action.id).forEach((binding, slotIndex) => {
          if (device === 'controller') {
            const select = document.createElement('select'); select.className = 'settings-select'; select.setAttribute('aria-label', `${actionDisplayLabel(action)} binding ${slotIndex + 1}`);
            select.add(new Option(`Slot ${slotIndex + 1}: Unbound`, '')); deps.CONTROLLER_INPUT_OPTIONS.forEach(code => select.add(new Option(deps.buttonLabel(code), code))); select.value = binding || '';
            select.addEventListener('change', () => { currentSlots(device, action.id)[slotIndex] = select.value || null; saveBindingChange(device, action.id); renderInputSettings(); });
            controls.appendChild(select);
          } else {
            const slot = document.createElement('div'); slot.className = 'input-bind-slot';
            const bindButton = document.createElement('button'); bindButton.type = 'button'; bindButton.className = 'input-bind-btn'; bindButton.textContent = deps.buttonLabel(binding); bindButton.title = `Binding ${slotIndex + 1}: ${deps.buttonLabel(binding)}`; bindButton.addEventListener('click', () => beginDesktopBindingListen(bindButton, action.id, slotIndex));
            const clearButton = document.createElement('button'); clearButton.type = 'button'; clearButton.className = 'input-bind-btn input-bind-clear'; clearButton.textContent = '×'; clearButton.title = `Clear binding ${slotIndex + 1}`; clearButton.disabled = !binding; clearButton.addEventListener('click', () => { currentSlots(device, action.id)[slotIndex] = null; saveBindingChange(device, action.id); renderInputSettings(); });
            slot.append(bindButton, clearButton); controls.appendChild(slot);
          }
        });
        row.append(label, controls); el.appendChild(row);
      }
    }
    renderDevice(desktopEl, 'desktop'); renderDevice(controllerEl, 'controller'); renderConflictSummary();
    const resetButton = document.getElementById('resetInputBindingsBtn');
    if (resetButton && resetButton.dataset.inputResetWired !== '1') {
      resetButton.dataset.inputResetWired = '1';
      resetButton.addEventListener('click', () => { deps.resetInputBindings(); for (const device of ['desktop', 'controller']) for (const action of deps.INPUT_DEFAULTS.actions) notifyBindingChanged(device, action.id); const status = document.getElementById('inputBindingStatus'); if (status) { status.hidden = false; status.textContent = 'Controls restored to defaults.'; } renderInputSettings(); });
    }
    if (shiftsEl) {
      shiftsEl.innerHTML = '';
      deps.inputBindings.modeShifts.forEach((shift, idx) => {
        const row = document.createElement('div'); row.className = 'mode-shift-row';
        row.innerHTML = `<input class="settings-select" value="${shift.label || ''}"><select class="settings-select"><option value="desktop">Desktop</option><option value="controller">Controller</option></select><input class="settings-select" value="${shift.button || ''}"><button type="button" class="settings-small-btn">Remove</button>`;
        row.children[1].value = shift.device || 'desktop';
        row.children[0].addEventListener('change', e => { shift.label = e.target.value; deps.saveInputBindings(); });
        row.children[1].addEventListener('change', e => { shift.device = e.target.value; deps.saveInputBindings(); });
        row.children[2].addEventListener('change', e => { shift.button = e.target.value; deps.saveInputBindings(); });
        row.children[3].addEventListener('click', () => { deps.inputBindings.modeShifts.splice(idx, 1); deps.saveInputBindings(); renderInputSettings(); });
        shiftsEl.appendChild(row);
        const bindings = document.createElement('div'); bindings.className = 'input-bindings-grid';
        Object.entries(shift.bindings || {}).forEach(([button, actionId]) => {
          const bRow = document.createElement('div'); bRow.className = 'mode-shift-row';
          bRow.innerHTML = `<span class="settings-name">${deps.buttonLabel(button)}</span><select class="settings-select"></select><span class="input-binding-warning"></span><button type="button" class="settings-small-btn">Remove</button>`;
          const select = bRow.children[1];
          deps.INPUT_DEFAULTS.actions.forEach(action => select.add(new Option(actionDisplayLabel(action), action.id)));
          select.value = actionId;
          select.addEventListener('change', e => { shift.bindings[button] = e.target.value; deps.saveInputBindings(); renderInputSettings(); });
          bRow.children[3].addEventListener('click', () => { delete shift.bindings[button]; deps.saveInputBindings(); renderInputSettings(); });
          bindings.appendChild(bRow);
        });
        const add = document.createElement('button'); add.type = 'button'; add.className = 'settings-small-btn'; add.textContent = 'Add Shifted Binding';
        add.addEventListener('click', () => {
          add.classList.add('is-listening'); add.textContent = 'Press shifted input…';
          const once = ev => {
            ev.preventDefault();
            const manual = window.prompt?.('Input code (examples: RightStickLeft, RightTrigger, Button0)') || '';
            const button = manual.trim() || ev.code;
            const actionId = deps.INPUT_DEFAULTS.actions[0]?.id || 'interact';
            const conflict = deps.bindingConflict(shift.device || 'desktop', button, actionId, shift);
            if (!conflict) { shift.bindings = shift.bindings || {}; shift.bindings[button] = actionId; deps.saveInputBindings(); }
            window.removeEventListener('keydown', once, true); renderInputSettings();
          };
          window.addEventListener('keydown', once, true);
        });
        bindings.appendChild(add);
        shiftsEl.appendChild(bindings);
      });
    }
  }

  window.InputSettingsPanel = { init, render: renderInputSettings };
})();

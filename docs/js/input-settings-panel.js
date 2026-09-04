(() => {
  'use strict';

  // Settings tab's input-binding rows (desktop key bindings, controller
  // bindings, and mode-shift bindings). Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // sibling systems. The actual keydown/keyup gameplay input handlers
  // stay in game.js — this only renders/edits the settings UI that
  // configures what those handlers look up.
  let deps = null;
  const ACTION_BUTTON_IDS = new Set(['action1', 'action2', 'action3', 'action4', 'action5']); // Used to give the five visible gameplay buttons player-facing names in Settings.
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
    if (!action?.id || !ACTION_BUTTON_IDS.has(action.id)) return action?.label || action?.id || '';
    const slot = Number(action.id.slice('action'.length)); // Used to name the exact visible action-button slot the player is rebinding.
    return `Action Button ${slot}`;
  }

  function notifyBindingChanged(device, actionId) {
    if (!device || !actionId) return;
    const binding = deps?.inputBindings?.[device]?.[actionId] || null; // Used by the HUD/action router to refresh the displayed badge immediately after a Settings remap.
    window.dispatchEvent(new CustomEvent('hobunji-input-bindings-changed', {
      detail: { device, actionId, binding },
    }));
  }

  function saveBindingChange(device, actionId) {
    deps.saveInputBindings();
    notifyBindingChanged(device, actionId);
  }

  function renderInputSettings() {
    const desktopEl = document.getElementById('desktopInputBindings');
    const controllerEl = document.getElementById('controllerInputBindings');
    const shiftsEl = document.getElementById('modeShiftList');
    function renderDevice(el, device) {
      if (!el) return;
      el.innerHTML = '';
      for (const action of deps.INPUT_DEFAULTS.actions) {
        const row = document.createElement('div'); row.className = 'input-binding-row';
        if (ACTION_BUTTON_IDS.has(action.id)) {
          row.classList.add('action-button-binding');
          row.dataset.actionSlot = action.id.slice('action'.length); // Used for inspection/debugging and future Settings styling without inferring from label text.
          row.title = 'Controls the matching visible gameplay action button.';
        }
        row.innerHTML = `<span class="settings-name">${actionDisplayLabel(action)}</span>${device === 'controller' ? '<select class="settings-select"></select>' : `<button type="button" class="input-bind-btn">${deps.buttonLabel(deps.inputBindings[device][action.id])}</button>`}<div class="input-binding-warning"></div>`;
        const control = row.children[1]; const warn = row.querySelector('.input-binding-warning');
        if (device === 'controller') {
          control.add(new Option('Unbound', ''));
          deps.CONTROLLER_INPUT_OPTIONS.forEach(code => control.add(new Option(deps.buttonLabel(code), code)));
          control.value = deps.inputBindings.controller[action.id] || '';
          control.addEventListener('change', () => {
            const conflict = deps.bindingConflict(device, control.value, action.id);
            if (conflict) {
              warn.textContent = conflict;
              control.value = deps.inputBindings.controller[action.id] || '';
            } else {
              deps.inputBindings.controller[action.id] = control.value || null;
              warn.textContent = '';
              saveBindingChange(device, action.id);
            }
          });
        } else {
          control.addEventListener('click', () => {
            control.classList.add('is-listening');
            control.textContent = 'Press input… (key or mouse button)';
            const finish = code => {
              const conflict = deps.bindingConflict(device, code, action.id);
              if (conflict) warn.textContent = conflict;
              else {
                deps.inputBindings[device][action.id] = code;
                warn.textContent = '';
                saveBindingChange(device, action.id);
                renderInputSettings();
              }
              window.removeEventListener('keydown', onKey, true);
              window.removeEventListener('mousedown', onMouse, true);
              window.removeEventListener('contextmenu', onContextMenu, true);
            };
            const onKey = ev => { ev.preventDefault(); finish(ev.code); };
            const onMouse = ev => { ev.preventDefault(); finish('Mouse' + ev.button); };
            const onContextMenu = ev => ev.preventDefault(); // Swallows the right-click's context menu while capturing a mouse-button bind.
            window.addEventListener('keydown', onKey, true);
            // Deferred a tick so the click that opened capture mode isn't itself captured as Mouse0.
            setTimeout(() => {
              window.addEventListener('mousedown', onMouse, true);
              window.addEventListener('contextmenu', onContextMenu, true);
            }, 0);
          });
        }
        el.appendChild(row);
      }
    }
    renderDevice(desktopEl, 'desktop'); renderDevice(controllerEl, 'controller');
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

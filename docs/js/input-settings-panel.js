(() => {
  'use strict';

  // Settings tab's input-binding rows (desktop key/mouse bindings, controller
  // bindings, and mode-shift bindings). The actual gameplay action router stays
  // in game.js; input-binding-runtime.js bridges the new first-class actions
  // back into that existing router so tap/hold behavior remains authoritative.
  let deps = null;
  let cancelDesktopCapture = null; // Cleanup for the one currently listening desktop binding row, if any.
  const ACTION_BUTTON_IDS = new Set(['action1', 'action2', 'action3', 'action4', 'action5']); // Used to give the five visible gameplay buttons player-facing names in Settings.
  const MOUSE_BINDINGS = Object.freeze([
    { code: 'MouseLeft', label: 'Left Click', setLabel: 'Set to Left Click' },
    { code: 'MouseRight', label: 'Right Click', setLabel: 'Set to Right Click' },
  ]); // First-class mouse inputs offered beside the normal "Press input…" capture control.
  const EXTENDED_ACTIONS = Object.freeze([
    { id: 'attack1', label: 'Attack Button 1', desktop: 'MouseLeft', controller: null },
    { id: 'attack2', label: 'Attack Button 2', desktop: 'MouseRight', controller: null },
    { id: 'menu', label: 'Menu', desktop: 'Escape', controller: null },
  ]); // Must remain in this order at the top of both Desktop and Controller settings lists.
  const RUNTIME_HELPER_SCRIPTS = [ // Loaded only after game.js reaches this panel's init(), so optional helpers cannot race core boot scripts.
    'js/combat/quick-attack-bonus-indicator.js',
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
        event.stopPropagation(); // PixelProbe's existing target listener is allowed to arm only after this explicit button intent.
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation(); // Blocks Settings-open/click-through or programmatic clicks from reaching PixelProbe.armPixelProbe().
    }, { capture: true });
  }

  function installBindingStyles() {
    if (document.getElementById('hobunji-input-binding-extension-style')) return;
    const style = document.createElement('style'); // Scoped layout for the key-capture + left/right-click choices requested on the same line.
    style.id = 'hobunji-input-binding-extension-style';
    style.textContent = `
      .input-bind-capture{display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0;flex-wrap:nowrap}
      .input-bind-capture .input-bind-btn{min-width:110px}
      .input-bind-mouse-choice{display:none;white-space:nowrap}
      .input-bind-capture.is-listening .input-bind-mouse-choice{display:inline-flex;align-items:center;justify-content:center}
      .input-bind-capture.is-listening{grid-column:auto;overflow:visible}
      @media(max-width:700px){.input-bind-capture.is-listening{flex-wrap:wrap;justify-content:flex-start}.input-bind-mouse-choice{font-size:11px;padding-inline:7px}}
    `;
    document.head.appendChild(style);
  }

  function installExtendedActions() {
    const actions = deps?.INPUT_DEFAULTS?.actions;
    if (!Array.isArray(actions)) return;
    const existing = new Map(actions.map(action => [action?.id, action])); // Existing config objects are reused if the core config later grows these actions itself.
    const extensionIds = new Set(EXTENDED_ACTIONS.map(action => action.id));
    const orderedExtensions = EXTENDED_ACTIONS.map(action => ({ ...action, ...(existing.get(action.id) || {}) }));
    const ordinaryActions = actions.filter(action => !extensionIds.has(action?.id));
    actions.splice(0, actions.length, ...orderedExtensions, ...ordinaryActions);

    let changed = false;
    for (const action of orderedExtensions) {
      if (!(action.id in deps.INPUT_DEFAULTS.desktop)) deps.INPUT_DEFAULTS.desktop[action.id] = action.desktop ?? null;
      if (!(action.id in deps.INPUT_DEFAULTS.controller)) deps.INPUT_DEFAULTS.controller[action.id] = action.controller ?? null;
      if (!(action.id in deps.inputBindings.desktop)) {
        deps.inputBindings.desktop[action.id] = action.desktop ?? null;
        changed = true;
      }
      if (!(action.id in deps.inputBindings.controller)) {
        deps.inputBindings.controller[action.id] = action.controller ?? null;
        changed = true;
      }
    }
    if (changed) deps.saveInputBindings(); // Persists defaults once; subsequent boots retain user overrides through the core loader's saved-object merge.
  }

  function inputButtonLabel(code) {
    const mouse = MOUSE_BINDINGS.find(binding => binding.code === code);
    return mouse?.label || deps?.buttonLabel?.(code) || String(code || 'Unbound');
  }

  function publishRuntimeContext() {
    window.__hobunjiInputBindingContext = {
      inputBindings: deps.inputBindings, // Live object shared with game.js and InputBindingRuntime.
      inputDefaults: deps.INPUT_DEFAULTS, // Supplies controller axis threshold and action metadata to the early runtime.
      buttonLabel: inputButtonLabel, // Shared formatter so runtime/debug UI calls MouseLeft/MouseRight by player-facing names.
    };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    installExtendedActions();
    publishRuntimeContext();
    installBindingStyles();
    // This init is called by game.js only after its core dependency/bootstrap
    // pass succeeds. Starting optional helper fetches here preserves the
    // parser-serialized startup path and prevents helpers from running against
    // half-initialized game closures if an earlier boot dependency fails.
    installPixelProbeArmGuard();
    ensureRuntimeHelpers();
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
    publishRuntimeContext();
    notifyBindingChanged(device, actionId);
  }

  function renderInputSettings() {
    const desktopEl = document.getElementById('desktopInputBindings');
    const controllerEl = document.getElementById('controllerInputBindings');
    const shiftsEl = document.getElementById('modeShiftList');

    function applyDesktopBinding(actionId, code, warningEl) {
      const conflict = deps.bindingConflict('desktop', code, actionId);
      if (conflict) {
        warningEl.textContent = conflict;
        return false;
      }
      deps.inputBindings.desktop[actionId] = code || null;
      warningEl.textContent = '';
      saveBindingChange('desktop', actionId);
      return true;
    }

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

        if (device === 'controller') {
          row.innerHTML = `<span class="settings-name">${actionDisplayLabel(action)}</span><select class="settings-select"></select><div class="input-binding-warning"></div>`;
          const control = row.children[1];
          const warn = row.querySelector('.input-binding-warning');
          control.add(new Option('Unbound', ''));
          deps.CONTROLLER_INPUT_OPTIONS.forEach(code => control.add(new Option(inputButtonLabel(code), code)));
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
          row.innerHTML = `<span class="settings-name">${actionDisplayLabel(action)}</span><div class="input-bind-capture"><button type="button" class="input-bind-btn">${inputButtonLabel(deps.inputBindings.desktop[action.id])}</button>${MOUSE_BINDINGS.map(binding => `<button type="button" class="settings-small-btn input-bind-mouse-choice" data-input-code="${binding.code}">${binding.setLabel}</button>`).join('')}</div><div class="input-binding-warning"></div>`;
          const capture = row.querySelector('.input-bind-capture');
          const control = row.querySelector('.input-bind-btn');
          const warn = row.querySelector('.input-binding-warning');
          const choices = [...row.querySelectorAll('.input-bind-mouse-choice')];

          control.addEventListener('click', () => {
            cancelDesktopCapture?.();
            let listening = true; // Shared by keyboard and mouse-choice completion so only the first selected input wins.
            capture.classList.add('is-listening');
            control.classList.add('is-listening');
            control.textContent = 'Press input…';

            const finish = () => {
              if (!listening) return;
              listening = false;
              window.removeEventListener('keydown', onKey, true);
              capture.classList.remove('is-listening');
              control.classList.remove('is-listening');
              control.textContent = inputButtonLabel(deps.inputBindings.desktop[action.id]);
              if (cancelDesktopCapture === finish) cancelDesktopCapture = null;
            };

            const commit = code => {
              const applied = applyDesktopBinding(action.id, code, warn);
              finish();
              if (applied) renderInputSettings();
            };

            const onKey = event => {
              event.preventDefault();
              event.stopImmediatePropagation();
              commit(event.code);
            };

            cancelDesktopCapture = finish;
            window.addEventListener('keydown', onKey, true);
            choices.forEach(choice => {
              choice.onclick = event => {
                event.preventDefault();
                event.stopPropagation();
                commit(choice.dataset.inputCode);
              };
            });
          });
        }
        el.appendChild(row);
      }
    }

    cancelDesktopCapture?.();
    renderDevice(desktopEl, 'desktop');
    renderDevice(controllerEl, 'controller');

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
          bRow.innerHTML = `<span class="settings-name">${inputButtonLabel(button)}</span><select class="settings-select"></select><span class="input-binding-warning"></span><button type="button" class="settings-small-btn">Remove</button>`;
          const select = bRow.children[1];
          deps.INPUT_DEFAULTS.actions.forEach(optionAction => select.add(new Option(actionDisplayLabel(optionAction), optionAction.id)));
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
            const manual = window.prompt?.('Input code (examples: RightStickLeft, RightTrigger, Button0, MouseLeft)') || '';
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

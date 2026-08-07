(() => {
  'use strict';

  // Settings tab's input-binding rows (desktop key bindings, controller
  // bindings, and mode-shift bindings). Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // sibling systems. The actual keydown/keyup gameplay input handlers
  // stay in game.js — this only renders/edits the settings UI that
  // configures what those handlers look up.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function renderInputSettings() {
    const desktopEl = document.getElementById('desktopInputBindings');
    const controllerEl = document.getElementById('controllerInputBindings');
    const shiftsEl = document.getElementById('modeShiftList');
    function renderDevice(el, device) {
      if (!el) return;
      el.innerHTML = '';
      for (const action of deps.INPUT_DEFAULTS.actions) {
        const row = document.createElement('div'); row.className = 'input-binding-row';
        row.innerHTML = `<span class="settings-name">${action.label}</span>${device === 'controller' ? '<select class="settings-select"></select>' : `<button type="button" class="input-bind-btn">${deps.buttonLabel(deps.inputBindings[device][action.id])}</button>`}<div class="input-binding-warning"></div>`;
        const control = row.children[1]; const warn = row.querySelector('.input-binding-warning');
        if (device === 'controller') {
          control.add(new Option('Unbound', ''));
          deps.CONTROLLER_INPUT_OPTIONS.forEach(code => control.add(new Option(deps.buttonLabel(code), code)));
          control.value = deps.inputBindings.controller[action.id] || '';
          control.addEventListener('change', () => { const conflict = deps.bindingConflict(device, control.value, action.id); if (conflict) { warn.textContent = conflict; control.value = deps.inputBindings.controller[action.id] || ''; } else { deps.inputBindings.controller[action.id] = control.value || null; warn.textContent = ''; deps.saveInputBindings(); } });
        } else {
          control.addEventListener('click', () => { control.classList.add('is-listening'); control.textContent = 'Press input…'; const once = ev => { ev.preventDefault(); const code = ev.code; const conflict = deps.bindingConflict(device, code, action.id); if (conflict) warn.textContent = conflict; else { deps.inputBindings[device][action.id] = code; warn.textContent = ''; deps.saveInputBindings(); renderInputSettings(); } window.removeEventListener('keydown', once, true); }; window.addEventListener('keydown', once, true); });
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
          deps.INPUT_DEFAULTS.actions.forEach(action => select.add(new Option(action.label, action.id)));
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

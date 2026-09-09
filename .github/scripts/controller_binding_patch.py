from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'Expected source not found in {path}: {old[:160]!r}')
    write(path, text.replace(old, new, 1))


def ensure_contains(path, needle):
    if needle not in read(path):
        raise SystemExit(f'Validation failed: {needle!r} missing from {path}')


# 1) Register discrete controller actions that were previously fixed to physical inputs.
config_path = 'docs/config/scratchbones-config.js'
config_text = read(config_path)
if '"id": "uiOpenMenu"' not in config_text:
    anchor = '        { "id": "tool6", "label": "Tool 6: Harpoon", "desktop": "Digit6", "controller": null }\n      ],'
    replacement = '''        { "id": "tool6", "label": "Tool 6: Harpoon", "desktop": "Digit6", "controller": null },
        { "id": "uiOpenMenu", "label": "Menu: Open / Close", "desktop": null, "controller": "Button8", "devices": ["controller"], "context": "menu" },
        { "id": "uiConfirm", "label": "Menu: Confirm", "desktop": null, "controller": "Button0", "devices": ["controller"], "context": "menu" },
        { "id": "uiCancel", "label": "Menu: Cancel / Back", "desktop": null, "controller": "Button1", "devices": ["controller"], "context": "menu" },
        { "id": "uiTabPrev", "label": "Menu: Previous Tab", "desktop": null, "controller": "Button4", "devices": ["controller"], "context": "menu" },
        { "id": "uiTabNext", "label": "Menu: Next Tab", "desktop": null, "controller": "Button5", "devices": ["controller"], "context": "menu" },
        { "id": "uiUp", "label": "Menu: Navigate Up", "desktop": null, "controller": "Button12", "devices": ["controller"], "context": "menu" },
        { "id": "uiDown", "label": "Menu: Navigate Down", "desktop": null, "controller": "Button13", "devices": ["controller"], "context": "menu" },
        { "id": "uiLeft", "label": "Menu: Navigate Left", "desktop": null, "controller": "Button14", "devices": ["controller"], "context": "menu" },
        { "id": "uiRight", "label": "Menu: Navigate Right", "desktop": null, "controller": "Button15", "devices": ["controller"], "context": "menu" },
        { "id": "musicNote1", "label": "Music: Note 1", "desktop": null, "controller": "Button2", "devices": ["controller"], "context": "music" },
        { "id": "musicNote2", "label": "Music: Note 2", "desktop": null, "controller": "Button0", "devices": ["controller"], "context": "music" },
        { "id": "musicNote3", "label": "Music: Note 3", "desktop": null, "controller": "Button1", "devices": ["controller"], "context": "music" },
        { "id": "musicNote4", "label": "Music: Note 4", "desktop": null, "controller": "Button3", "devices": ["controller"], "context": "music" },
        { "id": "musicBank1", "label": "Music: Bank 1", "desktop": null, "controller": "LeftTrigger", "devices": ["controller"], "context": "music" },
        { "id": "musicBank2", "label": "Music: Bank 2", "desktop": null, "controller": "RightTrigger", "devices": ["controller"], "context": "music" },
        { "id": "musicBank3", "label": "Music: Bank 3", "desktop": null, "controller": "Button4", "devices": ["controller"], "context": "music" },
        { "id": "musicBank4", "label": "Music: Bank 4", "desktop": null, "controller": "Button5", "devices": ["controller"], "context": "music" },
        { "id": "musicPause", "label": "Music: Pause", "desktop": null, "controller": "Button9", "devices": ["controller"], "context": "music" },
        { "id": "musicScalePrev", "label": "Music: Previous Scale", "desktop": null, "controller": "Button14", "devices": ["controller"], "context": "music" },
        { "id": "musicScaleNext", "label": "Music: Next Scale", "desktop": null, "controller": "Button15", "devices": ["controller"], "context": "music" },
        { "id": "meleeAutoTargetToggle", "label": "Melee: Toggle Auto-Target", "desktop": null, "controller": "Button11", "devices": ["controller"], "context": "melee" }
      ],'''
    if anchor not in config_text:
        raise SystemExit('Could not find controller-action insertion point in scratchbones-config.js')
    write(config_path, config_text.replace(anchor, replacement, 1))

# 2) Keep contextual actions out of generic gameplay dispatch and remove the R3 special case.
game_path = 'docs/game.js'
old_get_action = '''      function getActionForButton(device, button, heldShift = null) {
        if (heldShift?.bindings?.[button]) return heldShift.bindings[button];
        const bindings = inputBindings[device] || {};
        return Object.keys(bindings).find(actionId => bindings[actionId] === button) || null;
      }'''
new_get_action = '''      function getActionForButton(device, button, heldShift = null) {
        if (heldShift?.bindings?.[button]) return heldShift.bindings[button];
        const bindings = inputBindings[device] || {};
        return Object.keys(bindings).find(actionId => {
          if (bindings[actionId] !== button) return false;
          const actionDefinition = INPUT_DEFAULTS.actions.find(entry => entry.id === actionId); // Used to keep menu/music/melee-context bindings out of generic gameplay dispatch.
          return (actionDefinition?.context || 'gameplay') === 'gameplay';
        }) || null;
      }'''
if old_get_action in read(game_path):
    replace_once(game_path, old_get_action, new_get_action)

old_melee = '''        // Right-stick click (Button11 — R3) toggles melee auto-target
        // while a melee weapon is out, taking over from its default
        // weaponSwitch binding for exactly that window (weaponSwitch still
        // works normally the rest of the time, and via its other bindings/
        // the action-bar button even then).
        if (down.has('Button11') && meleeWeaponOut()) {
          if (!gamepadState.previous.has('Button11')) {
            meleeAutoTargetOn = !meleeAutoTargetOn;
            manualAutoTarget = null;
            meleeAutoTargetFreeAim = false;
            showToast(meleeAutoTargetOn ? 'Auto-Target: On' : 'Auto-Target: Off', meleeAutoTargetOn);
          }
          down.delete('Button11');
        }'''
new_melee = '''        const meleeAutoTargetBinding = inputBindings.controller?.meleeAutoTargetToggle || null; // Used so the melee-only auto-target toggle follows the player's controller configuration instead of a physical R3 constant.
        if (meleeAutoTargetBinding && down.has(meleeAutoTargetBinding) && meleeWeaponOut()) {
          if (!gamepadState.previous.has(meleeAutoTargetBinding)) {
            meleeAutoTargetOn = !meleeAutoTargetOn;
            manualAutoTarget = null;
            meleeAutoTargetFreeAim = false;
            showToast(meleeAutoTargetOn ? 'Auto-Target: On' : 'Auto-Target: Off', meleeAutoTargetOn);
          }
          down.delete(meleeAutoTargetBinding);
        }'''
if old_melee in read(game_path):
    replace_once(game_path, old_melee, new_melee)

# 3) Route universal menu buttons/D-pad through semantic configurable bindings.
nav_path = 'docs/js/controller-ui-nav.js'
old_nav_constants = '''  const REPEAT_INITIAL_MS = 380;
  const REPEAT_RATE_MS = 140;
  const BTN_CONFIRM = 0;   // A
  const BTN_CANCEL = 1;    // B
  const BTN_TAB_PREV = 4;  // LB
  const BTN_TAB_NEXT = 5;  // RB
  const BTN_OPEN_MENU = 8; // Back/Select — unbound in gameplay, free for this
  const BTN_DPAD_UP = 12, BTN_DPAD_DOWN = 13, BTN_DPAD_LEFT = 14, BTN_DPAD_RIGHT = 15;'''
new_nav_constants = '''  const REPEAT_INITIAL_MS = 380;
  const REPEAT_RATE_MS = 140;
  const UI_ACTIONS = Object.freeze({
    open: 'uiOpenMenu', confirm: 'uiConfirm', cancel: 'uiCancel', tabPrev: 'uiTabPrev', tabNext: 'uiTabNext',
    up: 'uiUp', down: 'uiDown', left: 'uiLeft', right: 'uiRight',
  }); // Used to keep every discrete menu action routed through the configurable controller binding layer.

  function configuredControllerBinding(actionId) {
    const currentBindings = window.InputBindings?.getCurrentBindings?.()?.controller; // Used to prefer the player's saved binding, including an explicit Unbound value.
    if (currentBindings && Object.prototype.hasOwnProperty.call(currentBindings, actionId)) return currentBindings[actionId];
    const actionDefinition = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(action => action.id === actionId); // Used as the shipped fallback before saved bindings have initialized.
    return actionDefinition?.controller || null;
  }

  function controllerActionDown(gamepad, actionId) {
    const bindingCode = configuredControllerBinding(actionId); // Used to resolve this menu action without relying on a physical Gamepad button index.
    return window.ControllerInput?.isBindingPressed?.(gamepad, bindingCode, { stickThreshold: NAV_PRESS }) || false;
  }'''
if old_nav_constants in read(nav_path):
    replace_once(nav_path, old_nav_constants, new_nav_constants)

old_menu_open = '''      const openDown = !!pad.buttons[BTN_OPEN_MENU]?.pressed;
      if (openDown && !menuOpenEdge) {
        document.getElementById('menuBtn')?.click();
        prevButtons = new Set([BTN_OPEN_MENU]); // Prevents the same held View press from immediately closing the menu on its next active frame.
      } else if (!openDown) prevButtons.clear();'''
new_menu_open = '''      const openDown = controllerActionDown(pad, UI_ACTIONS.open); // Used to let the configured Menu Open/Close action own this edge instead of a fixed View/Share button.
      if (openDown && !menuOpenEdge) {
        document.getElementById('menuBtn')?.click();
        prevButtons = new Set([UI_ACTIONS.open]); // Prevents the same held configured open press from immediately closing the menu on its next active frame.
      } else if (!openDown) prevButtons.clear();'''
if old_menu_open in read(nav_path):
    replace_once(nav_path, old_menu_open, new_menu_open)

old_nav_directions = '''    pollDirection('left', rawAx <= -NAV_PRESS || !!pad.buttons[BTN_DPAD_LEFT]?.pressed, now, () => moveOrAdjust('left'));
    pollDirection('right', rawAx >= NAV_PRESS || !!pad.buttons[BTN_DPAD_RIGHT]?.pressed, now, () => moveOrAdjust('right'));
    pollDirection('up', rawAy <= -NAV_PRESS || !!pad.buttons[BTN_DPAD_UP]?.pressed, now, () => move('up'));
    pollDirection('down', rawAy >= NAV_PRESS || !!pad.buttons[BTN_DPAD_DOWN]?.pressed, now, () => move('down'));'''
new_nav_directions = '''    pollDirection('left', rawAx <= -NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.left), now, () => moveOrAdjust('left'));
    pollDirection('right', rawAx >= NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.right), now, () => moveOrAdjust('right'));
    pollDirection('up', rawAy <= -NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.up), now, () => move('up'));
    pollDirection('down', rawAy >= NAV_PRESS || controllerActionDown(pad, UI_ACTIONS.down), now, () => move('down'));'''
if old_nav_directions in read(nav_path):
    replace_once(nav_path, old_nav_directions, new_nav_directions)

old_nav_buttons = '''    const down = new Set();
    pad.buttons.forEach((b, i) => { if (b?.pressed) down.add(i); });
    const pressed = i => down.has(i) && !prevButtons.has(i);
    if (pressed(BTN_CONFIRM)) activate();
    if (pressed(BTN_CANCEL)) cancel();
    if (pressed(BTN_TAB_PREV)) cycleTabs(-1);
    if (pressed(BTN_TAB_NEXT)) cycleTabs(1);
    if (pressed(BTN_OPEN_MENU)) cancel();
    prevButtons = down;'''
new_nav_buttons = '''    const downActions = new Set(Object.values(UI_ACTIONS).filter(actionId => controllerActionDown(pad, actionId))); // Used as semantic edge state so remapping never depends on physical Gamepad indices.
    const actionPressed = actionId => downActions.has(actionId) && !prevButtons.has(actionId); // Used to edge-trigger menu actions once per configured press.
    if (actionPressed(UI_ACTIONS.confirm)) activate();
    if (actionPressed(UI_ACTIONS.cancel)) cancel();
    if (actionPressed(UI_ACTIONS.tabPrev)) cycleTabs(-1);
    if (actionPressed(UI_ACTIONS.tabNext)) cycleTabs(1);
    if (actionPressed(UI_ACTIONS.open)) cancel();
    prevButtons = downActions;'''
if old_nav_buttons in read(nav_path):
    replace_once(nav_path, old_nav_buttons, new_nav_buttons)

# Stand universal menu polling down while Settings is deliberately capturing a controller press.
nav_capture_anchor = '''    padEverSeen = true;

    if (!isActive()) {'''
nav_capture_replacement = '''    padEverSeen = true;

    if (window.InputSettingsPanel?.isControllerListening?.()) {
      prevButtons.clear();
      menuOpenEdge = false;
      return;
    }

    if (!isActive()) {'''
if nav_capture_anchor in read(nav_path) and 'isControllerListening?.()' not in read(nav_path):
    replace_once(nav_path, nav_capture_anchor, nav_capture_replacement)

# 4) Add controller listening and per-device JSON copy controls to Settings.
settings_path = 'docs/js/input-settings-panel.js'
settings_helpers_anchor = '''  function saveBindingChange(device, actionId) {
    deps.saveInputBindings();
    notifyBindingChanged(device, actionId);
  }

  function renderInputSettings() {'''
settings_helpers_replacement = '''  function saveBindingChange(device, actionId) {
    deps.saveInputBindings();
    notifyBindingChanged(device, actionId);
  }

  let activeControllerCapture = null; // Used to ensure only one Settings row can listen to the gamepad at a time.

  function stopControllerCapture() {
    const capture = activeControllerCapture; // Used to cancel the current animation-frame listener without leaving menu navigation suppressed.
    activeControllerCapture = null;
    if (capture?.frame) cancelAnimationFrame(capture.frame);
    capture?.button?.classList.remove('is-listening');
  }

  function listenForControllerInput(button, onInput, onError) {
    stopControllerCapture();
    if (!window.ControllerInput?.getPressedBindingCodes || typeof navigator.getGamepads !== 'function') {
      onError?.('Controller input listening is unavailable in this browser.');
      return;
    }
    const blockedInputs = new Set(); // Used to ignore the A/button press that activated Listen until that physical control is released.
    const capture = { button, frame: 0 }; // Used by stopControllerCapture() to cancel this exact listening session.
    activeControllerCapture = capture;
    button.classList.add('is-listening');
    button.textContent = 'Listening…';

    const snapshot = () => {
      const activeInputs = new Set(); // Used to distinguish newly pressed controls from controls that were already held when listening began.
      const pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean); // Used to support whichever connected controller the player actually presses.
      for (const pad of pads) {
        for (const code of window.ControllerInput.getPressedBindingCodes(pad)) activeInputs.add(`${pad.index}:${code}`);
      }
      return { pads, activeInputs };
    };

    for (const key of snapshot().activeInputs) blockedInputs.add(key);
    const poll = () => {
      if (activeControllerCapture !== capture) return;
      const { pads, activeInputs } = snapshot(); // Used to find the first newly pressed supported binding code this frame.
      for (const key of [...blockedInputs]) if (!activeInputs.has(key)) blockedInputs.delete(key);
      for (const pad of pads) {
        for (const code of window.ControllerInput.getPressedBindingCodes(pad)) {
          const key = `${pad.index}:${code}`; // Used to keep identical buttons on two connected controllers from sharing edge state.
          if (blockedInputs.has(key)) continue;
          stopControllerCapture();
          onInput(code);
          return;
        }
      }
      capture.frame = requestAnimationFrame(poll);
    };
    capture.frame = requestAnimationFrame(poll);
  }

  function deviceActions(device) {
    const actions = window.InputBindings?.getActionsForDevice?.(device); // Used to hide controller-only contextual actions from the keyboard section.
    return Array.isArray(actions) ? actions : deps.INPUT_DEFAULTS.actions;
  }

  async function copyControlsJson(device, button, warning) {
    const actions = deviceActions(device); // Used to export exactly the controls represented by this Settings section.
    const bindings = Object.fromEntries(actions.map(action => [action.id, deps.inputBindings?.[device]?.[action.id] ?? null])); // Used as the portable action-to-input map copied to the clipboard.
    const modeShifts = (deps.inputBindings.modeShifts || []).filter(shift => (shift.device || 'desktop') === device).map(shift => ({ ...shift, bindings: { ...(shift.bindings || {}) } })); // Used to include device-specific shifted controls in the same JSON export.
    const payload = { version: 1, device: device === 'desktop' ? 'keyboard' : 'controller', bindings, modeShifts }; // Used as the stable exported JSON envelope.
    const text = JSON.stringify(payload, null, 2); // Used for readable clipboard output that can be pasted directly into bug reports or config work.
    let copied = false; // Used to choose between the modern Clipboard API and the compatibility fallback.
    try {
      await navigator.clipboard?.writeText?.(text);
      copied = true;
    } catch (_) {}
    if (!copied) {
      const textarea = document.createElement('textarea'); // Used as a clipboard fallback on browsers/pages where navigator.clipboard is unavailable.
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
      textarea.remove();
    }
    if (warning) warning.textContent = copied ? '' : 'Clipboard access failed; copy controls from the browser prompt.';
    if (!copied) window.prompt?.('Copy controls JSON', text);
    const normalLabel = device === 'desktop' ? 'Copy Keyboard Controls JSON' : 'Copy Controller Controls JSON'; // Used to restore the export button label after the success acknowledgement.
    button.textContent = copied ? 'Copied!' : normalLabel;
    if (copied) setTimeout(() => { if (button.isConnected) button.textContent = normalLabel; }, 1200);
  }

  function appendJsonCopyControl(el, device) {
    const row = document.createElement('div'); // Used to keep the JSON export directly beneath the corresponding keyboard/controller binding list.
    row.className = 'input-binding-row';
    const spacer = document.createElement('span'); // Used to preserve the existing binding-row alignment without adding a new stylesheet rule.
    const button = document.createElement('button'); // Used to copy this device's complete controls into JSON.
    button.type = 'button';
    button.className = 'settings-small-btn';
    button.textContent = device === 'desktop' ? 'Copy Keyboard Controls JSON' : 'Copy Controller Controls JSON';
    const warning = document.createElement('div'); // Used to surface clipboard failures in-game on mobile without requiring the console.
    warning.className = 'input-binding-warning';
    button.addEventListener('click', () => copyControlsJson(device, button, warning));
    row.append(spacer, button, warning);
    el.appendChild(row);
  }

  function renderInputSettings() {'''
if settings_helpers_anchor in read(settings_path):
    replace_once(settings_path, settings_helpers_anchor, settings_helpers_replacement)

old_render_device = '''    function renderDevice(el, device) {
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
    }'''
new_render_device = '''    function renderDevice(el, device) {
      if (!el) return;
      if (device === 'controller') stopControllerCapture();
      el.innerHTML = '';
      for (const action of deviceActions(device)) {
        const row = document.createElement('div'); row.className = 'input-binding-row';
        if (ACTION_BUTTON_IDS.has(action.id)) {
          row.classList.add('action-button-binding');
          row.dataset.actionSlot = action.id.slice('action'.length); // Used for inspection/debugging and future Settings styling without inferring from label text.
          row.title = 'Controls the matching visible gameplay action button.';
        }
        const controllerControls = '<span class="input-controller-bind-controls" style="display:flex;gap:6px;align-items:center"><select class="settings-select"></select><button type="button" class="settings-small-btn input-controller-listen-btn">Listen</button></span>'; // Used to pair manual selection with physical controller capture for every controller action.
        row.innerHTML = `<span class="settings-name">${actionDisplayLabel(action)}</span>${device === 'controller' ? controllerControls : `<button type="button" class="input-bind-btn">${deps.buttonLabel(deps.inputBindings[device][action.id])}</button>`}<div class="input-binding-warning"></div>`;
        const control = device === 'controller' ? row.querySelector('select') : row.querySelector('.input-bind-btn'); // Used as the actual binding value control for this action row.
        const warn = row.querySelector('.input-binding-warning'); // Used for conflicts and capture errors that must be visible without devtools.
        if (device === 'controller') {
          const listenButton = row.querySelector('.input-controller-listen-btn'); // Used to capture the next physical controller input for this action.
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
          listenButton.addEventListener('click', () => {
            listenForControllerInput(listenButton, code => {
              const conflict = deps.bindingConflict(device, code, action.id); // Used to apply the same collision rules as choosing the code from the dropdown.
              if (conflict) {
                warn.textContent = conflict;
                renderInputSettings();
                return;
              }
              deps.inputBindings.controller[action.id] = code;
              warn.textContent = '';
              saveBindingChange(device, action.id);
              renderInputSettings();
            }, message => {
              warn.textContent = message;
              renderInputSettings();
            });
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
      appendJsonCopyControl(el, device);
    }'''
if old_render_device in read(settings_path):
    replace_once(settings_path, old_render_device, new_render_device)

old_shift_actions = '''          deps.INPUT_DEFAULTS.actions.forEach(action => select.add(new Option(actionDisplayLabel(action), action.id)));'''
new_shift_actions = '''          deviceActions(shift.device || 'desktop').forEach(action => select.add(new Option(actionDisplayLabel(action), action.id)));'''
if old_shift_actions in read(settings_path):
    replace_once(settings_path, old_shift_actions, new_shift_actions)

old_shift_add = '''        const add = document.createElement('button'); add.type = 'button'; add.className = 'settings-small-btn'; add.textContent = 'Add Shifted Binding';
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
        });'''
new_shift_add = '''        const add = document.createElement('button'); add.type = 'button'; add.className = 'settings-small-btn'; add.textContent = 'Add Shifted Binding';
        add.addEventListener('click', () => {
          add.classList.add('is-listening'); add.textContent = 'Press shifted input…';
          const actionId = deviceActions(shift.device || 'desktop')[0]?.id || 'interact'; // Used as the initial action for a newly captured shifted binding until the row dropdown changes it.
          const applyBinding = button => {
            const conflict = deps.bindingConflict(shift.device || 'desktop', button, actionId, shift); // Used to keep shifted controller capture under the same conflict rules as ordinary bindings.
            if (!conflict) { shift.bindings = shift.bindings || {}; shift.bindings[button] = actionId; deps.saveInputBindings(); }
            renderInputSettings();
          };
          if ((shift.device || 'desktop') === 'controller') {
            listenForControllerInput(add, applyBinding, () => renderInputSettings());
            return;
          }
          const once = ev => {
            ev.preventDefault();
            window.removeEventListener('keydown', once, true);
            applyBinding(ev.code);
          };
          window.addEventListener('keydown', once, true);
        });'''
if old_shift_add in read(settings_path):
    replace_once(settings_path, old_shift_add, new_shift_add)

old_panel_export = '''  window.InputSettingsPanel = { init, render: renderInputSettings };'''
new_panel_export = '''  window.InputSettingsPanel = { init, render: renderInputSettings, isControllerListening: () => !!activeControllerCapture };'''
if old_panel_export in read(settings_path):
    replace_once(settings_path, old_panel_export, new_panel_export)

# 5) Route the hosted music minigame's discrete controls through configurable actions.
music_path = 'docs/js/music-minigame.js'
old_music_helper = '''    let controllerPrevButtons = [];
    let controllerAutoPickSector = -1;
    let controllerRightStickActive = false;
    const controllerButton = (gamepad, index, key, kind, value) => {
      const pressed = (gamepad.buttons[index]?.value || 0) > (kind === 'bank' ? 0.28 : 0.55);
      const wasPressed = Boolean(controllerPrevButtons[index]);
      if (pressed === wasPressed) return;
      controllerPrevButtons[index] = pressed;'''
new_music_helper = '''    let controllerPrevButtons = new Map(); // Used to edge-track semantic music actions after controller remapping.
    let controllerAutoPickSector = -1;
    let controllerRightStickActive = false;
    const controllerBinding = actionId => {
      const currentBindings = window.InputBindings?.getCurrentBindings?.()?.controller; // Used to preserve explicit Unbound values while still supporting shipped defaults before saved settings exist.
      if (currentBindings && Object.prototype.hasOwnProperty.call(currentBindings, actionId)) return currentBindings[actionId];
      const actionDefinition = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(action => action.id === actionId); // Used as the fallback when no saved binding exists yet.
      return actionDefinition?.controller || null;
    };
    const controllerButton = (gamepad, actionId, key, kind, value) => {
      const bindingCode = controllerBinding(actionId); // Used to route this musical action through the same controller mapping shown in Settings.
      const pressed = window.ControllerInput?.isBindingPressed?.(gamepad, bindingCode, { triggerThreshold: kind === 'bank' ? 0.28 : 0.55, buttonThreshold: 0.55, stickThreshold: 0.55 }) || false;
      const wasPressed = Boolean(controllerPrevButtons.get(actionId)); // Used to emit one note/bank/tap edge per configured press.
      if (pressed === wasPressed) return;
      controllerPrevButtons.set(actionId, pressed);'''
if old_music_helper in read(music_path):
    replace_once(music_path, old_music_helper, new_music_helper)

music_text = read(music_path)
music_text = music_text.replace('controllerPrevButtons = [];', 'controllerPrevButtons = new Map();')
write(music_path, music_text)

old_music_calls = '''      controllerButton(gamepad, 2, 'x', 'note', 0);
      controllerButton(gamepad, 0, 'a', 'note', 1);
      controllerButton(gamepad, 1, 'b', 'note', 2);
      controllerButton(gamepad, 3, 'y', 'note', 3);
      controllerButton(gamepad, 6, 'lt', 'bank', 'lt');
      controllerButton(gamepad, 7, 'rt', 'bank', 'rt');
      controllerButton(gamepad, 4, 'lb', 'bank', 'lb');
      controllerButton(gamepad, 5, 'rb', 'bank', 'rb');
      controllerButton(gamepad, 9, 'start', 'tap', 'pause');
      controllerButton(gamepad, 14, 'dpad-left', 'tap', 'scale-prev');
      controllerButton(gamepad, 15, 'dpad-right', 'tap', 'scale-next');'''
new_music_calls = '''      controllerButton(gamepad, 'musicNote1', 'note-1', 'note', 0);
      controllerButton(gamepad, 'musicNote2', 'note-2', 'note', 1);
      controllerButton(gamepad, 'musicNote3', 'note-3', 'note', 2);
      controllerButton(gamepad, 'musicNote4', 'note-4', 'note', 3);
      controllerButton(gamepad, 'musicBank1', 'bank-1', 'bank', 'lt');
      controllerButton(gamepad, 'musicBank2', 'bank-2', 'bank', 'rt');
      controllerButton(gamepad, 'musicBank3', 'bank-3', 'bank', 'lb');
      controllerButton(gamepad, 'musicBank4', 'bank-4', 'bank', 'rb');
      controllerButton(gamepad, 'musicPause', 'pause', 'tap', 'pause');
      controllerButton(gamepad, 'musicScalePrev', 'scale-prev', 'tap', 'scale-prev');
      controllerButton(gamepad, 'musicScaleNext', 'scale-next', 'tap', 'scale-next');'''
if old_music_calls in read(music_path):
    replace_once(music_path, old_music_calls, new_music_calls)

# 6) Let Social Actions honor triggers/right-stick directional bindings too, not only ButtonN.
social_path = 'docs/js/social-action-wheel.js'
old_button_index = '''  function buttonIndex(code) {
    const match = /^Button(\\d+)$/.exec(String(code || ''));
    return match ? Number(match[1]) : -1;
  }

'''
if old_button_index in read(social_path):
    replace_once(social_path, old_button_index, '')

old_social_poll = '''      const previous = state.priorGamepad.get(pad.index) || [];
      const current = pad.buttons.map(button => !!button?.pressed);
      const openCode = binding('controller', 'socialWheel', cfg.controllerOpen || DEFAULTS.controllerOpen);
      const dodgeCode = binding('controller', 'dodge', 'Button1');
      const openIndex = buttonIndex(openCode);
      const dodgeIndex = buttonIndex(dodgeCode);

      const openNow = openIndex >= 0 && current[openIndex];
      const openBefore = openIndex >= 0 && previous[openIndex];
      if (openNow && !openBefore) openWheel('controller', false);

      if (state.open && state.openSource === 'controller') {
        const x = Number(pad.axes?.[0]) || 0;
        const y = Number(pad.axes?.[1]) || 0;
        selectFromVector(x, y);
        if (!openNow && openBefore) commitSelection();
      }

      if ((state.open || state.dance) && dodgeIndex >= 0 && current[dodgeIndex] && !previous[dodgeIndex]) {
        cancelWheelOrDance('dodge');
      }

      state.priorGamepad.set(pad.index, current);'''
new_social_poll = '''      const previousActions = state.priorGamepad.get(pad.index) || { open: false, dodge: false }; // Used to edge-track semantic wheel actions independently of their physical bindings.
      const openCode = binding('controller', 'socialWheel', cfg.controllerOpen || DEFAULTS.controllerOpen); // Used to honor the player's current Social Actions binding.
      const dodgeCode = binding('controller', 'dodge', 'Button1'); // Used to honor the player's current cancel/dodge binding.
      const openNow = window.ControllerInput?.isBindingPressed?.(pad, openCode) || false; // Used so triggers and right-stick directional bindings work in addition to ButtonN codes.
      const dodgeNow = window.ControllerInput?.isBindingPressed?.(pad, dodgeCode) || false; // Used to cancel the wheel/dance through any supported configured controller input.

      if (openNow && !previousActions.open) openWheel('controller', false);

      if (state.open && state.openSource === 'controller') {
        const x = Number(pad.axes?.[0]) || 0;
        const y = Number(pad.axes?.[1]) || 0;
        selectFromVector(x, y);
        if (!openNow && previousActions.open) commitSelection();
      }

      if ((state.open || state.dance) && dodgeNow && !previousActions.dodge) {
        cancelWheelOrDance('dodge');
      }

      state.priorGamepad.set(pad.index, { open: openNow, dodge: dodgeNow });'''
if old_social_poll in read(social_path):
    replace_once(social_path, old_social_poll, new_social_poll)

# Verify the intended call sites are now symbolic/configurable.
ensure_contains(config_path, '"id": "uiOpenMenu"')
ensure_contains(config_path, '"id": "meleeAutoTargetToggle"')
ensure_contains(settings_path, 'Copy Controller Controls JSON')
ensure_contains(settings_path, 'listenForControllerInput')
ensure_contains(nav_path, "open: 'uiOpenMenu'")
ensure_contains(music_path, "'musicNote1'")
ensure_contains(game_path, 'inputBindings.controller?.meleeAutoTargetToggle')
ensure_contains(social_path, 'previousActions')

# Syntax-check every JavaScript file touched by this patch before committing it.
for js_file in [
    'docs/config/scratchbones-config.js',
    'docs/game.js',
    'docs/js/controller-ui-nav.js',
    'docs/js/input-settings-panel.js',
    'docs/js/music-minigame.js',
    'docs/js/social-action-wheel.js',
    'docs/js/input-bindings.js',
    'docs/js/controller-input.js',
]:
    subprocess.run(['node', '--check', str(ROOT / js_file)], check=True)

print('Controller binding patch applied and JavaScript syntax checks passed.')

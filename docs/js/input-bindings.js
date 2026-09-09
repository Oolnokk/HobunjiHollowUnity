(() => {
  'use strict';

  // Input-binding load/save/labeling helpers extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as
  // js/dye-system.js. `inputBindings` itself (the live, mutated-in-place
  // binding state) stays in game.js — it's read/written from many places
  // well beyond this cluster — so it's threaded through as a getter rather
  // than a captured reference, since it isn't known yet at the point
  // loadInputBindings() must first run to produce it. game.js calls
  // init() twice: once with just INPUT_DEFAULTS (enough for
  // loadInputBindings() to bootstrap `inputBindings`), then again right
  // after with the getInputBindings getter added once that const exists.
  let deps = null;
  const AUTOMATIC_SELECTION_ACTION_IDS = new Set(['toolSelect', 'itemSelect', 'utilityMenu', 'socialWheel']); // Used to keep held wheel/arch openers out of ordinary gameplay dispatch and reserve their sticks for selector navigation.
  const REQUIRED_CONTROLLER_ACTIONS = Object.freeze([
    { id: 'itemSelect', label: 'Item Select', desktop: null, controller: null, devices: ['controller'], context: 'selection' },
    { id: 'toggleMount', label: 'Call/Dismiss Mount', desktop: 'KeyV', controller: null },
  ]); // Used to guarantee Settings always exposes Item Select and Call/Dismiss Mount even when an older config predates those controller rows.
  let explicitMountBindingKnown = false; // Used by the legacy-migration repair loop to distinguish an intentional saved mount choice (including Unbound) from a shipped default.
  let explicitMountBinding = null; // Stores the player's last explicit Call/Dismiss Mount controller choice so Social Actions cannot silently erase it later.
  let mountRepairTimer = null; // Keeps one lightweight repair interval alive after game.js supplies the live inputBindings getter.

  function removeLegacyControllerModeShift(modeShifts) {
    return (Array.isArray(modeShifts) ? modeShifts : []).filter(shift => shift?.id !== 'controller-left-bumper');
  }

  function ensureAction(actions, definition) {
    if (!Array.isArray(actions) || !definition?.id) return null;
    let action = actions.find(entry => entry?.id === definition.id) || null; // Reuses the authored action object whenever the project already defines it.
    if (!action) {
      action = { ...definition };
      actions.push(action);
    }
    return action;
  }

  function patchAutomaticSelectionDefaults(INPUT_DEFAULTS) {
    if (!INPUT_DEFAULTS) return;
    const actions = INPUT_DEFAULTS.actions;
    if (Array.isArray(actions)) {
      for (const required of REQUIRED_CONTROLLER_ACTIONS) ensureAction(actions, required);
      for (const action of actions) {
        if (AUTOMATIC_SELECTION_ACTION_IDS.has(action?.id)) action.context = 'selection';
      }
    }
    if (INPUT_DEFAULTS.controller) {
      if (!Object.prototype.hasOwnProperty.call(INPUT_DEFAULTS.controller, 'itemSelect')) INPUT_DEFAULTS.controller.itemSelect = null;
      if (!Object.prototype.hasOwnProperty.call(INPUT_DEFAULTS.controller, 'toggleMount')) INPUT_DEFAULTS.controller.toggleMount = null;
    }
    if (Array.isArray(INPUT_DEFAULTS.modeShifts)) {
      const kept = removeLegacyControllerModeShift(INPUT_DEFAULTS.modeShifts); // Used to migrate the old LB+right-stick tool/item selector out of shipped defaults in place.
      INPUT_DEFAULTS.modeShifts.splice(0, INPUT_DEFAULTS.modeShifts.length, ...kept);
    }
  }

  function repairExplicitMountBinding() {
    if (!explicitMountBindingKnown) return false;
    const bindings = deps?.getInputBindings?.(); // Used to compare the live controller map against the last explicit Settings choice.
    if (!bindings?.controller || bindings.controller.toggleMount === explicitMountBinding) return false;
    bindings.controller.toggleMount = explicitMountBinding;
    localStorage.setItem(deps.INPUT_DEFAULTS.storageKey, JSON.stringify(bindings));
    return true;
  }

  function startMountRepairLoop() {
    if (mountRepairTimer || !deps?.getInputBindings) return;
    mountRepairTimer = setInterval(repairExplicitMountBinding, 250);
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    patchAutomaticSelectionDefaults(deps?.INPUT_DEFAULTS);
    startMountRepairLoop();
  }

  function loadInputBindings() {
    const INPUT_DEFAULTS = deps.INPUT_DEFAULTS;
    patchAutomaticSelectionDefaults(INPUT_DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(INPUT_DEFAULTS.storageKey) || 'null');
      if (saved?.controller && Object.prototype.hasOwnProperty.call(saved.controller, 'toggleMount')) {
        explicitMountBindingKnown = true;
        explicitMountBinding = saved.controller.toggleMount ?? null;
      }
      const controller = { ...INPUT_DEFAULTS.controller, ...(saved?.controller || {}) }; // Used as the live controller map after adding controller actions introduced after an older save was written.
      if (!Object.prototype.hasOwnProperty.call(controller, 'itemSelect')) controller.itemSelect = null;
      if (!Object.prototype.hasOwnProperty.call(controller, 'toggleMount')) controller.toggleMount = null;
      return {
        desktop: { ...INPUT_DEFAULTS.desktop, ...(saved?.desktop || {}) },
        controller,
        modeShifts: removeLegacyControllerModeShift(Array.isArray(saved?.modeShifts) ? saved.modeShifts : INPUT_DEFAULTS.modeShifts),
      };
    } catch (_err) {
      const controller = { ...INPUT_DEFAULTS.controller }; // Used by the corrupt-save fallback while still guaranteeing the newly bindable controller actions exist.
      if (!Object.prototype.hasOwnProperty.call(controller, 'itemSelect')) controller.itemSelect = null;
      if (!Object.prototype.hasOwnProperty.call(controller, 'toggleMount')) controller.toggleMount = null;
      return { desktop: { ...INPUT_DEFAULTS.desktop }, controller, modeShifts: removeLegacyControllerModeShift(INPUT_DEFAULTS.modeShifts) };
    }
  }

  function getCurrentBindings() {
    return deps?.getInputBindings?.() || null;
  }

  function saveInputBindings() {
    const bindings = getCurrentBindings();
    if (!bindings) return false;
    bindings.modeShifts = removeLegacyControllerModeShift(bindings.modeShifts); // Prevents an imported/old runtime copy from re-saving the obsolete LB selector shift.
    localStorage.setItem(deps.INPUT_DEFAULTS.storageKey, JSON.stringify(bindings));
    return true;
  }

  // Held outside the rebindable-action set entirely (see game.js's
  // desktopHoldKeys) — binding anything else here would look successful in
  // Settings but silently never fire, since KeyQ never reaches the generic
  // dispatch on desktop.
  const RESERVED_DESKTOP_CODES = { KeyQ: 'the held Item Wheel' };

  function actionDefinition(actionId) {
    return deps?.INPUT_DEFAULTS?.actions?.find(action => action.id === actionId)
      || REQUIRED_CONTROLLER_ACTIONS.find(action => action.id === actionId)
      || null;
  }

  function actionContext(actionId) {
    if (AUTOMATIC_SELECTION_ACTION_IDS.has(actionId)) return 'selection';
    return actionDefinition(actionId)?.context || 'gameplay';
  }

  function supportsDevice(action, device) {
    return !Array.isArray(action?.devices) || action.devices.includes(device);
  }

  function getActionsForDevice(device) {
    const authored = [...(deps?.INPUT_DEFAULTS?.actions || [])]; // Used as the Settings/export action list before controller-only compatibility rows are appended.
    for (const required of REQUIRED_CONTROLLER_ACTIONS) {
      if (!authored.some(action => action?.id === required.id)) authored.push(required);
    }
    return authored.filter(action => supportsDevice(action, device));
  }

  function contextsConflict(targetContext, otherContext) {
    if (targetContext === otherContext) return true;
    return (targetContext === 'selection' && otherContext === 'gameplay')
      || (targetContext === 'gameplay' && otherContext === 'selection');
  }

  function bindingConflict(device, button, actionId, modeShift = null) {
    if (!button) return '';
    if (modeShift && button === modeShift.button) return 'Shifted input cannot use its held mode-shift button.';
    if (device === 'desktop' && RESERVED_DESKTOP_CODES[button]) return `Reserved for ${RESERVED_DESKTOP_CODES[button]}.`;
    if (device === 'controller' && AUTOMATIC_SELECTION_ACTION_IDS.has(actionId) && String(button).startsWith('RightStick')) {
      return 'Stick directions are reserved for navigating this wheel or arch while its opener is held.';
    }
    const inputBindings = getCurrentBindings();
    const bindings = inputBindings?.[device] || {};
    const targetContext = actionContext(actionId); // Used so mutually exclusive menu/music bindings may share controls while held gameplay selectors still conflict with live gameplay actions.
    for (const [otherAction, otherButton] of Object.entries(bindings)) {
      if (otherAction === actionId || otherButton !== button) continue;
      const otherDefinition = actionDefinition(otherAction); // Used to ignore stale/saved bindings that are not applicable to this device.
      if (otherDefinition && !supportsDevice(otherDefinition, device)) continue;
      if (contextsConflict(targetContext, actionContext(otherAction))) return `Already bound to ${actionLabel(otherAction)}.`;
    }
    if (!modeShift) return '';
    for (const [otherButton, otherAction] of Object.entries(modeShift.bindings || {})) {
      if (otherAction === actionId && otherButton === button) return `Already bound to ${actionLabel(actionId)} in this mode shift.`;
    }
    return '';
  }

  function actionLabel(id) {
    return actionDefinition(id)?.label || id;
  }

  function buttonLabel(code) {
    if (!code) return 'Unbound';
    const chordParts = String(code).split('+').map(part => part.trim()).filter(Boolean);
    if (chordParts.length > 1) {
      const key = chordParts.pop();
      return `${chordParts.join(' + ')} + ${buttonLabel(key)}`;
    }
    const labels = {
      LeftTrigger: 'LT', RightTrigger: 'RT', RightStickLeft: 'RS ←', RightStickRight: 'RS →', RightStickUp: 'RS ↑', RightStickDown: 'RS ↓', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
      Mouse0: 'Left Click', Mouse1: 'Middle Click', Mouse2: 'Right Click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
    };
    return labels[code] || String(code).replace(/^Key/, '').replace(/^Digit/, '').replace(/^Button/, 'Pad ');
  }

  window.addEventListener('hobunji-input-bindings-changed', event => {
    if (event?.detail?.device !== 'controller' || event.detail.actionId !== 'toggleMount') return;
    explicitMountBindingKnown = true;
    explicitMountBinding = event.detail.binding ?? null;
  });

  window.InputBindings = {
    init, loadInputBindings, getCurrentBindings, saveInputBindings, repairExplicitMountBinding,
    bindingConflict, actionLabel, buttonLabel, actionContext, getActionsForDevice,
  };
})();
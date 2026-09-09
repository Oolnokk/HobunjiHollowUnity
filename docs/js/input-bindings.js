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
  const CANONICAL_CONTROLLER_DEFAULTS = Object.freeze({
    interact: 'Button0',
    dodge: 'Button1',
    action1: 'RightTrigger',
    action2: 'LeftTrigger',
    action3: 'Button2',
    action4: null,
    action5: null,
    action6: null,
    action7: null,
    action8: null,
    swapTarget: null,
    meleeTargetPrev: 'RightStickLeft',
    meleeTargetNext: 'RightStickRight',
    toggleMount: 'Button10',
    weaponSwitch: 'Button11',
    utilityMenu: 'Button12',
    toolSelect: 'Button5',
    itemPrev: null,
    itemNext: null,
    toolPrev: null,
    toolNext: null,
    tool1: null,
    tool2: null,
    tool4: null,
    tool5: null,
    tool6: null,
    uiOpenMenu: 'Button8',
    uiConfirm: 'Button0',
    uiCancel: 'Button1',
    uiTabPrev: 'Button4',
    uiTabNext: 'Button5',
    uiUp: 'Button12',
    uiDown: 'Button13',
    uiLeft: 'Button14',
    uiRight: 'Button15',
    musicNote1: 'Button2',
    musicNote2: 'Button0',
    musicNote3: 'Button1',
    musicNote4: 'Button3',
    musicBank1: 'LeftTrigger',
    musicBank2: 'RightTrigger',
    musicBank3: 'Button4',
    musicBank4: 'Button5',
    musicPause: 'Button9',
    musicScalePrev: 'Button14',
    musicScaleNext: 'Button15',
    meleeAutoTargetToggle: 'Button3',
    socialWheel: 'Button15',
    itemSelect: 'Button4',
  }); // Canonical controller reset/fresh-player layout; kept in one map so legacy authored values cannot drift away from the shipped controller experience.
  const REQUIRED_CONTROLLER_ACTIONS = Object.freeze([
    { id: 'itemSelect', label: 'Item Select', desktop: null, controller: CANONICAL_CONTROLLER_DEFAULTS.itemSelect, devices: ['controller'], context: 'selection' },
    { id: 'socialWheel', label: 'Social Actions', desktop: 'Shift+KeyQ', controller: CANONICAL_CONTROLLER_DEFAULTS.socialWheel, context: 'selection' },
    { id: 'toggleMount', label: 'Call/Dismiss Mount', desktop: 'KeyV', controller: CANONICAL_CONTROLLER_DEFAULTS.toggleMount },
  ]); // Used to guarantee Settings always exposes controller actions that older authored configs may not contain yet.
  let explicitMountBindingKnown = false; // Used by the legacy-migration repair loop to distinguish an intentional saved mount choice (including Unbound) from a shipped default.
  let explicitMountBinding = null; // Stores the player's last explicit Call/Dismiss Mount controller choice so Social Actions cannot silently erase it later.
  let mountRepairTimer = null; // Keeps one lightweight repair interval alive after game.js supplies the live inputBindings getter.

  function removeLegacyControllerModeShift(modeShifts) {
    return (Array.isArray(modeShifts) ? modeShifts : []).filter(shift => shift?.id !== 'controller-left-bumper');
  }

  function cloneModeShift(shift) {
    return { ...shift, bindings: { ...(shift?.bindings || {}) } }; // Used by per-device resets so authored defaults never share mutable nested binding objects with live Settings state.
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
    const useCanonicalControllerLayout = INPUT_DEFAULTS.storageKey === 'scratchbones.inputBindings.v1'; // Limits the shipped game layout override to the real game config while allowing isolated tests/tools to supply their own authored defaults.
    const actions = INPUT_DEFAULTS.actions;
    if (Array.isArray(actions)) {
      for (const required of REQUIRED_CONTROLLER_ACTIONS) ensureAction(actions, required);
      for (const action of actions) {
        if (useCanonicalControllerLayout && Object.prototype.hasOwnProperty.call(CANONICAL_CONTROLLER_DEFAULTS, action?.id)) {
          action.controller = CANONICAL_CONTROLLER_DEFAULTS[action.id]; // Makes fresh-player and reset behavior authoritative even when older config rows still carry obsolete controller values.
        }
        if (AUTOMATIC_SELECTION_ACTION_IDS.has(action?.id)) action.context = 'selection';
      }
    }
    if (!INPUT_DEFAULTS.controller) INPUT_DEFAULTS.controller = {}; // Used as the generated controller-default map consumed by load/reset code.
    if (useCanonicalControllerLayout) Object.assign(INPUT_DEFAULTS.controller, CANONICAL_CONTROLLER_DEFAULTS);
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
      return {
        desktop: { ...INPUT_DEFAULTS.desktop, ...(saved?.desktop || {}) },
        controller,
        modeShifts: removeLegacyControllerModeShift(Array.isArray(saved?.modeShifts) ? saved.modeShifts : INPUT_DEFAULTS.modeShifts),
      };
    } catch (_err) {
      const controller = { ...INPUT_DEFAULTS.controller }; // Used by the corrupt-save fallback while still guaranteeing the canonical controller layout exists.
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

  function getDefaultBindings(device) {
    if (device !== 'desktop' && device !== 'controller') return null;
    patchAutomaticSelectionDefaults(deps?.INPUT_DEFAULTS);
    const defaults = {}; // Used as a fresh device-only binding map so Reset never mutates the authored config object itself.
    for (const action of getActionsForDevice(device)) {
      const authoredValue = Object.prototype.hasOwnProperty.call(action || {}, device) ? action[device] : undefined; // Used so runtime-authored migrations such as Social Actions/Call Mount win over an older precomputed map.
      const mappedValue = deps?.INPUT_DEFAULTS?.[device]?.[action.id]; // Used as the fallback for actions whose defaults are generated outside the authored action row.
      defaults[action.id] = authoredValue !== undefined ? authoredValue : (mappedValue ?? null);
    }
    for (const [actionId, binding] of Object.entries(deps?.INPUT_DEFAULTS?.[device] || {})) {
      if (!Object.prototype.hasOwnProperty.call(defaults, actionId)) defaults[actionId] = binding ?? null;
    }
    return defaults;
  }

  function getDefaultModeShifts(device) {
    if (device !== 'desktop' && device !== 'controller') return [];
    patchAutomaticSelectionDefaults(deps?.INPUT_DEFAULTS);
    return removeLegacyControllerModeShift(deps?.INPUT_DEFAULTS?.modeShifts)
      .filter(shift => (shift.device || 'desktop') === device)
      .map(cloneModeShift);
  }

  function resetDeviceToDefaults(device) {
    if (device !== 'desktop' && device !== 'controller') return false;
    const bindings = getCurrentBindings(); // Used as the mutable live binding object so the opposite device can remain completely untouched.
    const defaults = getDefaultBindings(device); // Used to replace only the selected keyboard/controller map with authored defaults.
    if (!bindings || !defaults) return false;
    const target = bindings[device] || (bindings[device] = {}); // Used in place so any subsystem holding the existing per-device object sees reset values immediately.
    for (const actionId of Object.keys(target)) delete target[actionId];
    Object.assign(target, defaults);

    const otherModeShifts = removeLegacyControllerModeShift(bindings.modeShifts).filter(shift => (shift.device || 'desktop') !== device).map(cloneModeShift); // Preserves custom/default mode shifts belonging to the other device.
    const defaultModeShifts = getDefaultModeShifts(device); // Restores only this device's authored shifted bindings alongside its ordinary controls.
    bindings.modeShifts = [...otherModeShifts, ...defaultModeShifts];

    if (device === 'controller') {
      explicitMountBindingKnown = true;
      explicitMountBinding = target.toggleMount ?? null;
    }
    if (!saveInputBindings()) return false;
    for (const actionId of Object.keys(target)) {
      window.dispatchEvent(new CustomEvent('hobunji-input-bindings-changed', {
        detail: { device, actionId, binding: target[actionId] ?? null },
      }));
    }
    window.dispatchEvent(new CustomEvent('hobunji-input-bindings-reset', { detail: { device } }));
    return true;
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
    resetDeviceToDefaults, getDefaultBindings, getDefaultModeShifts,
    canonicalControllerDefaults: CANONICAL_CONTROLLER_DEFAULTS,
    bindingConflict, actionLabel, buttonLabel, actionContext, getActionsForDevice,
  };
})();
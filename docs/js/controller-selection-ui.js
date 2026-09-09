// Controller-held selection UI adapter.
//
// Tool Select, Item Select, Utility Menu, and Social Actions are semantic
// opener actions. Holding one temporarily gives BOTH analog sticks to the
// opened selector: horizontal motion steps corner arches, while full radial
// motion selects the centered Social Actions wheel. Releasing the opener
// commits. No authored mode-shift binding is required.
(() => {
  'use strict';

  if (window.ControllerSelectionUI?.installed) return;

  const STICK_PRESS = 0.55;
  const WHEEL_DEADZONE = 0.28;
  const REPEAT_INITIAL_MS = 330;
  const REPEAT_RATE_MS = 135;
  const SELECTORS = Object.freeze({
    toolSelect: Object.freeze({ kind: 'tool', open: 'openTool', step: 'scrollTool' }),
    itemSelect: Object.freeze({ kind: 'item', open: 'openItem', step: 'scrollItem' }),
    utilityMenu: Object.freeze({ kind: 'utilities', open: 'openUtilities', step: 'scrollEntries' }),
    socialWheel: Object.freeze({ kind: 'social' }),
  }); // Maps bindable opener actions to the existing selector APIs they own while held.
  const SELECTOR_ACTION_IDS = Object.freeze(Object.keys(SELECTORS)); // Used each frame to find the first configured selector opener currently held.

  const state = {
    activeAction: null,
    kind: null,
    openerCode: null,
    padIndex: null,
    lock: null,
    lastArchDirection: 0,
    nextRepeatAt: 0,
    preferredPadIndex: null,
    lastStickSource: 'none',
    lastInput: 'ready',
    ownerGateInstalled: false,
  }; // Exposed through getDebug() so controller selection can be diagnosed without browser devtools.

  let controllerUiBaseIsActive = null; // Keeps ControllerUI's real menu-state query available after we extend its gameplay ownership gate.
  let frameHandle = 0; // Owns the single requestAnimationFrame polling loop for held selector inputs.

  function currentControllerBindings() {
    return window.InputBindings?.getCurrentBindings?.()?.controller || null;
  }

  function bindingFor(actionId) {
    const bindings = currentControllerBindings(); // Used to honor live Settings changes immediately, including an explicit Unbound value.
    if (bindings && Object.prototype.hasOwnProperty.call(bindings, actionId)) return bindings[actionId];
    const action = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(entry => entry?.id === actionId); // Used only during the brief boot window before InputBindings has a live map.
    return action?.controller || null;
  }

  function isDown(pad, code) {
    return Boolean(code && window.ControllerInput?.isBindingPressed?.(pad, code, { stickThreshold: STICK_PRESS }));
  }

  function connectedPads() {
    return Array.from(navigator.getGamepads?.() || []).filter(pad => pad && pad.connected !== false);
  }

  function choosePad() {
    const pads = connectedPads(); // Used to preserve the controller already navigating a selector even if another connected pad twitches.
    if (state.padIndex !== null) return pads.find(pad => pad.index === state.padIndex) || null;
    const picked = window.ControllerInput?.pickActiveGamepad?.(pads, state.preferredPadIndex, 0.35) || pads[0] || null;
    if (picked) state.preferredPadIndex = picked.index;
    return picked;
  }

  function installControllerUiOwnerGate() {
    const ui = window.ControllerUI;
    if (!ui?.isActive || ui.isActive.__controllerSelectionOwnerGate) return;
    const original = ui.isActive.bind(ui); // Used by menuIsActive() so selector ownership never disguises a genuinely open menu from this adapter.
    const wrapped = function controllerSelectionOwnerGate() {
      return Boolean(state.activeAction) || original();
    };
    wrapped.__controllerSelectionOwnerGate = true;
    wrapped.__controllerSelectionOwnerGateOriginal = original;
    ui.isActive = wrapped;
    controllerUiBaseIsActive = original;
    state.ownerGateInstalled = true;
  }

  function menuIsActive() {
    if (controllerUiBaseIsActive) return Boolean(controllerUiBaseIsActive());
    const current = window.ControllerUI?.isActive;
    if (!current || current.__controllerSelectionOwnerGate) return false;
    return Boolean(current.call(window.ControllerUI));
  }

  function musicOwnsController() {
    return Boolean(window.MusicMinigame?.state?.active);
  }

  function acquireGameplayLock(actionId) {
    state.lock?.release?.();
    state.lock = window.CharacterActionLocks?.acquire?.({
      owner: `controller-selection:${actionId}`,
      reason: 'Choosing from a controller wheel or arch',
      participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }],
    }) || null;
  }

  function releaseGameplayLock() {
    state.lock?.release?.();
    state.lock = null;
  }

  function sharedArch() {
    return window.SharedSelectionArch || window._desktopSelectionArc || null;
  }

  function openSelector(actionId) {
    const selector = SELECTORS[actionId];
    if (!selector) return false;
    if (selector.kind === 'social') {
      return window.SocialActionWheel?.open?.('controller-selection', false) !== false;
    }
    const arch = sharedArch();
    if (!arch || typeof arch[selector.open] !== 'function') return false;
    arch[selector.open]();
    return true;
  }

  function beginSelection(actionId, pad, openerCode) {
    if (!pad || !openerCode || !openSelector(actionId)) return false;
    const selector = SELECTORS[actionId]; // Used to keep release/stepping behavior stable even if bindings are edited while this hold is active.
    state.activeAction = actionId;
    state.kind = selector.kind;
    state.openerCode = openerCode;
    state.padIndex = pad.index;
    state.lastArchDirection = 0;
    state.nextRepeatAt = 0;
    state.lastStickSource = 'none';
    state.lastInput = `${actionId} opened`;
    acquireGameplayLock(actionId);
    window.dispatchEvent(new CustomEvent('hobunji-controller-owner-change', { detail: { owner: `selection:${selector.kind}` } }));
    return true;
  }

  function finishSelection(commit = true, reason = 'release') {
    if (!state.activeAction) return false;
    if (state.kind === 'social') {
      window.SocialActionWheel?.close?.(commit);
    } else {
      const arch = sharedArch(); // Used to commit through the same release path as held pointer/desktop selectors rather than duplicating selection rules.
      if (commit) arch?.releaseSelection?.();
      else arch?.close?.();
    }
    state.lastInput = `${state.activeAction} ${commit ? 'committed' : 'cancelled'} (${reason})`;
    state.activeAction = null;
    state.kind = null;
    state.openerCode = null;
    state.padIndex = null;
    state.lastArchDirection = 0;
    state.nextRepeatAt = 0;
    state.lastStickSource = 'none';
    releaseGameplayLock();
    window.dispatchEvent(new CustomEvent('hobunji-controller-owner-change', { detail: { owner: menuIsActive() ? 'menu' : 'gameplay' } }));
    return true;
  }

  function axis(pad, index) {
    return Number(pad?.axes?.[index]) || 0;
  }

  function strongestStick(pad) {
    const left = { x: axis(pad, 0), y: axis(pad, 1), source: 'left' }; // Compared with the right stick so either hand can steer every selector.
    const right = { x: axis(pad, 2), y: axis(pad, 3), source: 'right' }; // Compared with the left stick so both sticks have identical selection authority.
    left.magnitude = Math.hypot(left.x, left.y);
    right.magnitude = Math.hypot(right.x, right.y);
    const picked = right.magnitude > left.magnitude ? right : left; // Resolves simultaneous input deterministically by the stronger physical throw.
    state.lastStickSource = picked.magnitude > WHEEL_DEADZONE ? picked.source : 'none';
    return picked;
  }

  function strongestHorizontalDirection(pad) {
    const leftX = axis(pad, 0); // Used by arch navigation so the left stick can step the same selector as the right stick.
    const rightX = axis(pad, 2); // Used by arch navigation so the right stick remains equally valid without an authored mode shift.
    const picked = Math.abs(rightX) > Math.abs(leftX)
      ? { value: rightX, source: 'right' }
      : { value: leftX, source: 'left' }; // Chooses one direction when both sticks are moved, avoiding double-steps in a single frame.
    if (Math.abs(picked.value) < STICK_PRESS) {
      state.lastStickSource = 'none';
      return 0;
    }
    state.lastStickSource = picked.source;
    return picked.value < 0 ? -1 : 1;
  }

  function stepArch(direction) {
    const selector = SELECTORS[state.activeAction];
    const arch = sharedArch();
    if (!selector?.step || !arch || typeof arch[selector.step] !== 'function') return false;
    const result = arch[selector.step](direction);
    state.lastInput = `${state.activeAction} ${direction < 0 ? 'left' : 'right'} via ${state.lastStickSource} stick`;
    return result !== false;
  }

  function updateArch(pad, now) {
    const direction = strongestHorizontalDirection(pad); // Used as a digital left/right channel for every corner arch regardless of which stick supplied it.
    if (!direction) {
      state.lastArchDirection = 0;
      state.nextRepeatAt = 0;
      return;
    }
    if (direction !== state.lastArchDirection) {
      state.lastArchDirection = direction;
      state.nextRepeatAt = now + REPEAT_INITIAL_MS;
      stepArch(direction);
      return;
    }
    if (state.nextRepeatAt > 0 && now >= state.nextRepeatAt) {
      state.nextRepeatAt = now + REPEAT_RATE_MS;
      stepArch(direction);
    }
  }

  function dispatchSocialVector(stick) {
    const overlay = document.getElementById('socialActionOverlay');
    const wheel = document.getElementById('socialActionWheel');
    if (!overlay || !wheel) return false;
    const rect = wheel.getBoundingClientRect(); // Used to translate an analog unit vector into the existing wheel's pointer-selection coordinate system.
    const radius = Math.min(rect.width, rect.height) * 0.37;
    const magnitude = stick.magnitude || 0;
    const scale = magnitude >= WHEEL_DEADZONE ? Math.min(1, magnitude) / Math.max(magnitude, 1e-6) : 0; // Centers the synthetic pointer inside the wheel deadzone, otherwise preserves the stick's true angle.
    const clientX = rect.left + rect.width / 2 + stick.x * scale * radius;
    const clientY = rect.top + rect.height / 2 + stick.y * scale * radius;
    const init = { bubbles: true, cancelable: true, clientX, clientY, pointerType: 'mouse', pointerId: 9402 }; // Uses the Social Action wheel's existing pointer path rather than duplicating its private action-index math.
    const event = typeof PointerEvent === 'function' ? new PointerEvent('pointermove', init) : new MouseEvent('mousemove', init);
    overlay.dispatchEvent(event);
    state.lastInput = magnitude >= WHEEL_DEADZONE ? `social radial via ${state.lastStickSource} stick` : 'social radial centered';
    return true;
  }

  function updateSocial(pad) {
    dispatchSocialVector(strongestStick(pad));
  }

  function firstPressedSelector(pad) {
    for (const actionId of SELECTOR_ACTION_IDS) {
      const code = bindingFor(actionId); // Used to pair the semantic action with its current physical opener without hardcoded bumper/D-pad knowledge.
      if (isDown(pad, code)) return { actionId, code };
    }
    return null;
  }

  function poll(now = performance.now()) {
    installControllerUiOwnerGate();
    window.InputBindings?.repairExplicitMountBinding?.();

    const pad = choosePad(); // Used for both opener-edge detection and navigation so a held selector cannot jump controllers midway through the gesture.
    if (state.activeAction) {
      if (!pad) {
        finishSelection(false, 'controller disconnected');
      } else if (menuIsActive() || musicOwnsController()) {
        finishSelection(false, menuIsActive() ? 'menu opened' : 'music opened');
      } else if (!isDown(pad, state.openerCode)) {
        finishSelection(true, 'opener released');
      } else if (state.kind === 'social') {
        updateSocial(pad);
      } else {
        updateArch(pad, now);
      }
    } else if (pad && !menuIsActive() && !musicOwnsController()) {
      const pressed = firstPressedSelector(pad); // Used to open selectors directly from their configured action rather than from a separate shifted-direction binding table.
      if (pressed) beginSelection(pressed.actionId, pad, pressed.code);
    }

    frameHandle = requestAnimationFrame(poll);
  }

  function debugSnapshot() {
    return {
      activeAction: state.activeAction,
      kind: state.kind,
      openerCode: state.openerCode,
      padIndex: state.padIndex,
      preferredPadIndex: state.preferredPadIndex,
      lastStickSource: state.lastStickSource,
      lastInput: state.lastInput,
      ownerGateInstalled: state.ownerGateInstalled,
      menuActive: menuIsActive(),
      bindings: Object.fromEntries(SELECTOR_ACTION_IDS.map(actionId => [actionId, bindingFor(actionId)])),
    };
  }

  function showDebug() {
    const snapshot = debugSnapshot(); // Used to provide an in-page/mobile-friendly diagnostic without requiring the browser console.
    const text = `Controller selector: ${snapshot.activeAction || 'idle'} | pad=${snapshot.padIndex ?? '-'} | stick=${snapshot.lastStickSource} | ${snapshot.lastInput}`;
    const existing = document.getElementById('controllerSelectionDebugToast'); // Reused between taps so debug output never accumulates DOM nodes.
    const output = existing || document.createElement('output');
    output.id = 'controllerSelectionDebugToast';
    output.textContent = text;
    output.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:100000;max-width:min(92vw,620px);padding:7px 9px;border-radius:7px;background:rgba(0,0,0,.82);color:#fff;font:11px/1.35 monospace;pointer-events:none;';
    if (!existing) document.body?.appendChild(output);
    clearTimeout(showDebug._timer);
    showDebug._timer = setTimeout(() => output.remove(), 4500);
    return text;
  }

  window.addEventListener('blur', () => { if (state.activeAction) finishSelection(false, 'window blur'); });

  window.ControllerSelectionUI = {
    installed: true,
    get active() { return Boolean(state.activeAction); },
    cancel: () => finishSelection(false, 'external cancel'),
    getDebug: debugSnapshot,
    showDebug,
  };

  frameHandle = requestAnimationFrame(poll);
})();

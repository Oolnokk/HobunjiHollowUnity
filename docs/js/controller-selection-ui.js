// Controller-held selection UI adapter.
//
// Tool Select and Item Select distinguish a tap from a hold: tapping recalls
// the last-selected tool/item, while holding opens the selector. Utility Menu
// and Social Actions keep their existing held-selector behavior. Once a selector
// is open, either analog stick can navigate it and release commits.
(() => {
  'use strict';

  if (window.ControllerSelectionUI?.installed) return;

  const STICK_PRESS = 0.55;
  const WHEEL_DEADZONE = 0.28;
  const REPEAT_INITIAL_MS = 330;
  const REPEAT_RATE_MS = 135;
  const TAP_HOLD_THRESHOLD_MS = 350; // Used only by Tool Select / Item Select to match the pointer buttons' tap-vs-hold timing.
  const TAP_RECALL_ACTION_IDS = new Set(['toolSelect', 'itemSelect']); // Used to keep tap recall scoped to the two selectors requested by the player.
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
    pendingAction: null,
    pendingCode: null,
    pendingPadIndex: null,
    pendingStartedAt: 0,
    lastArchDirection: 0,
    nextRepeatAt: 0,
    preferredPadIndex: null,
    lastStickSource: 'none',
    lastInput: 'ready',
  }; // Exposed through getDebug() so controller selection can be diagnosed without browser devtools.

  let unsubscribe = null; // Handle for this module's slot in ControllerInput's shared frame loop.

  function currentControllerBindings() {
    return window.InputBindings?.getCurrentBindings?.()?.controller || null;
  }

  function bindingFor(actionId) {
    const bindings = currentControllerBindings(); // Used to honor live Settings changes immediately, including an explicit Unbound value.
    if (bindings && Object.prototype.hasOwnProperty.call(bindings, actionId)) return bindings[actionId];
    const action = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(entry => entry?.id === actionId); // Used only during the brief boot window before InputBindings has a live map.
    return action?.controller || null;
  }

  // The shared frame already evaluated every binding code once, so this is a
  // set lookup rather than a fresh analog read per action per frame.
  function isDown(frame, code) {
    return Boolean(code && frame.isDown(code, { stickThreshold: STICK_PRESS }));
  }

  // ControllerUI.isActive is now asked plainly. This module used to REPLACE it
  // with a wrapper that also returned true while a selector was held, so that
  // gameplay dispatch would stand down -- which meant every other consumer was
  // told a menu was open when none was. Gameplay now consults
  // ControllerInput.gameplaySuspended() instead, and this stays a plain read.
  function menuIsActive() {
    return Boolean(window.ControllerUI?.isActive?.());
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

  function recallTappedSelection(actionId) {
    const arch = sharedArch(); // Used to recall through the same selector state that pointer/desktop input already owns.
    if (!arch) return false;
    if (actionId === 'toolSelect') {
      if (typeof arch.recallLastTool !== 'function') return false;
      arch.recallLastTool();
      state.lastInput = 'toolSelect tap recalled last tool';
      return true;
    }
    if (actionId === 'itemSelect') {
      if (typeof arch.openItem !== 'function' || typeof arch.releaseSelection !== 'function') return false;
      arch.openItem();
      arch.releaseSelection(); // Opening selects the remembered active item; immediate release equips it without leaving the arch open.
      state.lastInput = 'itemSelect tap recalled last item';
      return true;
    }
    return false;
  }

  function clearPending(reason = 'cleared') {
    if (!state.pendingAction) return false;
    state.lastInput = `${state.pendingAction} pending ${reason}`;
    state.pendingAction = null;
    state.pendingCode = null;
    state.pendingPadIndex = null;
    state.pendingStartedAt = 0;
    return true;
  }

  function beginPendingTapHold(actionId, pad, openerCode, now) {
    if (!pad || !openerCode || !TAP_RECALL_ACTION_IDS.has(actionId)) return false;
    state.pendingAction = actionId;
    state.pendingCode = openerCode;
    state.pendingPadIndex = pad.index;
    state.pendingStartedAt = Number(now) || performance.now();
    state.lastInput = `${actionId} press pending tap/hold`;
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
    window.ControllerInput?.setOwner?.(`selection:${selector.kind}`); // Declares ownership centrally; the registry emits the owner-change event.
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
    window.ControllerInput?.setOwner?.(menuIsActive() ? 'menu' : 'gameplay'); // Hands the pad back to whichever consumer should own it next.
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

  function updateArch(frame, pad, now) {
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

  function firstPressedSelector(frame) {
    for (const actionId of SELECTOR_ACTION_IDS) {
      const code = bindingFor(actionId); // Used to pair the semantic action with its current physical opener without hardcoded bumper/D-pad knowledge.
      if (isDown(frame, code)) return { actionId, code };
    }
    return null;
  }

  function updatePendingTapHold(frame, pad) {
    if (!state.pendingAction) return false;
    if (state.pendingPadIndex !== null && pad.index !== state.pendingPadIndex) {
      clearPending('cancelled (controller changed)');
      return true;
    }
    if (menuIsActive() || musicOwnsController()) {
      clearPending(`cancelled (${menuIsActive() ? 'menu opened' : 'music opened'})`);
      return true;
    }
    if (!isDown(frame, state.pendingCode)) {
      const actionId = state.pendingAction; // Used after clearPending() so a release can still execute the intended recall action.
      clearPending('released as tap');
      recallTappedSelection(actionId);
      return true;
    }
    if (frame.now - state.pendingStartedAt >= TAP_HOLD_THRESHOLD_MS) {
      const actionId = state.pendingAction; // Used to transfer the exact pending action into the existing held-selector path.
      const openerCode = state.pendingCode; // Used to keep release paired with the physical binding that began this gesture.
      clearPending('promoted to hold');
      if (!beginSelection(actionId, pad, openerCode)) state.lastInput = `${actionId} hold failed to open`;
      return true;
    }
    return true;
  }

  // One slot in ControllerInput's shared loop instead of a private rAF. The
  // pad, its per-code analog values and the press/release edges were all
  // resolved once for this frame before we were called.
  function onControllerFrame(frame) {
    const pad = frame.pad;
    if (!pad) {
      if (state.activeAction) finishSelection(false, 'controller disconnected');
      if (state.pendingAction) clearPending('cancelled (controller disconnected)');
      return; // Nothing below can do anything without a pad.
    }

    if (state.activeAction) {
      // A held gesture stays pinned to the pad that started it.
      if (state.padIndex !== null && pad.index !== state.padIndex) {
        finishSelection(false, 'controller changed');
      } else if (menuIsActive() || musicOwnsController()) {
        finishSelection(false, menuIsActive() ? 'menu opened' : 'music opened');
      } else if (!isDown(frame, state.openerCode)) {
        finishSelection(true, 'opener released');
      } else if (state.kind === 'social') {
        updateSocial(pad);
      } else {
        updateArch(frame, pad, frame.now);
      }
      return;
    }

    if (state.pendingAction) {
      updatePendingTapHold(frame, pad);
      return;
    }

    if (!menuIsActive() && !musicOwnsController()) {
      state.preferredPadIndex = pad.index;
      const pressed = firstPressedSelector(frame); // Resolves semantic selector ownership from the player's current configured binding.
      if (pressed) {
        if (TAP_RECALL_ACTION_IDS.has(pressed.actionId)) beginPendingTapHold(pressed.actionId, pad, pressed.code, frame.now);
        else beginSelection(pressed.actionId, pad, pressed.code);
      }
    }
  }

  function debugSnapshot() {
    return {
      activeAction: state.activeAction,
      kind: state.kind,
      openerCode: state.openerCode,
      padIndex: state.padIndex,
      pendingAction: state.pendingAction,
      pendingCode: state.pendingCode,
      pendingPadIndex: state.pendingPadIndex,
      pendingAgeMs: state.pendingAction ? Math.max(0, Math.round((performance.now?.() || 0) - state.pendingStartedAt)) : 0,
      preferredPadIndex: state.preferredPadIndex,
      lastStickSource: state.lastStickSource,
      lastInput: state.lastInput,
      sharedFrameSubscribed: !!unsubscribe,
      menuActive: menuIsActive(),
      bindings: Object.fromEntries(SELECTOR_ACTION_IDS.map(actionId => [actionId, bindingFor(actionId)])),
    };
  }

  function showDebug() {
    const snapshot = debugSnapshot(); // Used to provide an in-page/mobile-friendly diagnostic without requiring the browser console.
    const selectorState = snapshot.activeAction || (snapshot.pendingAction ? `${snapshot.pendingAction}:pending` : 'idle'); // Used to expose tap-vs-hold state in the existing one-line debug toast.
    const text = `Controller selector: ${selectorState} | pad=${snapshot.padIndex ?? snapshot.pendingPadIndex ?? '-'} | stick=${snapshot.lastStickSource} | ${snapshot.lastInput}`;
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

  function cancelSelection(reason = 'external cancel') {
    if (state.pendingAction) return clearPending(reason);
    return finishSelection(false, reason);
  }

  window.addEventListener('blur', () => { cancelSelection('window blur'); });

  unsubscribe = window.ControllerInput?.subscribe?.(
    'controller-selection-ui', onControllerFrame, window.ControllerInput.PRIORITY.selection,
  ) || null;

  window.ControllerSelectionUI = {
    installed: true,
    get active() { return Boolean(state.activeAction || state.pendingAction); },
    cancel: () => cancelSelection('external cancel'),
    getDebug: debugSnapshot,
    showDebug,
  };
})();

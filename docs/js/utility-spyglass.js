// Utility-arch spyglass: action-arch presentation, toggle states and shared camera/input ownership.
// Its zoom belongs to HobunjiRangedCameraFocus; it does not run its own camera loop.
(() => {
  'use strict';

  const CAMERA_MODE = 'shoulderSurf'; // Existing free-look camera used while the spyglass is equipped.
  const CLAIM_OWNER = 'utility-spyglass'; // Reserves Action 1 without triggering weapons or nearby interactions.
  const CLAIM_PRIORITY = 1000; // Wins over ordinary world Action 1 interactions while equipped.
  const ACTION_DEBOUNCE_MS = 85; // Collapses the direct device observer and shared claim callback into one physical press.
  let cameraDeps = null; // Captured from Fishing.init and used only for the standard gameplay camera.
  let viewDeps = null; // Captured from ActionArcUI.init and used to restore Character View and detect held equipment.
  let savedCamera = null; // Original camera mode/target/view restored when the spyglass is put away.
  let savedActionAria = null; // Existing Action 1 accessibility label restored after spyglass use.
  let savedActionPressed = null; // Existing pressed-state attribute restored when the temporary arch prompt is removed.
  let savedActionDataAction = null; // Existing contextual action is restored when the spyglass leaves Action 1.
  let savedActionCombatSlot = null; // Existing combat-slot marker is restored after the spyglass overrides attack presentation.
  let savedActionCombatDualInput = false; // Restores the attack coin's dual-input styling after the spyglass takes over Action 1.
  let actionButtonStateCaptured = false; // Ensures a rebuilt Action 1 button is snapshotted before its spyglass override.
  let equipped = false; // True while selected from the Utility Arch.
  let aiming = false; // True while the spyglass lens is raised.
  let lookingCloser = false; // True after the second Action 1 press activates perception and extra magnification.
  let perceptionWasActive = null; // Preserves the player's perception state across the spyglass close-look mode.
  let lens = null; // Reused circular lens mask; contains no WebGL surfaces.
  let actionObserver = null; // Reapplies the normal action-arch prompt if the game rebuilds its buttons.
  let lastReason = 'not equipped'; // Mobile-readable diagnostic reason for the latest state transition.
  let lastAction1At = -Infinity; // Debounces the shared input claim against its direct keyboard/mouse/controller observer.
  let controllerActionDown = false; // Tracks the controller Action 1 edge without treating release as another action.

  function log(message) {
    window.__farmLog?.('[spyglass] ' + message, 'input');
  }

  function captureInit(api, marker, setter) {
    if (typeof api?.init !== 'function' || api.init[marker]) return;
    const original = api.init; // Existing owner is called unchanged after dependency capture.
    const wrapped = function spyglassCaptureInit(deps) {
      setter(deps || null);
      return original.call(this, deps);
    };
    Object.defineProperty(wrapped, marker, { value: true });
    api.init = wrapped;
  }

  function actionLabel() {
    if (!aiming) return 'Raise Spyglass';
    return lookingCloser ? 'Lower Spyglass' : 'Look Closer';
  }

  function syncActionButton() {
    const button = document.getElementById?.('btnAction1');
    const stack = document.getElementById?.('actionStack');
    stack?.classList?.toggle?.('spyglass-active', equipped);
    if (!button) return;
    button.classList?.toggle?.('spyglass-action-visible', equipped);
    let icon = button.querySelector?.('.spyglass-action-icon');
    let label = button.querySelector?.('.spyglass-action-label');
    if (!equipped) {
      icon?.remove?.();
      label?.remove?.();
      if (actionButtonStateCaptured) {
        if (savedActionAria == null) button.removeAttribute?.('aria-label');
        else button.setAttribute?.('aria-label', savedActionAria);
        if (savedActionPressed == null) button.removeAttribute?.('aria-pressed');
        else button.setAttribute?.('aria-pressed', savedActionPressed);
        if (savedActionDataAction == null) delete button.dataset.action;
        else button.dataset.action = savedActionDataAction;
        if (savedActionCombatSlot == null) delete button.dataset.combatSlot;
        else button.dataset.combatSlot = savedActionCombatSlot;
        button.classList?.toggle?.('combat-dual-input', savedActionCombatDualInput);
      }
      savedActionAria = null;
      savedActionPressed = null;
      savedActionDataAction = null;
      savedActionCombatSlot = null;
      savedActionCombatDualInput = false;
      actionButtonStateCaptured = false;
      return;
    }
    if (!actionButtonStateCaptured) {
      savedActionAria = button.getAttribute?.('aria-label');
      savedActionPressed = button.getAttribute?.('aria-pressed');
      savedActionDataAction = button.dataset?.action ?? null;
      savedActionCombatSlot = button.dataset?.combatSlot ?? null;
      savedActionCombatDualInput = button.classList?.contains?.('combat-dual-input') === true;
      actionButtonStateCaptured = true;
    }
    if (button.dataset?.action !== 'spyglass') {
      savedActionDataAction = button.dataset?.action ?? null; // Tracks a newer contextual action-bar state while the lens owns Action 1.
      button.dataset.action = 'spyglass';
    }
    if (button.dataset?.combatSlot) {
      savedActionCombatSlot = button.dataset.combatSlot; // Keeps a newly assigned combat slot intact when the spyglass is put away.
      delete button.dataset.combatSlot;
    }
    if (button.classList?.contains?.('combat-dual-input')) {
      savedActionCombatDualInput = true;
      button.classList.remove('combat-dual-input'); // Lets the shared arch-label system show the spyglass prompt instead of the attack coin face.
    }
    if (!icon) {
      icon = document.createElement('span');
      icon.className = 'abt-icon spyglass-action-icon';
      icon.textContent = '🔭';
      icon.setAttribute('aria-hidden', 'true');
      button.insertBefore?.(icon, button.firstChild || null);
    }
    if (!label) {
      label = document.createElement('span');
      label.className = 'abt-label spyglass-action-label';
      button.insertBefore?.(label, icon.nextSibling || null);
    }
    const nextLabel = actionLabel();
    if (label.textContent !== nextLabel) label.textContent = nextLabel;
    if (button.getAttribute?.('aria-label') !== nextLabel) button.setAttribute?.('aria-label', nextLabel);
    const pressed = aiming ? 'true' : 'false';
    if (button.getAttribute?.('aria-pressed') !== pressed) button.setAttribute?.('aria-pressed', pressed);
  }

  function buildLens() {
    if (lens || !document.body) return;
    lens = document.createElement('div');
    lens.id = 'spyglassLens';
    lens.setAttribute('aria-hidden', 'true');
    lens.innerHTML = '<div class="spyglass-aperture"><div class="spyglass-glass"></div></div>';
    document.body.appendChild(lens);
    syncHud();
  }

  function syncHud() {
    syncActionButton();
    lens?.classList?.toggle?.('aiming', aiming);
    lens?.classList?.toggle?.('looking-closer', lookingCloser);
  }

  function blockedByOtherActivity() {
    const focused = document.activeElement; // Prevents camera ownership while text-entry UI owns keyboard focus.
    return !!window.MusicMinigame?.state?.active || window.Fishing?.state?.phase === 'active'
      || document.getElementById?.('menuPanel')?.classList?.contains?.('open') === true
      || !!focused?.matches?.('input, textarea, select, [contenteditable="true"]');
  }

  function action1Binding(device) {
    const saved = window.InputBindings?.getCurrentBindings?.()?.[device]; // Honors live remapping and explicit unbinding.
    if (saved && Object.prototype.hasOwnProperty.call(saved, 'action1')) return saved.action1;
    return window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find?.(action => action.id === 'action1')?.[device]
      || (device === 'controller' ? 'RightTrigger' : 'Mouse0');
  }

  function pointerBindingMatches(event) {
    const binding = action1Binding('desktop');
    return (binding === 'Mouse0' && event.button === 0)
      || (binding === 'Mouse1' && event.button === 1)
      || (binding === 'Mouse2' && event.button === 2);
  }

  function ownsCamera() {
    return cameraDeps?.getCameraMode?.() === CAMERA_MODE;
  }

  function setLookingCloser(next) {
    next = !!next;
    if (next === lookingCloser) return lookingCloser;
    const perception = window.PerceptionMode;
    if (next) {
      perceptionWasActive = perception?.isActive?.() === true;
      perception?.setActive?.(true);
    } else {
      if (perceptionWasActive != null) perception?.setActive?.(perceptionWasActive);
      perceptionWasActive = null;
    }
    lookingCloser = next;
    syncHud();
    log(next ? 'close perception enabled' : 'close perception disabled');
    return lookingCloser;
  }

  function beginAim(reason = 'action 1') {
    if (!equipped || !ownsCamera() || blockedByOtherActivity()) return false;
    if (window.SharedSelectionArch?.entryMenuOpen?.() || window.SharedSelectionArch?.toolMenuOpen?.()) return false;
    if (aiming) return true;
    aiming = true;
    lastReason = reason;
    syncHud();
    log('lens raised');
    return true;
  }

  function endAim(reason = 'lowered') {
    if (lookingCloser) setLookingCloser(false);
    if (!aiming) return;
    aiming = false;
    lastReason = reason;
    syncHud();
    log('lens lowered');
  }

  function action1Press(reason = 'action 1') {
    if (!equipped || !ownsCamera() || blockedByOtherActivity()) return false;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    if (now - lastAction1At < ACTION_DEBOUNCE_MS) return true;
    lastAction1At = now;
    if (!aiming) beginAim(reason);
    else if (!lookingCloser) setLookingCloser(true);
    else endAim('action 1 lowered spyglass');
    return true;
  }

  function releaseInputClaim() {
    const claims = window.WorldActionInputClaims;
    const pressed = claims?.snapshot?.().pressed || []; // Never cancel another Action 1 owner's active press.
    if (pressed.some(entry => entry.ownerId === CLAIM_OWNER && entry.actionId === 'action1')) {
      claims.dispatch('action1', 'cancel');
    }
    claims?.clearClaims?.(CLAIM_OWNER);
  }

  function stow(reason = 'put away', options = {}) {
    if (!equipped) return false;
    endAim(reason);
    controllerActionDown = false;
    releaseInputClaim();
    equipped = false;
    lastReason = reason;
    const previous = savedCamera; // Never restore a camera already claimed by a cutscene or scene transition.
    savedCamera = null;
    if (options.restoreCamera !== false && previous && ownsCamera()) {
      viewDeps?.setCharacterViewMode?.(previous.characterView, 'spyglass-ended');
      if (previous.mode != null) cameraDeps?.setCameraMode?.(previous.mode);
      cameraDeps?.setCameraTarget?.(previous.target);
    }
    syncHud();
    log('stowed: ' + reason);
    return true;
  }

  function equip() {
    if (equipped) {
      stow('utility arch toggle');
      return false;
    }
    if (!cameraDeps?.setCameraMode || !cameraDeps?.getCameraMode || !window.WorldActionInputClaims?.setClaims) {
      lastReason = 'camera/input not ready';
      log('cannot equip: camera or input bridge unavailable');
      return false;
    }
    if (blockedByOtherActivity()) return false;
    buildLens();
    savedCamera = {
      mode: cameraDeps.getCameraMode(),
      target: cameraDeps.getCameraTarget?.() ?? null,
      characterView: !!viewDeps?.characterViewMode?.enabled,
    }; // Restores precisely the camera and Character View state the player had before selection.
    window.ActionArcUI?.stowForCarry?.(); // Clear held combat/tool state so the scope cannot fire or mine.
    viewDeps?.setCharacterViewMode?.(false, 'spyglass');
    cameraDeps.setCameraTarget?.(null);
    cameraDeps.setCameraMode(CAMERA_MODE);
    if (!ownsCamera()) {
      const previous = savedCamera; // Roll back a failed camera switch instead of stranding Character View or target state.
      savedCamera = null;
      viewDeps?.setCharacterViewMode?.(previous.characterView, 'spyglass-unavailable');
      if (previous.mode != null) cameraDeps.setCameraMode(previous.mode);
      cameraDeps.setCameraTarget?.(previous.target);
      savedActionAria = null;
      savedActionPressed = null;
      savedActionDataAction = null;
      savedActionCombatSlot = null;
      savedActionCombatDualInput = false;
      actionButtonStateCaptured = false;
      lastReason = 'shoulder camera unavailable';
      return false;
    }
    equipped = true;
    aiming = false;
    lookingCloser = false;
    perceptionWasActive = null;
    lastReason = 'equipped';
    window.WorldActionInputClaims.setClaims(CLAIM_OWNER, [{
      actionId: 'action1',
      priority: CLAIM_PRIORITY,
      label: 'Raise Spyglass / Look Closer',
      onPress: () => action1Press('claimed action 1'),
      onRelease: () => {}, // Toggle state is intentionally independent of physical button release.
    }]);
    syncHud();
    window.ShoulderCamPointerLock?.request?.();
    log('equipped; Action 1 raises, looks closer, then lowers');
    return true;
  }

  function update() {
    if (!equipped) return;
    if (blockedByOtherActivity() || !ownsCamera()) {
      stow('camera/activity changed');
      return;
    }
    const held = viewDeps?.getHeldMode?.(); // Newly selected tools/items take precedence over the utility spyglass.
    if (held === 'tool' || held === 'item') stow('other equipment selected');
  }

  function controllerActionCodes(binding) {
    const codes = new Set([binding]);
    if (binding === 'RightTrigger') codes.add('Button7');
    if (binding === 'LeftTrigger') codes.add('Button6');
    return codes;
  }

  function onControllerFrame(frame) {
    if (!equipped) return;
    if (frame?.focused === false) {
      stow('controller focus lost');
      return;
    }
    if (!frame?.pad) {
      controllerActionDown = false;
      return;
    }
    const binding = action1Binding('controller');
    const actionCodes = controllerActionCodes(binding);
    const pressed = frame.pressed && typeof frame.pressed[Symbol.iterator] === 'function' ? Array.from(frame.pressed) : Array.isArray(frame.pressed) ? frame.pressed : [];
    const otherButtonPressed = pressed.some(code => !actionCodes.has(code) && !/^RightStick(?:Left|Right|Up|Down)$/.test(String(code))); // Right-stick look remains available while the lens is raised.
    if (otherButtonPressed || Number(frame.move?.magnitude) > 0.12) {
      stow(Number(frame.move?.magnitude) > 0.12 ? 'controller movement' : 'other controller input');
      return;
    }
    const down = binding ? (typeof frame.isDown === 'function' ? frame.isDown(binding) : frame.down?.has(binding) || [...actionCodes].some(code => frame.down?.has?.(code))) : false;
    const pressedAction1 = pressed.some(code => actionCodes.has(code));
    if ((down && !controllerActionDown) || pressedAction1) action1Press('controller action 1');
    controllerActionDown = !!down;
  }

  function handleKeyboardInput(event) {
    if (!equipped || event.repeat) return;
    const binding = action1Binding('desktop');
    if (binding && binding === event.code && !event.ctrlKey && !event.altKey && !event.metaKey) {
      action1Press('keyboard action 1');
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return;
    }
    stow('other keyboard input: ' + (event.code || event.key || 'unknown'));
  }

  function handlePointerInput(event) {
    if (!equipped) return;
    const actionButton = event.target?.closest?.('#btnAction1');
    const canvas = document.getElementById?.('threeContainer');
    const sceneAction1 = event.pointerType !== 'touch' && canvas?.contains?.(event.target) && pointerBindingMatches(event);
    if (actionButton || sceneAction1) {
      action1Press(actionButton ? 'action arch action 1' : 'scene mouse action 1');
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return;
    }
    stow('other pointer input');
  }

  function install() {
    captureInit(window.Fishing, '__spyglassCameraCapture', value => { cameraDeps = value; });
    captureInit(window.ActionArcUI, '__spyglassViewCapture', value => { viewDeps = value; });
    window.ControllerInput?.subscribe?.('utility-spyglass', onControllerFrame, 45);
    for (const type of ['hobunji-scene-change', 'hobunji-area-change']) {
      window.addEventListener(type, () => stow(type, { restoreCamera: false }));
    }
    window.addEventListener('blur', () => stow('window blur'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stow('document hidden');
    });
    document.addEventListener('keydown', handleKeyboardInput, true);
    document.addEventListener('pointerdown', handlePointerInput, true);
    buildLens();
    const stack = document.getElementById?.('actionStack');
    if (stack && typeof MutationObserver === 'function') {
      actionObserver = new MutationObserver(() => { if (equipped) syncActionButton(); });
      actionObserver.observe(stack, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-action', 'data-combat-slot', 'class'] });
    }
  }

  window.Spyglass = Object.freeze({
    equip,
    stow,
    beginAim,
    endAim,
    action1Press,
    update,
    isEquipped: () => equipped,
    isAiming: () => equipped && aiming,
    isLookingCloser: () => equipped && aiming && lookingCloser,
    getDebug: () => ({
      equipped, aiming, lookingCloser, lastReason,
      cameraReady: !!cameraDeps,
      viewReady: !!viewDeps,
      currentCameraMode: cameraDeps?.getCameraMode?.() ?? null,
      savedCameraMode: savedCamera?.mode ?? null,
      ownsAction1: window.WorldActionInputClaims?.claimFor?.('action1')?.ownerId === CLAIM_OWNER,
      action1Label: equipped ? actionLabel() : null,
      controllerActionDown,
      desktopAction1: action1Binding('desktop'),
      controllerAction1: action1Binding('controller'),
      perceptionWasActive,
      zoom: window.HobunjiRangedCameraFocus?.snapshot?.().fovDeg ?? null,
    }),
  });

  install(); // Capture camera/view dependency injection before game.js initializes.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildLens, { once: true });
  else buildLens();
})();

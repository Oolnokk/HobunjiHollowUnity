// Utility-arch spyglass: Action 2 lens toggle, held Action 1 close-look and shared camera/input ownership.
// Its zoom belongs to HobunjiRangedCameraFocus; it does not run its own camera loop.
(() => {
  'use strict';

  const CAMERA_MODE = 'shoulderSurf'; // Existing free-look camera used while the spyglass is equipped.
  const CLAIM_OWNER = 'utility-spyglass'; // Reserves both spyglass actions without triggering weapons or nearby interactions.
  const CLAIM_PRIORITY = 1000; // Wins over ordinary world action interactions while equipped.
  const ACTION_DEBOUNCE_MS = 85; // Collapses overlapping Action 2 observers into one toggle per physical press.
  let cameraDeps = null; // Captured from Fishing.init and used only for the standard gameplay camera.
  let viewDeps = null; // Captured from ActionArcUI.init and used to restore Character View and detect held equipment.
  let savedCamera = null; // Original camera mode/target/view restored when the spyglass is put away.
  const buttonSnapshots = new Map(); // Restores both action-arch buttons and combat styling on stow.
  let equipped = false; // True while selected from the Utility Arch.
  let aiming = false; // True while the spyglass lens is raised.
  let lookingCloser = false; // True only while Action 1 is held with the lens raised.
  let action1Held = false; // Tracks the physical hold independently of whether the lens is currently raised.
  let perceptionWasActive = null; // Preserves the player's perception state across the spyglass close-look mode.
  let lens = null; // Reused circular lens mask; contains no WebGL surfaces.
  let actionObserver = null; // Reapplies the normal action-arch prompt if the game rebuilds its buttons.
  let lastReason = 'not equipped'; // Mobile-readable diagnostic reason for the latest state transition.
  let lastAction2At = -Infinity; // Debounces the Action 2 toggle against its second observer.
  let controllerAction1Down = false; // Tracks the held Action 1 edge and release on controllers.
  let controllerAction2Down = false; // Tracks the Action 2 toggle edge on controllers.
  const closePointers = new Set(); // Pairs touch/mouse Action 1 down with pointerup or pointercancel.

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

  function actionLabel(actionId) {
    return actionId === 'action2' ? (aiming ? 'Lower Spyglass' : 'Raise Spyglass') : 'Look Closer';
  }

  function syncActionButton(actionId) {
    const buttonId = actionId === 'action2' ? 'btnAction2' : 'btnAction1'; // Uses the game's actual Tool/Item Action slots.
    const button = document.getElementById?.(buttonId);
    if (!button) return;
    const visible = equipped && (actionId === 'action2' || aiming); // Look Closer is offered only while the lens is up.
    if (button.classList?.contains?.('spyglass-action-visible') !== visible)
      button.classList?.toggle?.('spyglass-action-visible', visible);
    const inactive = equipped && actionId === 'action1' && !aiming;
    if (button.classList?.contains?.('spyglass-action-inactive') !== inactive)
      button.classList?.toggle?.('spyglass-action-inactive', inactive);
    let icon = button.querySelector?.('.spyglass-action-icon');
    let label = button.querySelector?.('.spyglass-action-label');
    if (!equipped) {
      icon?.remove?.();
      label?.remove?.();
      const saved = buttonSnapshots.get(buttonId);
      if (saved?.button === button) {
        for (const [name, value] of [['aria-label', saved.aria], ['aria-pressed', saved.pressed]]) {
          if (value == null) button.removeAttribute?.(name);
          else button.setAttribute?.(name, value);
        }
        if (saved.action == null) delete button.dataset.action;
        else button.dataset.action = saved.action;
        if (saved.combatSlot == null) delete button.dataset.combatSlot;
        else button.dataset.combatSlot = saved.combatSlot;
        if (button.classList?.contains?.('combat-dual-input') !== saved.combatDualInput)
          button.classList?.toggle?.('combat-dual-input', saved.combatDualInput);
      }
      buttonSnapshots.delete(buttonId);
      return;
    }
    const previous = buttonSnapshots.get(buttonId);
    if (!previous || previous.button !== button) {
      buttonSnapshots.set(buttonId, {
        button, aria: button.getAttribute?.('aria-label'), pressed: button.getAttribute?.('aria-pressed'),
        action: button.dataset?.action ?? null, combatSlot: button.dataset?.combatSlot ?? null,
        combatDualInput: button.classList?.contains?.('combat-dual-input') === true,
      }); // A replacement action-bar node gets its own original state for restoration.
    }
    const saved = buttonSnapshots.get(buttonId);
    if (button.dataset?.action !== 'spyglass') {
      saved.action = button.dataset?.action ?? null; // Retain new contextual actions set by the ordinary action-bar owner.
      button.dataset.action = 'spyglass';
    }
    if (button.dataset?.combatSlot) {
      saved.combatSlot = button.dataset.combatSlot;
      delete button.dataset.combatSlot;
    }
    if (button.classList?.contains?.('combat-dual-input')) {
      saved.combatDualInput = true;
      button.classList.remove('combat-dual-input');
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
    const nextLabel = actionLabel(actionId);
    if (label.textContent !== nextLabel) label.textContent = nextLabel;
    if (button.getAttribute?.('aria-label') !== nextLabel) button.setAttribute?.('aria-label', nextLabel);
    const pressed = (actionId === 'action2' ? aiming : lookingCloser) ? 'true' : 'false';
    if (button.getAttribute?.('aria-pressed') !== pressed) button.setAttribute?.('aria-pressed', pressed);
  }

  function syncActionButtons() {
    const stack = document.getElementById?.('actionStack');
    if (stack?.classList?.contains?.('spyglass-active') !== equipped)
      stack?.classList?.toggle?.('spyglass-active', equipped);
    syncActionButton('action1');
    syncActionButton('action2');
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
    syncActionButtons();
    lens?.classList?.toggle?.('aiming', aiming);
    lens?.classList?.toggle?.('looking-closer', lookingCloser);
  }

  function blockedByOtherActivity() {
    const focused = document.activeElement; // Prevents camera ownership while text-entry UI owns keyboard focus.
    return !!window.MusicMinigame?.state?.active || window.Fishing?.state?.phase === 'active'
      || document.getElementById?.('menuPanel')?.classList?.contains?.('open') === true
      || !!focused?.matches?.('input, textarea, select, [contenteditable="true"]');
  }

  function actionBinding(actionId, device) {
    const saved = window.InputBindings?.getCurrentBindings?.()?.[device]; // Honors remapping, including explicit null bindings.
    if (saved && Object.prototype.hasOwnProperty.call(saved, actionId)) return saved[actionId];
    return window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find?.(action => action.id === actionId)?.[device]
      || (device === 'controller' ? (actionId === 'action2' ? 'LeftTrigger' : 'RightTrigger')
        : (actionId === 'action2' ? 'Mouse2' : 'Mouse0'));
  }

  function pointerBindingMatches(event, actionId) {
    const binding = actionBinding(actionId, 'desktop');
    return (binding === 'Mouse0' && event.button === 0)
      || (binding === 'Mouse1' && event.button === 1)
      || (binding === 'Mouse2' && event.button === 2);
  }

  function ownsCamera() {
    return cameraDeps?.getCameraMode?.() === CAMERA_MODE;
  }

  function setLookingCloser(next) {
    next = !!next && equipped && aiming; // Never enable the held zoom if the lens is lowered.
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

  function beginAim(reason = 'action 2') {
    if (!equipped || !ownsCamera() || blockedByOtherActivity()) return false;
    if (window.SharedSelectionArch?.entryMenuOpen?.() || window.SharedSelectionArch?.toolMenuOpen?.()) return false;
    if (aiming) return true;
    aiming = true;
    lastReason = reason;
    if (action1Held) setLookingCloser(true); // Raising the lens while Action 1 is already held immediately enables close-look.
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

  function action1Press(reason = 'held action 1') {
    if (!equipped || !ownsCamera() || blockedByOtherActivity()) return false;
    action1Held = true; // A press before raising still counts as a live hold when Action 2 later toggles the lens.
    if (aiming) {
      lastReason = reason;
      setLookingCloser(true);
    }
    return true; // Consume Action 1 even when the lens is lowered; never fire an equipped weapon.
  }

  function action1Release(reason = 'action 1 released') {
    action1Held = false;
    if (lookingCloser) {
      lastReason = reason;
      setLookingCloser(false); // Release restores the base spyglass FOV without lowering the lens.
    }
    return equipped;
  }

  function action2Press(reason = 'action 2 toggle') {
    if (!equipped || !ownsCamera() || blockedByOtherActivity()) return false;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    if (now - lastAction2At < ACTION_DEBOUNCE_MS) return true;
    lastAction2At = now;
    if (aiming) endAim(reason);
    else beginAim(reason);
    return true;
  }

  function releaseInputClaim() {
    const claims = window.WorldActionInputClaims;
    for (const entry of claims?.snapshot?.().pressed || []) {
      if (entry.ownerId === CLAIM_OWNER && (entry.actionId === 'action1' || entry.actionId === 'action2'))
        claims.dispatch?.(entry.actionId, 'cancel'); // Pair both physical releases before removing either claim.
    }
    claims?.clearClaims?.(CLAIM_OWNER);
  }

  function stow(reason = 'put away', options = {}) {
    if (!equipped) return false;
    endAim(reason);
    action1Held = false;
    controllerAction1Down = false;
    controllerAction2Down = false;
    closePointers.clear();
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
    installActionObserver(); // Recovery for late or initially missing action-arch markup.
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
      buttonSnapshots.clear();
      lastReason = 'shoulder camera unavailable';
      return false;
    }
    equipped = true;
    lastAction2At = -Infinity;
    controllerAction1Down = false;
    controllerAction2Down = false;
    closePointers.clear();
    aiming = false;
    lookingCloser = false;
    action1Held = false;
    perceptionWasActive = null;
    lastReason = 'equipped';
    window.WorldActionInputClaims.setClaims(CLAIM_OWNER, [{
      actionId: 'action1',
      priority: CLAIM_PRIORITY,
      label: 'Look Closer (hold)',
      onPress: () => action1Press('claimed action 1'),
      onRelease: () => action1Release('claimed action 1 released'),
    }, {
      actionId: 'action2',
      priority: CLAIM_PRIORITY,
      label: 'Raise / Lower Spyglass',
      onPress: () => action2Press('claimed action 2'),
      onRelease: () => {}, // Action 2 only toggles on press, never on physical release.
    }]);
    syncHud();
    window.ShoulderCamPointerLock?.request?.();
    log('equipped; Action 2 toggles lens, Action 1 holds closer zoom');
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
      action1Release('controller disconnected');
      controllerAction1Down = false;
      controllerAction2Down = false;
      return;
    }
    const binding1 = actionBinding('action1', 'controller');
    const binding2 = actionBinding('action2', 'controller');
    const codes1 = binding1 ? controllerActionCodes(binding1) : new Set();
    const codes2 = binding2 ? controllerActionCodes(binding2) : new Set();
    const allowed = new Set([...codes1, ...codes2]); // Neither spyglass control should count as an interruption.
    const pressed = frame.pressed && typeof frame.pressed[Symbol.iterator] === 'function' ? Array.from(frame.pressed) : [];
    const otherButtonPressed = pressed.some(code => !allowed.has(code) && !/^RightStick(?:Left|Right|Up|Down)$/.test(String(code)));
    if (otherButtonPressed || Number(frame.move?.magnitude) > 0.12) {
      stow(Number(frame.move?.magnitude) > 0.12 ? 'controller movement' : 'other controller input');
      return;
    }
    const downFor = (binding, codes) => !!binding &&
      ((typeof frame.isDown === 'function' && frame.isDown(binding)) || [...codes].some(code => frame.down?.has?.(code)));
    const down1 = downFor(binding1, codes1);
    const down2 = downFor(binding2, codes2);
    if ((down2 || pressed.some(code => codes2.has(code))) && !controllerAction2Down)
      action2Press('controller action 2');
    if ((down1 || pressed.some(code => codes1.has(code))) && !controllerAction1Down)
      action1Press('controller action 1');
    if (!down1 && controllerAction1Down) action1Release('controller action 1 released');
    controllerAction1Down = down1;
    controllerAction2Down = down2;
  }

  function handleKeyboardInput(event) {
    if (!equipped || event.repeat) return;
    const action1 = actionBinding('action1', 'desktop');
    const action2 = actionBinding('action2', 'desktop');
    if (!event.ctrlKey && !event.altKey && !event.metaKey && event.code === action2 && action2) {
      action2Press('keyboard action 2');
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && event.code === action1 && action1) {
      action1Press('keyboard action 1');
    } else {
      stow('other keyboard input: ' + (event.code || event.key || 'unknown'));
      return;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function handleKeyboardRelease(event) {
    if (!equipped) return;
    if (event.code === actionBinding('action1', 'desktop')) {
      action1Release('keyboard action 1 released');
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    }
  }

  function handlePointerInput(event) {
    if (!equipped) return;
    const action1Button = event.target?.closest?.('#btnAction1');
    const action2Button = event.target?.closest?.('#btnAction2');
    const canvas = document.getElementById?.('threeContainer');
    const scene = event.pointerType !== 'touch' && canvas?.contains?.(event.target);
    const actionId = action2Button || (scene && pointerBindingMatches(event, 'action2')) ? 'action2'
      : action1Button || (scene && pointerBindingMatches(event, 'action1')) ? 'action1' : null;
    if (!actionId) {
      stow('other pointer input');
      return;
    }
    if (actionId === 'action2') action2Press('pointer action 2');
    else {
      closePointers.add(event.pointerId);
      action1Press('pointer action 1');
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function handlePointerRelease(event) {
    if (!closePointers.delete(event.pointerId)) return;
    action1Release(event.type === 'pointercancel' ? 'pointer canceled' : 'pointer action 1 released');
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function handleContextMenu(event) {
    if (!equipped || actionBinding('action2', 'desktop') !== 'Mouse2') return;
    const canvas = document.getElementById?.('threeContainer');
    if (canvas?.contains?.(event.target) || event.target?.closest?.('#btnAction2'))
      event.preventDefault?.(); // The default right-click binding must not open a browser menu.
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
    document.addEventListener('keyup', handleKeyboardRelease, true);
    document.addEventListener('pointerdown', handlePointerInput, true);
    document.addEventListener('pointerup', handlePointerRelease, true);
    document.addEventListener('pointercancel', handlePointerRelease, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    buildLens();
    installActionObserver(); // Installs immediately only when the action arch already exists.
  }

  function installActionObserver() {
    if (actionObserver || typeof MutationObserver !== 'function') return;
    const stack = document.getElementById?.('actionStack');
    if (!stack) return; // The module loads in <head>; DOMContentLoaded attaches the observer once buttons exist.
    actionObserver = new MutationObserver(() => { if (equipped) syncActionButtons(); });
    actionObserver.observe(stack, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-action', 'data-combat-slot', 'class'] });
  }

  window.Spyglass = Object.freeze({
    equip,
    stow,
    beginAim,
    endAim,
    action1Press,
    action1Release,
    action2Press,
    update,
    isEquipped: () => equipped,
    isAiming: () => equipped && aiming,
    isLookingCloser: () => equipped && aiming && lookingCloser,
    getDebug: () => ({
      equipped, aiming, lookingCloser, action1Held, lastReason,
      actionObserverActive: !!actionObserver,
      cameraReady: !!cameraDeps,
      viewReady: !!viewDeps,
      currentCameraMode: cameraDeps?.getCameraMode?.() ?? null,
      savedCameraMode: savedCamera?.mode ?? null,
      ownsAction1: window.WorldActionInputClaims?.claimFor?.('action1')?.ownerId === CLAIM_OWNER,
      ownsAction2: window.WorldActionInputClaims?.claimFor?.('action2')?.ownerId === CLAIM_OWNER,
      action1Label: equipped ? actionLabel('action1') : null,
      action2Label: equipped ? actionLabel('action2') : null,
      controllerAction1Down,
      controllerAction2Down,
      closePointerCount: closePointers.size,
      desktopAction1: actionBinding('action1', 'desktop'),
      desktopAction2: actionBinding('action2', 'desktop'),
      controllerAction1: actionBinding('action1', 'controller'),
      controllerAction2: actionBinding('action2', 'controller'),
      perceptionWasActive,
      zoom: window.HobunjiRangedCameraFocus?.snapshot?.().fovDeg ?? null,
    }),
  });

  install(); // Capture camera/view dependency injection before game.js initializes.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { buildLens(); installActionObserver(); }, { once: true });
  } else {
    buildLens();
    installActionObserver();
  }
})();

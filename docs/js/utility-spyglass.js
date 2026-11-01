// Utility-arch spyglass: equipment selection, optical lens and input ownership.
// Its zoom belongs to HobunjiRangedCameraFocus; it does not run its own camera loop.
(() => {
  'use strict';

  const CAMERA_MODE = 'shoulderSurf'; // Used to put the player in the existing free-look camera while the spyglass is out.
  const CLAIM_OWNER = 'utility-spyglass'; // Used to reserve Action 1 without triggering tools, weapons or nearby interactions.
  const CLAIM_PRIORITY = 1000; // Used to win over ordinary world Action 1 interactions while equipped.
  let cameraDeps = null; // Captured from Fishing.init and used only for the standard gameplay camera.
  let viewDeps = null; // Captured from ActionArcUI.init and used to restore the previous Character View mode.
  let savedCamera = null; // Original camera mode/target/view restored when the spyglass is put away.
  let equipped = false; // Set by the Utilities arch selection; used by input claims and the status HUD.
  let aiming = false; // True only while Action 1 or the touchscreen Look button is held.
  let hud = null; // Reused equipment controls; created once after the page body is available.
  let lens = null; // Reused full-screen circular lens mask; contains no WebGL surfaces.
  let lookButton = null; // Touchscreen hold target, kept separate from the scene pointer input.
  let lastReason = 'not equipped'; // Displayed in the mobile-readable diagnostic snapshot.
  let pointerAimId = null; // Tracks the scene mouse pointer that raised the lens even when the action arch is hidden.
  let keyAimCode = null; // Tracks a keyboard-mapped Action 1 held outside the rendered action buttons.
  let controllerAimDown = false; // Remembers the controller Action 1 edge so release works even with a hidden action arch.

  function log(message) {
    window.__farmLog?.('[spyglass] ' + message, 'input');
  }

  function captureInit(api, marker, setter) {
    if (typeof api?.init !== 'function' || api.init[marker]) return;
    const original = api.init; // Existing owner is called unchanged after our injected dependency capture.
    const wrapped = function spyglassCaptureInit(deps) {
      setter(deps || null);
      return original.call(this, deps);
    };
    Object.defineProperty(wrapped, marker, { value: true });
    api.init = wrapped;
  }

  function buildHud() {
    if (hud || !document.body) return;
    lens = document.createElement('div');
    lens.id = 'spyglassLens';
    lens.setAttribute('aria-hidden', 'true');
    lens.innerHTML = '<div class="spyglass-aperture"><div class="spyglass-glass"></div></div>';
    document.body.appendChild(lens);

    hud = document.createElement('div');
    hud.id = 'spyglassHud';
    hud.setAttribute('role', 'group');
    hud.setAttribute('aria-label', 'Spyglass controls');

    const hint = document.createElement('span'); // Displayed while the spyglass is selected but not looking.
    hint.id = 'spyglassHint';
    hint.textContent = '🔭 Spyglass · Hold Action 1 to look';
    hud.appendChild(hint);

    lookButton = document.createElement('button');
    lookButton.type = 'button';
    lookButton.id = 'spyglassLook';
    lookButton.textContent = 'Hold to Look';
    lookButton.setAttribute('aria-label', 'Hold to look through spyglass');
    lookButton.addEventListener('pointerdown', event => {
      if (!equipped) return;
      try { lookButton.setPointerCapture(event.pointerId); } catch (_) {}
      beginAim('touch look');
      event.stopPropagation();
      event.preventDefault();
    });
    const releaseLook = event => {
      endAim('look released');
      event.stopPropagation();
      event.preventDefault();
    };
    lookButton.addEventListener('pointerup', releaseLook);
    lookButton.addEventListener('pointercancel', releaseLook);
    lookButton.addEventListener('lostpointercapture', () => endAim('look lost capture'));
    hud.appendChild(lookButton);

    const close = document.createElement('button'); // Explicit touch/keyboard stow action, even when the rest of the HUD is obscured.
    close.type = 'button';
    close.id = 'spyglassStow';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Put away spyglass');
    close.addEventListener('click', event => {
      event.stopPropagation();
      stow('stow button');
    });
    hud.appendChild(close);
    document.body.appendChild(hud);
    syncHud();
  }

  function syncHud() {
    if (!hud) return;
    hud.classList.toggle('equipped', equipped);
    hud.classList.toggle('aiming', aiming);
    lens?.classList.toggle('aiming', aiming);
  }

  function blockedByOtherActivity() {
    const focused = document.activeElement; // Avoids a full DOM focus selector every gameplay frame while the spyglass is equipped.
    return !!window.MusicMinigame?.state?.active || window.Fishing?.state?.phase === 'active'
      || document.getElementById?.('menuPanel')?.classList?.contains?.('open') === true
      || !!focused?.matches?.('input, textarea, select, [contenteditable="true"]');
  }

  function action1Binding(device) {
    const saved = window.InputBindings?.getCurrentBindings?.()?.[device]; // Honors remapping and explicit unbinding on keyboard/controller.
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

  function handleScenePointerDown(event) {
    const canvas = document.getElementById?.('threeContainer'); // Shares the existing Shoulder Cam mouse-look surface rather than a second input plane.
    if (!equipped || event.pointerType === 'touch' || !canvas?.contains?.(event.target) || !pointerBindingMatches(event)) return;
    pointerAimId = event.pointerId;
    beginAim('scene mouse action 1');
  }

  function releaseScenePointer(event) {
    if (pointerAimId == null || pointerAimId !== event.pointerId) return;
    pointerAimId = null;
    endAim('scene mouse released');
  }

  function ownsCamera() {
    return cameraDeps?.getCameraMode?.() === CAMERA_MODE;
  }

  function beginAim(reason = 'action 1 pressed') {
    if (!equipped || !ownsCamera() || blockedByOtherActivity()) return false;
    if (window.SharedSelectionArch?.entryMenuOpen?.() || window.SharedSelectionArch?.toolMenuOpen?.()) return false;
    if (aiming) return true;
    aiming = true;
    lastReason = reason;
    syncHud();
    log('lens raised');
    return true;
  }

  function endAim(reason = 'action 1 released') {
    if (!aiming) return;
    aiming = false;
    lastReason = reason;
    syncHud();
    log('lens lowered');
  }

  function releaseInputClaim() {
    const claims = window.WorldActionInputClaims;
    const pressed = claims?.snapshot?.().pressed || []; // Avoid cancelling a different Action 1 owner when stowing between interactions.
    if (pressed.some(entry => entry.ownerId === CLAIM_OWNER && entry.actionId === 'action1')) {
      claims.dispatch('action1', 'cancel');
    }
    claims?.clearClaims?.(CLAIM_OWNER);
  }

  function stow(reason = 'put away', options = {}) {
    if (!equipped) return false;
    endAim(reason);
    pointerAimId = null;
    keyAimCode = null;
    controllerAimDown = false;
    releaseInputClaim();
    equipped = false;
    lastReason = reason;
    const previous = savedCamera; // Saved when equipped; never try to restore a camera already claimed by a cutscene.
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
    buildHud();
    savedCamera = {
      mode: cameraDeps.getCameraMode(),
      target: cameraDeps.getCameraTarget?.() ?? null,
      characterView: !!viewDeps?.characterViewMode?.enabled,
    }; // Used to restore precisely the view the player had before choosing the spyglass.
    window.ActionArcUI?.stowForCarry?.(); // Clear held combat/tool state so the scope cannot shoot or mine.
    viewDeps?.setCharacterViewMode?.(false, 'spyglass');
    cameraDeps.setCameraTarget?.(null);
    cameraDeps.setCameraMode(CAMERA_MODE);
    if (!ownsCamera()) {
      const previous = savedCamera; // Roll back the attempted mode switch instead of leaving Character View or the camera target modified.
      savedCamera = null;
      viewDeps?.setCharacterViewMode?.(previous.characterView, 'spyglass-unavailable');
      if (previous.mode != null) cameraDeps.setCameraMode(previous.mode);
      cameraDeps.setCameraTarget?.(previous.target);
      lastReason = 'shoulder camera unavailable';
      return false;
    }
    equipped = true;
    aiming = false;
    lastReason = 'equipped';
    window.WorldActionInputClaims.setClaims(CLAIM_OWNER, [{
      actionId: 'action1',
      priority: CLAIM_PRIORITY,
      label: 'Look Through Spyglass',
      onPress: () => beginAim(),
      onRelease: () => endAim(),
    }]);
    syncHud();
    window.ShoulderCamPointerLock?.request?.();
    log('equipped; hold Action 1 to zoom');
    return true;
  }

  function update() {
    if (!equipped) return;
    if (blockedByOtherActivity() || !ownsCamera()) {
      stow('camera/activity changed');
      return;
    }
    const held = viewDeps?.getHeldMode?.(); // A new held weapon/tool/item takes precedence over the utility spyglass.
    if (held === 'tool' || held === 'item') stow('other equipment selected');
  }

  function onControllerFrame(frame) {
    if (!equipped) return;
    if (!frame?.pad || !frame.focused) {
      if (controllerAimDown) endAim('controller disconnected or unfocused');
      controllerAimDown = false;
      return;
    }
    const menuCode = window.InputBindings?.getCurrentBindings?.()?.controller?.uiOpenMenu || 'Button8';
    if (frame.pressed?.has(menuCode) || frame.pressed?.has('Button1')) {
      stow('controller menu/cancel');
      return;
    }
    const binding = action1Binding('controller'); // Uses the actual configured controller Action 1, including remaps.
    const down = binding ? (typeof frame.isDown === 'function' ? frame.isDown(binding) : frame.down?.has(binding)) : false;
    if (down && !controllerAimDown) beginAim('controller action 1');
    else if (!down && controllerAimDown) endAim('controller action 1 released');
    controllerAimDown = !!down;
    // Shared WorldActionInputClaims still owns gameplay dispatch. This edge observer only guarantees the lens works
    // when the regular action arch is hidden because no weapon/tool is equipped.
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
    document.addEventListener('keydown', event => {
      if (!equipped || event.repeat) return;
      if (event.code === 'Escape') { stow('escape'); return; }
      const binding = action1Binding('desktop'); // Direct keyboard fallback for an unrendered equipment action slot.
      if (binding === event.code && !event.ctrlKey && !event.altKey && !event.metaKey) {
        keyAimCode = event.code;
        beginAim('keyboard action 1');
      }
    }, true);
    document.addEventListener('keyup', event => {
      if (keyAimCode !== event.code) return;
      keyAimCode = null;
      endAim('keyboard action 1 released');
    }, true);
    document.addEventListener('pointerdown', handleScenePointerDown, true);
    window.addEventListener('pointerup', releaseScenePointer, true);
    window.addEventListener('pointercancel', releaseScenePointer, true);
    document.addEventListener('pointerdown', event => {
      if (!equipped || event.target.closest('#spyglassHud')) return;
      if (event.target.closest('button, input, select, textarea, [data-ctrl-panel]')) endAim('other UI');
    }, true);
    buildHud();
  }

  window.Spyglass = Object.freeze({
    equip,
    stow,
    beginAim,
    endAim,
    update,
    isEquipped: () => equipped,
    isAiming: () => equipped && aiming,
    getDebug: () => ({
      equipped, aiming, lastReason,
      cameraReady: !!cameraDeps,
      viewReady: !!viewDeps,
      currentCameraMode: cameraDeps?.getCameraMode?.() ?? null,
      savedCameraMode: savedCamera?.mode ?? null,
      ownsAction1: window.WorldActionInputClaims?.claimFor?.('action1')?.ownerId === CLAIM_OWNER,
      pointerAimId, keyAimCode, controllerAimDown,
      desktopAction1: action1Binding('desktop'),
      controllerAction1: action1Binding('controller'),
      zoom: window.HobunjiRangedCameraFocus?.snapshot?.().fovDeg ?? null,
    }),
  });

  install(); // Capture Fishing/ActionArcUI.init before game.js runs, not at DOMContentLoaded.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildHud, { once: true });
  else buildHud();
})();

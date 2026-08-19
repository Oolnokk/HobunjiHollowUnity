// Input-binding runtime: makes mouse buttons first-class bindings and gives
// Attack Button 1/2 + Menu real runtime behavior without duplicating game.js's
// private action implementations.
(() => {
  'use strict';
  if (window.InputBindingRuntime) return;

  const MOUSE_CODES = Object.freeze({ 0: 'MouseLeft', 2: 'MouseRight' }); // Physical mouse buttons eligible for gameplay rebinding.
  const ATTACK_LOGICAL_ACTION = Object.freeze({ attack1: 'action1', attack2: 'action2' }); // Attack bindings reuse the established tap/hold action pipelines.
  const syntheticKeys = new WeakSet(); // Marks virtual key events so this capture layer does not recursively remap them.
  const mousePresses = new Map(); // button -> action captured on pointerdown, ensuring release matches the original press.
  const keyboardPresses = new Map(); // physical code -> attack action captured on keydown, ensuring release still fires after a live rebind.
  const controllerState = new Map(); // attack/menu action -> prior pressed state for rising/falling edge detection.
  let virtualSerial = 0; // Used to make every temporary logical-dispatch code collision-proof.

  function context() {
    return window.__hobunjiInputBindingContext || null;
  }

  function bindingMap(device) {
    return context()?.inputBindings?.[device] || null;
  }

  function actionFor(device, code) {
    if (!code) return null;
    const bindings = bindingMap(device);
    if (!bindings) return null;
    for (const [actionId, button] of Object.entries(bindings)) {
      if (button === code) return actionId;
    }
    return null;
  }

  function bindingFor(device, actionId) {
    return bindingMap(device)?.[actionId] ?? null;
  }

  function labelForCode(code) {
    if (code === 'MouseLeft') return 'Left Click';
    if (code === 'MouseRight') return 'Right Click';
    const formatter = context()?.buttonLabel;
    return typeof formatter === 'function' ? formatter(code) : String(code || 'Unbound');
  }

  function bindingCaptureOpen() {
    return !!document.querySelector('.input-bind-capture.is-listening, .input-bind-btn.is-listening');
  }

  function gameplayMouseTarget(target) {
    const three = document.getElementById('threeContainer');
    return !!three && (target === three || three.contains(target));
  }

  // game.js already has one authoritative action router, but it is private to
  // its closure. Temporarily point one logical action at a unique virtual key,
  // dispatch the normal key event synchronously, then restore the real binding.
  // This preserves the exact existing tap-vs-hold behavior for melee, ranged,
  // tools, interaction actions, and future action implementations.
  function dispatchLogicalDesktopAction(actionId, phase = 'press') {
    const bindings = bindingMap('desktop');
    if (!bindings || !actionId) return false;
    const hadOwn = Object.prototype.hasOwnProperty.call(bindings, actionId);
    const previous = bindings[actionId];
    const code = `HobunjiVirtual${++virtualSerial}_${actionId}`; // Unique transient code visible only during synchronous dispatch.
    bindings[actionId] = code;
    try {
      const type = phase === 'release' ? 'keyup' : 'keydown';
      const event = new KeyboardEvent(type, {
        code,
        key: code,
        bubbles: true,
        cancelable: true,
        repeat: false,
      });
      syntheticKeys.add(event);
      window.dispatchEvent(event);
      return true;
    } finally {
      if (hadOwn) bindings[actionId] = previous;
      else delete bindings[actionId];
    }
  }

  function toggleMenu() {
    const button = document.getElementById('menuBtn');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function runMappedAction(actionId, phase = 'press') {
    if (!actionId) return false;
    const logicalAttack = ATTACK_LOGICAL_ACTION[actionId];
    if (logicalAttack) return dispatchLogicalDesktopAction(logicalAttack, phase);
    if (actionId === 'menu') return phase === 'press' ? toggleMenu() : true;
    return dispatchLogicalDesktopAction(actionId, phase);
  }

  // Mouse input is intercepted before game.js's old threeContainer bubble
  // listener. Campfire gets first refusal here because this early binding
  // runtime itself loads before campfire-system.js: while a portable placement
  // is armed, re-dispatch the click as touch-style pointer input so the later
  // CampfireSystem capture listener owns it instead of Attack Button 1/2. When
  // Interact itself is mouse-bound, sleeping at a nearby campfire goes straight
  // through the same keybind mapping rather than hardcoding a mouse button.
  window.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || bindingCaptureOpen()) return;
    const code = MOUSE_CODES[event.button];
    if (!code || !gameplayMouseTarget(event.target)) return;
    const campfire = window.CampfireSystem;
    if (campfire?.armed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        event.target.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
          clientX: event.clientX,
          clientY: event.clientY,
          button: 0,
          buttons: 1,
        }));
      } catch (_) {}
      return;
    }
    const actionId = actionFor('desktop', code);
    if (actionId === 'interact' && campfire?.nearCampfire?.()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      campfire.beginSleep?.();
      return;
    }
    mousePresses.set(event.button, { actionId, code });
    event.preventDefault();
    event.stopImmediatePropagation();
    if (actionId) runMappedAction(actionId, 'press');
  }, true);

  window.addEventListener('pointerup', event => {
    if (event.pointerType !== 'mouse') return;
    const press = mousePresses.get(event.button);
    if (!press) return;
    mousePresses.delete(event.button);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (press.actionId) runMappedAction(press.actionId, 'release');
  }, true);

  window.addEventListener('pointercancel', event => {
    if (event.pointerType !== 'mouse') return;
    const press = mousePresses.get(event.button);
    if (!press) return;
    mousePresses.delete(event.button);
    if (press.actionId) runMappedAction(press.actionId, 'release');
  }, true);

  window.addEventListener('contextmenu', event => {
    if (gameplayMouseTarget(event.target)) event.preventDefault();
  }, true);

  // Keyboard bindings already flow through game.js. Only the new actions need
  // interception here: attacks are bridged to logical Action 1/2, while Menu
  // toggles the existing menu button. Any keyboard key may be assigned.
  window.addEventListener('keydown', event => {
    if (syntheticKeys.has(event) || bindingCaptureOpen()) return;
    const actionId = actionFor('desktop', event.code);
    if (!ATTACK_LOGICAL_ACTION[actionId] && actionId !== 'menu') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (ATTACK_LOGICAL_ACTION[actionId]) keyboardPresses.set(event.code, actionId);
    runMappedAction(actionId, 'press');
  }, true);

  window.addEventListener('keyup', event => {
    if (syntheticKeys.has(event)) return;
    const pressedAction = keyboardPresses.get(event.code);
    const currentAction = actionFor('desktop', event.code);
    const actionId = pressedAction || currentAction;
    if (!ATTACK_LOGICAL_ACTION[actionId] && actionId !== 'menu') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    keyboardPresses.delete(event.code);
    if (ATTACK_LOGICAL_ACTION[actionId]) runMappedAction(actionId, 'release');
  }, true);

  function controllerCodeDown(pad, code) {
    if (!pad || !code) return false;
    const threshold = Number(context()?.inputDefaults?.axisPressThreshold) || 0.55;
    if (code === 'LeftTrigger') return !!pad.buttons?.[6]?.pressed || Number(pad.buttons?.[6]?.value || 0) >= threshold;
    if (code === 'RightTrigger') return !!pad.buttons?.[7]?.pressed || Number(pad.buttons?.[7]?.value || 0) >= threshold;
    const match = /^Button(\d+)$/.exec(code);
    if (match) {
      const button = pad.buttons?.[Number(match[1])];
      return !!button?.pressed || Number(button?.value || 0) >= threshold;
    }
    const x = Number(pad.axes?.[2] || 0);
    const y = Number(pad.axes?.[3] || 0);
    if (code === 'RightStickLeft') return x <= -threshold;
    if (code === 'RightStickRight') return x >= threshold;
    if (code === 'RightStickUp') return y <= -threshold;
    if (code === 'RightStickDown') return y >= threshold;
    return false;
  }

  function firstConnectedPad() {
    try { return Array.from(navigator.getGamepads?.() || []).find(Boolean) || null; }
    catch { return null; }
  }

  function pollControllerExtensions() {
    const pad = firstConnectedPad();
    for (const actionId of ['attack1', 'attack2', 'menu']) {
      const code = bindingFor('controller', actionId);
      const down = !!code && controllerCodeDown(pad, code);
      const wasDown = controllerState.get(actionId) === true;
      if (down && !wasDown) runMappedAction(actionId, 'press');
      else if (!down && wasDown && ATTACK_LOGICAL_ACTION[actionId]) runMappedAction(actionId, 'release');
      controllerState.set(actionId, down);
    }
    requestAnimationFrame(pollControllerExtensions);
  }
  requestAnimationFrame(pollControllerExtensions);

  window.addEventListener('blur', () => {
    for (const actionId of keyboardPresses.values()) runMappedAction(actionId, 'release');
    keyboardPresses.clear();
    for (const press of mousePresses.values()) if (press.actionId) runMappedAction(press.actionId, 'release');
    mousePresses.clear();
    for (const [actionId, down] of controllerState) if (down && ATTACK_LOGICAL_ACTION[actionId]) runMappedAction(actionId, 'release');
    controllerState.clear();
  });

  window.InputBindingRuntime = Object.freeze({
    actionFor,
    bindingFor,
    labelForCode,
    dispatchLogicalDesktopAction,
    runMappedAction,
  });
})();

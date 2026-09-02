(() => {
  'use strict';

  // Movement virtual-joystick handlers, extracted out of game.js following
  // the same window.<Namespace> + init(deps) pattern as js/dye-system.js.
  // `input`/`joystickZone`/`joystickKnob` stay in game.js — they're const
  // objects only ever mutated in place, so a reference captured at init()
  // time never goes stale.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function handleJoystickPointerDown(event) {
    const { input, joystickZone } = deps;
    input.joystickPointerId = event.pointerId;
    // setPointerCapture can throw ("No active pointer with the given id
    // is found") if the browser doesn't consider this pointer fully
    // active yet — seen in practice on a touch that starts while the
    // page/layout is still settling right after load. Uncaught, that
    // exception used to abort this function before updateJoystick()
    // ran, permanently stranding joystickPointerId pointed at a pointer
    // that would never get a matching pointerup — every real touch
    // after that got silently ignored (input.joystickPointerId !==
    // event.pointerId in handleJoystickPointerMove/Up) until a full
    // page reload reset the state. Without capture the joystick still
    // works normally; the only loss is that a drag which leaves
    // joystickZone's own DOM bounds stops being tracked.
    try { joystickZone.setPointerCapture(event.pointerId); } catch (e) { /* see above — degrade gracefully, don't skip updateJoystick */ }
    updateJoystick(event);
  }

  function handleJoystickPointerMove(event) {
    if (deps.input.joystickPointerId !== event.pointerId) return;
    updateJoystick(event);
  }

  function handleJoystickPointerUp(event) {
    const { input, joystickKnob } = deps;
    if (input.joystickPointerId !== event.pointerId) return;
    input.joystickPointerId = null;
    input.x = 0;
    input.y = 0;
    joystickKnob.style.transform = 'translate(-50%,-50%) translate(0px, 0px)';
  }

  function updateJoystick(event) {
    const { input, joystickZone, joystickKnob, JOYSTICK_RADIUS, JOYSTICK_DEADZONE, JOYSTICK_RESPONSE } = deps;
    const rect = joystickZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const activeRadius = Math.max(32, Math.min(JOYSTICK_RADIUS, rect.width * 0.42)); // Used below to clamp knob travel for the current screen-sized joystick.
    const angle = Math.atan2(rawY, rawX);
    const clamped = Math.min(distance, activeRadius);
    const rawMagnitude = window.FormatUtils.clamp(clamped / activeRadius, 0, 1);
    const remapped = rawMagnitude <= JOYSTICK_DEADZONE
      ? 0
      : Math.pow((rawMagnitude - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE), JOYSTICK_RESPONSE);
    const knobX = Math.cos(angle) * clamped;
    const knobY = Math.sin(angle) * clamped;

    input.x = remapped > 0 ? Math.cos(angle) * remapped : 0;
    input.y = remapped > 0 ? Math.sin(angle) * remapped : 0;
    joystickKnob.style.transform = `translate(-50%,-50%) translate(${knobX}px, ${knobY}px)`;
  }

  window.VirtualJoystick = {
    init,
    handleJoystickPointerDown, handleJoystickPointerMove, handleJoystickPointerUp, updateJoystick,
  };
})();

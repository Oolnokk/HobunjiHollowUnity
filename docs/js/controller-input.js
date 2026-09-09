(() => {
  'use strict';

  const STANDARD_BUTTON_CODES = Object.freeze([
    'Button0', 'Button1', 'Button2', 'Button3', 'Button4', 'Button5',
    'LeftTrigger', 'RightTrigger',
    'Button8', 'Button9', 'Button10', 'Button11',
    'Button12', 'Button13', 'Button14', 'Button15',
    'RightStickLeft', 'RightStickRight', 'RightStickUp', 'RightStickDown',
  ]); // Used by controller input listening so Settings captures only codes the binding system can actually dispatch.

  function normalizeStick(rawX, rawY, deadzone = 0.24, responseExponent = 1) {
    const x = Number(rawX) || 0; // Used with y to preserve the stick's true radial direction after deadzone removal.
    const y = Number(rawY) || 0; // Used with x to preserve the stick's true radial direction after deadzone removal.
    const dz = Math.max(0, Math.min(0.95, Number(deadzone) || 0)); // Used to reject center drift without creating cross-shaped per-axis dead bands.
    const rawMagnitude = Math.min(1, Math.hypot(x, y)); // Used to remap the usable throw back across the complete 0..1 range.
    if (rawMagnitude <= dz || rawMagnitude <= 1e-6) return { x: 0, y: 0, magnitude: 0, rawMagnitude };
    const exponent = Math.max(0.1, Number(responseExponent) || 1); // Used to soften fine control near center while retaining full-speed outer throw.
    const magnitude = Math.pow((rawMagnitude - dz) / (1 - dz), exponent);
    const directionScale = magnitude / Math.hypot(x, y); // Used by both axes so diagonals keep their physical direction.
    return { x: x * directionScale, y: y * directionScale, magnitude, rawMagnitude };
  }

  function activityScore(gamepad) {
    if (!gamepad?.connected) return 0;
    const buttonScore = Array.from(gamepad.buttons || []).reduce((score, button) => Math.max(score, Number(button?.value) || (button?.pressed ? 1 : 0)), 0); // Used to let the controller the player actually touches take ownership.
    const axisScore = Array.from(gamepad.axes || []).reduce((score, axis) => Math.max(score, Math.abs(Number(axis) || 0)), 0); // Used alongside buttons when selecting among multiple connected pads.
    return Math.max(buttonScore, axisScore);
  }

  function pickActiveGamepad(gamepads, preferredIndex = null, takeoverThreshold = 0.35) {
    const connected = Array.from(gamepads || []).filter(gamepad => gamepad && gamepad.connected !== false);
    if (!connected.length) return null;
    const preferred = connected.find(gamepad => gamepad.index === preferredIndex) || null; // Used to prevent ownership flicker between idle connected pads.
    const contender = connected.reduce((best, gamepad) => activityScore(gamepad) > activityScore(best) ? gamepad : best, connected[0]); // Used to support hot switching when another pad receives deliberate input.
    if (!preferred || (contender !== preferred && activityScore(contender) >= takeoverThreshold && activityScore(preferred) < takeoverThreshold)) return contender;
    return preferred;
  }

  function buttonValue(gamepad, index) {
    const button = gamepad?.buttons?.[index]; // Used to normalize browsers that report only pressed or only analog value.
    return Math.max(Number(button?.value) || 0, button?.pressed ? 1 : 0);
  }

  function bindingValue(gamepad, binding) {
    if (!gamepad || !binding) return 0;
    const buttonMatch = /^Button(\d+)$/.exec(binding); // Used to translate the binding layer's symbolic ButtonN codes into the standard Gamepad API layout.
    if (buttonMatch) return buttonValue(gamepad, Number(buttonMatch[1]));
    if (binding === 'LeftTrigger') return buttonValue(gamepad, 6);
    if (binding === 'RightTrigger') return buttonValue(gamepad, 7);
    if (binding === 'RightStickLeft') return Math.max(0, -(Number(gamepad.axes?.[2]) || 0));
    if (binding === 'RightStickRight') return Math.max(0, Number(gamepad.axes?.[2]) || 0);
    if (binding === 'RightStickUp') return Math.max(0, -(Number(gamepad.axes?.[3]) || 0));
    if (binding === 'RightStickDown') return Math.max(0, Number(gamepad.axes?.[3]) || 0);
    return 0;
  }

  function isBindingPressed(gamepad, binding, options = {}) {
    const triggerThreshold = Number.isFinite(Number(options.triggerThreshold)) ? Number(options.triggerThreshold) : 0.28; // Used to preserve the existing responsive analog-trigger behavior in held controls such as music banks.
    const stickThreshold = Number.isFinite(Number(options.stickThreshold)) ? Number(options.stickThreshold) : 0.55; // Used for right-stick directional actions without affecting continuous look/scroll channels.
    const buttonThreshold = Number.isFinite(Number(options.buttonThreshold)) ? Number(options.buttonThreshold) : 0.55; // Used for ordinary digital controller actions and controller-listen capture.
    const threshold = binding === 'LeftTrigger' || binding === 'RightTrigger'
      ? triggerThreshold
      : String(binding || '').startsWith('RightStick') ? stickThreshold : buttonThreshold;
    return bindingValue(gamepad, binding) >= threshold;
  }

  function getPressedBindingCodes(gamepad, options = {}) {
    return STANDARD_BUTTON_CODES.filter(code => isBindingPressed(gamepad, code, options));
  }

  window.ControllerInput = {
    normalizeStick, activityScore, pickActiveGamepad, bindingValue, isBindingPressed, getPressedBindingCodes,
    supportedBindingCodes: STANDARD_BUTTON_CODES,
  };
})();

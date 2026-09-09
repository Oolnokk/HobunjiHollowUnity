(() => {
  'use strict';

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
    const connected = Array.from(gamepads || []).filter(gamepad => gamepad?.connected !== false);
    if (!connected.length) return null;
    const preferred = connected.find(gamepad => gamepad.index === preferredIndex) || null; // Used to prevent ownership flicker between idle connected pads.
    const contender = connected.reduce((best, gamepad) => activityScore(gamepad) > activityScore(best) ? gamepad : best, connected[0]); // Used to support hot switching when another pad receives deliberate input.
    if (!preferred || (contender !== preferred && activityScore(contender) >= takeoverThreshold && activityScore(preferred) < takeoverThreshold)) return contender;
    return preferred;
  }

  window.ControllerInput = { normalizeStick, activityScore, pickActiveGamepad };
})();

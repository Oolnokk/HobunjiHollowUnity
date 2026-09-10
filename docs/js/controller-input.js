// Single gamepad polling authority.
//
// Before this, every controller consumer ran its own requestAnimationFrame
// loop and called navigator.getGamepads() itself: gameplay dispatch in
// game.js, the menu navigator, the held-selector adapter, the Social Actions
// wheel and the music minigame — four session-lifetime loops, each allocating
// its own pad snapshot and each applying its own deadzone constant, with
// ownership arbitrated by monkey-patching ControllerUI.isActive.
//
// This module now owns one loop. It snapshots the pads once per frame,
// resolves the active pad once, computes every binding code's analog value
// once, derives press/release edges once, and hands the result to subscribers
// in a deterministic priority order. Ownership is an explicit registry here
// rather than a patched predicate somewhere else.
(() => {
  'use strict';

  const STANDARD_BUTTON_CODES = Object.freeze([
    'Button0', 'Button1', 'Button2', 'Button3', 'Button4', 'Button5',
    'LeftTrigger', 'RightTrigger',
    'Button8', 'Button9', 'Button10', 'Button11',
    'Button12', 'Button13', 'Button14', 'Button15',
    'RightStickLeft', 'RightStickRight', 'RightStickUp', 'RightStickDown',
  ]); // Used by controller input listening so Settings captures only codes the binding system can actually dispatch.

  // Shared thresholds. These were previously four separate per-module
  // constants (0.5 / 0.55 / 0.55 / 0.28) that drifted apart; a consumer that
  // genuinely needs a different one passes it explicitly.
  const DEFAULT_TRIGGER_THRESHOLD = 0.28; // Analog triggers stay responsive for held controls such as music banks.
  const DEFAULT_STICK_THRESHOLD = 0.55;   // Right-stick directional bindings, without affecting continuous look/scroll channels.
  const DEFAULT_BUTTON_THRESHOLD = 0.55;  // Ordinary digital actions and controller-listen capture.

  // Subscriber priorities. Lower runs first, so ownership claims land before
  // the consumers that read them. Previously this order was whatever the four
  // independent rAF registrations happened to produce.
  const PRIORITY = Object.freeze({
    menuNav: 10,      // Claims 'menu' while a controller-navigable panel is open.
    selection: 20,    // Claims 'selection:*' for held tool/item/utility/social openers.
    socialWheel: 30,
    music: 40,
  });

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

  // Indexed loops rather than Array.from(...).reduce(...): this runs for every
  // connected pad on every frame of the shared loop below.
  function activityScore(gamepad) {
    if (!gamepad?.connected) return 0;
    let score = 0;
    const buttons = gamepad.buttons || [];
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      const value = Number(button?.value) || (button?.pressed ? 1 : 0);
      if (value > score) score = value;
    }
    const axes = gamepad.axes || [];
    for (let i = 0; i < axes.length; i++) {
      const value = Math.abs(Number(axes[i]) || 0);
      if (value > score) score = value;
    }
    return score;
  }

  function pickActiveGamepad(gamepads, preferredIndex = null, takeoverThreshold = 0.35) {
    let preferred = null; // Prevents ownership flicker between idle connected pads.
    let contender = null; // Supports hot switching when another pad receives deliberate input.
    let contenderScore = -1;
    let preferredScore = 0;
    let any = null;
    const list = gamepads || [];
    for (let i = 0; i < list.length; i++) {
      const pad = list[i];
      if (!pad || pad.connected === false) continue;
      if (!any) any = pad;
      const score = activityScore(pad);
      if (pad.index === preferredIndex) { preferred = pad; preferredScore = score; }
      if (score > contenderScore) { contenderScore = score; contender = pad; }
    }
    if (!any) return null;
    if (!preferred) return contender || any;
    if (contender && contender !== preferred && contenderScore >= takeoverThreshold && preferredScore < takeoverThreshold) return contender;
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

  function thresholdFor(binding, options = {}) {
    if (binding === 'LeftTrigger' || binding === 'RightTrigger') {
      return Number.isFinite(Number(options.triggerThreshold)) ? Number(options.triggerThreshold) : DEFAULT_TRIGGER_THRESHOLD;
    }
    if (String(binding || '').startsWith('RightStick')) {
      return Number.isFinite(Number(options.stickThreshold)) ? Number(options.stickThreshold) : DEFAULT_STICK_THRESHOLD;
    }
    return Number.isFinite(Number(options.buttonThreshold)) ? Number(options.buttonThreshold) : DEFAULT_BUTTON_THRESHOLD;
  }

  function isBindingPressed(gamepad, binding, options = {}) {
    return bindingValue(gamepad, binding) >= thresholdFor(binding, options);
  }

  function getPressedBindingCodes(gamepad, options = {}) {
    return STANDARD_BUTTON_CODES.filter(code => isBindingPressed(gamepad, code, options));
  }

  // ── ownership ──────────────────────────────────────────────────────
  // Replaces the previous arrangement where the selection adapter wrapped
  // ControllerUI.isActive() so every OTHER module would believe a menu was
  // open. Owners are declared here, and gameplaySuspended() is the one
  // predicate gameplay dispatch consults.
  let owner = 'gameplay';
  function setOwner(nextOwner) {
    const value = String(nextOwner || 'gameplay');
    if (value === owner) return owner;
    owner = value;
    // Kept as the existing event name so game.js's listener needs no change.
    window.dispatchEvent(new CustomEvent('hobunji-controller-owner-change', { detail: { owner } }));
    return owner;
  }
  function gameplaySuspended() {
    return owner !== 'gameplay';
  }

  // ── the one polling loop ───────────────────────────────────────────
  const padScratch = []; // Reused every frame; the loop allocates nothing while idle.
  const values = new Map(); // code -> analog value for the active pad this frame.
  let downSet = new Set();
  let prevDownSet = new Set();
  const pressedSet = new Set();
  const releasedSet = new Set();

  const frame = {
    id: 0,
    now: 0,
    dt: 0,
    pad: null,
    pads: padScratch,
    padIndex: null,
    padChanged: false,
    focused: true,
    down: downSet,
    pressed: pressedSet,
    released: releasedSet,
    move: { x: 0, y: 0, magnitude: 0, rawMagnitude: 0 },
    look: { x: 0, y: 0, magnitude: 0, rawMagnitude: 0 },
    get owner() { return owner; },
    value(code) { return values.get(code) || 0; },
    isDown(code, options) { return (values.get(code) || 0) >= thresholdFor(code, options); },
  };

  const subscribers = []; // { name, priority, fn }
  function subscribe(name, fn, priority = 100) {
    if (typeof fn !== 'function') return () => {};
    const entry = { name: String(name || 'anonymous'), priority: Number(priority) || 100, fn };
    subscribers.push(entry);
    subscribers.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return () => {
      const at = subscribers.indexOf(entry);
      if (at >= 0) subscribers.splice(at, 1);
    };
  }

  let activePadIndex = null;
  let lastNow = 0;
  const errorCounts = new Map(); // Subscriber name -> thrown-error count, surfaced in getDebug().

  function collectPads() {
    padScratch.length = 0;
    const raw = navigator.getGamepads?.();
    for (let i = 0; i < (raw?.length || 0); i++) {
      const pad = raw[i];
      if (pad && pad.connected !== false) padScratch.push(pad);
    }
    return padScratch;
  }

  function pollFrame(now) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pollFrame);
    frame.id++;
    frame.now = now || performance.now();
    frame.dt = lastNow ? Math.min(0.05, Math.max(0, (frame.now - lastNow) / 1000)) : 1 / 60; // Caps resume spikes after a backgrounded tab.
    lastNow = frame.now;
    frame.focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

    const pads = collectPads();
    const pad = pads.length ? pickActiveGamepad(pads, activePadIndex) : null;
    frame.padChanged = (pad?.index ?? null) !== activePadIndex;
    activePadIndex = pad?.index ?? null;
    frame.pad = pad;
    frame.padIndex = activePadIndex;

    // Swap the down buffers, then recompute. Only the active pad's codes are
    // evaluated, and only when a pad is actually present.
    const previous = prevDownSet;
    prevDownSet = downSet;
    downSet = previous;
    downSet.clear();
    pressedSet.clear();
    releasedSet.clear();
    values.clear();
    if (pad) {
      for (let i = 0; i < STANDARD_BUTTON_CODES.length; i++) {
        const code = STANDARD_BUTTON_CODES[i];
        const value = bindingValue(pad, code);
        values.set(code, value);
        if (value >= thresholdFor(code)) downSet.add(code);
      }
      for (const code of downSet) if (!prevDownSet.has(code)) pressedSet.add(code);
      for (const code of prevDownSet) if (!downSet.has(code)) releasedSet.add(code);
      const deadzone = Number(window.SCRATCHBONES_CONFIG?.game?.input?.deadzone);
      const dz = Number.isFinite(deadzone) ? deadzone : 0.24;
      frame.move = normalizeStick(pad.axes?.[0], pad.axes?.[1], dz, 1);
      frame.look = normalizeStick(pad.axes?.[2], pad.axes?.[3], dz, 1);
    } else {
      for (const code of prevDownSet) releasedSet.add(code); // A disconnect releases everything exactly once.
      prevDownSet.clear();
      frame.move = { x: 0, y: 0, magnitude: 0, rawMagnitude: 0 };
      frame.look = { x: 0, y: 0, magnitude: 0, rawMagnitude: 0 };
    }
    frame.down = downSet;

    for (let i = 0; i < subscribers.length; i++) {
      const entry = subscribers[i];
      try {
        entry.fn(frame);
      } catch (error) {
        // One misbehaving consumer must not take down every other controller
        // consumer, which is exactly what sharing a loop would otherwise risk.
        errorCounts.set(entry.name, (errorCounts.get(entry.name) || 0) + 1);
        if (errorCounts.get(entry.name) === 1) {
          window.__farmLog?.(`[controller-input] subscriber "${entry.name}" threw: ${error?.message || error}`, 'input');
          console.warn('[controller-input] subscriber failed:', entry.name, error);
        }
      }
    }
  }

  function getDebug() {
    return {
      frameId: frame.id,
      owner,
      padIndex: frame.padIndex,
      padId: frame.pad?.id || null,
      padCount: padScratch.length,
      focused: frame.focused,
      down: [...downSet],
      subscribers: subscribers.map(entry => ({ name: entry.name, priority: entry.priority, errors: errorCounts.get(entry.name) || 0 })),
    };
  }

  window.ControllerInput = {
    normalizeStick, activityScore, pickActiveGamepad, bindingValue, isBindingPressed, getPressedBindingCodes,
    supportedBindingCodes: STANDARD_BUTTON_CODES,
    thresholdFor,
    // Frame authority.
    subscribe,
    PRIORITY,
    frame: () => frame,
    // Ownership.
    setOwner,
    gameplaySuspended,
    get owner() { return owner; },
    getDebug,
    pumpFrame: now => pollFrame(now), // Drives one frame manually; used by tests and headless verification.
    DEFAULT_TRIGGER_THRESHOLD,
    DEFAULT_STICK_THRESHOLD,
    DEFAULT_BUTTON_THRESHOLD,
  };

  // Guarded so the module can be evaluated outside a browser (regression tests
  // and the editor tool pages both do this) without needing a rAF shim just to
  // read its API surface. pumpFrame() lets such a context drive a frame by hand.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pollFrame);
})();

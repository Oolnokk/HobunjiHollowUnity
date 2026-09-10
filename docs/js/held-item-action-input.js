// Held-item action input — generic press/hold/cancel/arm/release state
// machine for drink-style held-item actions (eating, drinking, inserting a
// held ingredient into a processor). Mirrors combat-input.js's tap/hold
// disambiguation but for the single always-at-most-one held-item action
// slot instead of the weapon's two ability slots, and shares its exact
// hold-threshold timing (window.Combat.input.HOLD_THRESHOLD_S) so both
// systems read like the same input language to the player.
//
// This module owns no gameplay knowledge (no consumable rules, no
// processor recipes, no authored pose data) — callers hand it a small
// descriptor of callbacks and this module only decides which callback to
// invoke and when. The descriptor itself is responsible for driving
// whatever visual/animation it wants and for calling its own commit logic
// at the right moment (e.g. at the drink animation's strike frame).
(() => {
  'use strict';
  if (window.HeldItemActionInput) return;

  let deps = null;
  function init(injectedDeps) { deps = injectedDeps || {}; }

  function holdThresholdS() {
    return Number(window.Combat?.input?.HOLD_THRESHOLD_S) || 0.16;
  }

  function now() {
    return performance.now() / 1000;
  }

  // At most one held-item action can be in flight — there is only one held
  // item and one pair of hands.
  let active = null; // { key, descriptor, armed, downAt }

  function isActive() {
    return !!active;
  }

  // Call on press (pointerdown-equivalent) for the semantic held-item
  // action. `descriptor` must expose startVisual(); resumeVisual/
  // cancelVisual/abortVisual/onArm are all optional no-ops otherwise.
  function begin(key, descriptor) {
    if (active) return false;
    if (!descriptor || typeof descriptor.startVisual !== 'function') {
      console.error('[held-item-action-input] begin() requires a descriptor with startVisual()');
      return false;
    }
    active = { key, descriptor, armed: false, downAt: now() };
    descriptor.startVisual();
    return true;
  }

  // Ticked once per frame from the main loop. Handles both the tap/hold
  // threshold crossing and forced abort when the caller-provided
  // isBlocked() predicate goes true (menu opened, dialogue opened, paused,
  // controller ownership handed to a menu, ...).
  function update() {
    if (!active) return;
    if (deps?.isBlocked?.()) { abort(); return; }
    if (active.armed) return;
    if (now() - active.downAt >= holdThresholdS()) {
      active.armed = true;
      active.descriptor.onArm?.();
    }
  }

  // Call on release (pointerup-equivalent). Before the hold threshold,
  // this is a tap: cancel back to neutral, never committing. After the
  // threshold (armed), this lets the animation continue through to strike.
  function release() {
    if (!active) return;
    const { descriptor, armed } = active;
    active = null;
    if (armed) descriptor.resumeVisual?.();
    else descriptor.cancelVisual?.();
  }

  // Forced loss of input ownership (blur, tab hidden, menu opened mid-hold,
  // controller handed to a menu, ...). Must never commit, regardless of
  // whether the action was already armed.
  function abort() {
    if (!active) return;
    const { descriptor } = active;
    active = null;
    descriptor.abortVisual?.();
  }

  function getDebug() {
    if (!active) return { active: false };
    return {
      active: true,
      key: active.key,
      armed: active.armed,
      downForS: Math.max(0, now() - active.downAt),
      holdThresholdS: holdThresholdS(),
    };
  }

  window.HeldItemActionInput = { init, begin, release, abort, isActive, update, getDebug };

  // A lost release (alt-tab, notification pull-down) must not leave a
  // consumable half-consumed or an item silently inserted into a processor.
  window.addEventListener('blur', abort);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) abort();
  });
})();

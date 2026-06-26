// Combat core — shared windup→strike action pipeline for the weapon tool.
//
// game.js is one big closure-private IIFE, so this module can't reach into
// its internals directly. Instead game.js calls Combat.init(deps) once,
// near the end of its own setup, handing over live references (objects) and
// getter functions (for things that change, like the current area) that the
// rest of this file is built on. Everything below is namespaced on
// window.Combat so later combat-* modules (combo, quick attacks, holds,
// telegraph, loadout) can register into the same pipeline without any of
// them needing to know about game.js's internals either.
(() => {
  "use strict";

  let deps = null;

  // Player-facing weapon-hit resolution is keyed by tool-action id ('cut',
  // 'slash', and later whatever the loadout slots resolve to). Modules
  // register a resolver for an action id; resolveWeaponHit() below falls
  // back to game.js's own resolver when nothing is registered, so cut/slash
  // behave exactly as before until a later module actually claims them.
  const weaponHitResolvers = new Map();

  function registerWeaponAction(actionId, resolverFn) {
    weaponHitResolvers.set(actionId, resolverFn);
  }

  function unregisterWeaponAction(actionId) {
    weaponHitResolvers.delete(actionId);
  }

  // Called from game.js's applyAction() in place of calling its own
  // resolveWeaponHit() directly. fallbackFn is game.js's original resolver,
  // passed in per-call so this module never has to cache a stale reference.
  function resolveWeaponHit(actionId, fallbackFn) {
    const resolver = weaponHitResolvers.get(actionId);
    if (resolver) return resolver({ actionId, deps });
    return fallbackFn(actionId);
  }

  // ── Generic staged (windup → strike → recover) action engine ──────────
  //
  // Models the demo's activeActions list: anything with a windup before it
  // actually connects (combo steps, quick attacks, charged hold abilities)
  // can be driven through this instead of every module rolling its own
  // timer. Visual swing animation for the existing weapon tool keeps using
  // game.js's own toolSwingT system — this engine is for the *logic* timing
  // of abilities that don't already have an animation hook, plus anything
  // that needs to layer cooldowns/durations on top of a strike.
  const activeStaged = new Set();

  // opts: { windupS, strikeS, recoverS, onStrike(action), onComplete(action), onCancel(action), data }
  // Returns the staged action object; call .cancel() to abort early.
  function beginStagedAction(opts) {
    const action = {
      windupS: Math.max(0, opts.windupS || 0),
      strikeS: Math.max(0, opts.strikeS || 0),
      recoverS: Math.max(0, opts.recoverS || 0),
      onStrike: opts.onStrike || null,
      onComplete: opts.onComplete || null,
      onCancel: opts.onCancel || null,
      data: opts.data || null,
      t: 0,
      phase: 'windup',
      strikeFired: false,
      cancelled: false,
    };
    action.totalS = action.windupS + action.strikeS + action.recoverS;
    action.cancel = () => {
      if (action.cancelled || action.phase === 'done') return;
      action.cancelled = true;
      action.phase = 'done';
      activeStaged.delete(action);
      if (action.onCancel) action.onCancel(action);
    };
    activeStaged.add(action);
    if (action.totalS <= 0) {
      // Zero-duration action: resolve immediately, same frame.
      fireStagedStrike(action);
      finishStagedAction(action);
    }
    return action;
  }

  function fireStagedStrike(action) {
    if (action.strikeFired) return;
    action.strikeFired = true;
    if (action.onStrike) action.onStrike(action);
  }

  function finishStagedAction(action) {
    if (action.phase === 'done') return;
    action.phase = 'done';
    activeStaged.delete(action);
    if (action.onComplete) action.onComplete(action);
  }

  function updateStagedAction(action, dt) {
    if (action.cancelled || action.phase === 'done') return;
    action.t += dt;
    const strikeAt = action.windupS;
    const recoverAt = action.windupS + action.strikeS;
    if (!action.strikeFired && action.t >= strikeAt) fireStagedStrike(action);
    if (action.t >= action.totalS) finishStagedAction(action);
  }

  function update(dt) {
    // Snapshot first — onStrike/onComplete callbacks may call cancel() or
    // start new staged actions, and Set iteration must stay stable while
    // that happens.
    for (const action of Array.from(activeStaged)) updateStagedAction(action, dt);
  }

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  window.Combat = {
    init,
    registerWeaponAction,
    unregisterWeaponAction,
    resolveWeaponHit,
    beginStagedAction,
    update,
    get deps() { return deps; },
  };
})();

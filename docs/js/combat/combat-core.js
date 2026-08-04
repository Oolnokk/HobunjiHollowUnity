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
    // Every staged action in this pipeline is a player weapon-tool attack
    // (combo/quick attacks/charged breaker/flurry/counter-shield riposte),
    // so this single choke point covers "every weapon strike" without each
    // ability module needing its own SFX call — future abilities registered
    // through beginStagedAction get the slash sound for free.
    deps?.playWeaponSlashSfx?.();
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

  // Called from game.js's damagePlayer() so every attack that lands on the
  // player staggers THEM — interrupts whatever combo/quick-attack/charged-
  // breaker strike the PLAYER was mid-windup on, the same way a landed
  // player hit cancels a creature's own telegraphed attack (see combat-
  // enemy-telegraph.js's cancel(), called alongside this from
  // damageCreature()). Skips any action tagged data.isBandit -- game.js's
  // parallel bandit AI (updateBanditCombatAI) reuses this SAME shared
  // beginStagedAction pipeline for its own combo/quick-attack/charged-
  // breaker/riposte swings (see the long comment above it for why), so
  // without this filter, every bandit attack that actually LANDS a hit
  // cancels itself: damagePlayer runs synchronously from inside that same
  // action's own onStrike callback, and at that point the action is still
  // in this registry (it hasn't reached onComplete yet) -- self-cancelling
  // mid-strike, every time, on every bandit that connects, and (in a
  // multi-bandit fight) every OTHER bandit's in-flight swing too. A
  // cancelled action's onCancel path never runs the bookkeeping onComplete
  // does (attackCooldownT, and on a combo's final step, retreatT/resetting
  // its combo index) -- landing bandits were skipping their own attack
  // cooldown entirely and never retreating after their 3-hit combo.
  function cancelAllStaged() {
    for (const action of Array.from(activeStaged)) {
      if (action.data?.isBandit) continue;
      action.cancel();
    }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  // ── Stagger lockout (Footing/impact system) ────────────────────────────
  //
  // A landed hit already cancels whatever the victim was mid-windup on (see
  // cancelAllStaged() above); this adds a real duration on top of that
  // cancellation during which the victim can't START a new staged action —
  // today's cancel-and-immediately-act-again gap is what this closes. Set by
  // game.js's damagePlayer/damageCreature (see docs/js/combat/resource-
  // system.js's spendFooting for the Footing-loss half of the same call),
  // read by the one-line guard each combat-*.js ability module adds at its
  // own beginStagedAction call site.
  function isStaggered(entity) {
    // Prone (0 Footing — see resource-system.js/game.js's enterProneIfFooting
    // Depleted) is an indefinite lockout with no fixed endsAt: it lasts until
    // Footing regenerates and the player somersaults back up (game.js's
    // performDodge), so it's checked directly here instead of needing a
    // synthetic multi-second beginStagger duration to fake "indefinite."
    if (entity?.prone) return true;
    return !!(entity?.staggered?.active && performance.now() < entity.staggered.endsAt);
  }

  function beginStagger(entity, direction, durationS) {
    if (!entity || !(durationS > 0)) return;
    entity.staggered = { active: true, direction, endsAt: performance.now() + durationS * 1000 };
  }

  // ── Single-slot hooks for held defensive/movement abilities ───────────
  //
  // Only one hold1/hold2 ability can be actively held at a time, so a
  // settable single slot (rather than a registry) is enough. Counter
  // Shield uses the damage interceptor to turn an incoming hit into a
  // block + riposte; Blink Dodge uses the speed multiplier to slow normal
  // walking while it's converting movement into zips.
  let playerDamageInterceptor = null;
  let movementSpeedMul = null;

  function setPlayerDamageInterceptor(fn) { playerDamageInterceptor = fn; }

  // Called from game.js's damagePlayer() before it applies damage normally.
  // Returns true if the hit was fully handled (blocked/absorbed) and
  // game.js should skip its own damage application.
  function tryInterceptPlayerDamage(amount, fromX, fromY) {
    return !!(playerDamageInterceptor && playerDamageInterceptor(amount, fromX, fromY));
  }

  function setMovementSpeedMul(fn) { movementSpeedMul = fn; }

  function getMovementSpeedMul() {
    return movementSpeedMul ? movementSpeedMul() : 1;
  }

  window.Combat = {
    init,
    registerWeaponAction,
    unregisterWeaponAction,
    resolveWeaponHit,
    beginStagedAction,
    cancelAllStaged,
    isStaggered,
    beginStagger,
    update,
    setPlayerDamageInterceptor,
    tryInterceptPlayerDamage,
    setMovementSpeedMul,
    getMovementSpeedMul,
    get deps() { return deps; },
  };
})();

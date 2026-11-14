// Central gameplay input arbitration. Device adapters supply semantic action IDs;
// the winning owner is frozen until release/cancel, even if context changes.
(() => {
  'use strict';
  if (window.GameplayInputRouter) return;

  const CONTEXT_ACTIONS = new Set(['action1', 'action2']); // Only these contextual overrides suppress attacks; action3+ and other inputs do not.
  const HELD_WORLD_ACTIONS = new Set(['nest_take', 'bandit_tent_interact', 'corpse_hold_loot']); // World loot/harvest holds disabled during combat, unlike combat abilities and held-item tools.
  const active = new Map(); // Physical source + semantic input -> winning owner for the entire press/release cycle.
  const providers = new Map(); // Optional priority-sorted noncombat input handlers; new systems can register without adding branches to game.js.
  const worldClaimPressCounts = new Map(); // The legacy world-claim registry is action-keyed; only the last physical source releases its press.
  let host = {}; // Game-specific context/action executors supplied once by game.js.
  let lastDecision = null; // Mobile-readable diagnostics for arbitration and suppressed inputs.

  function init(deps = {}) { host = deps; }
  function isInCombat() { return !!host.isInCombat?.(); }
  function isHeldWorldAction(action) { return HELD_WORLD_ACTIONS.has(String(action || '')); }
  function holdBlocked(action) { return isHeldWorldAction(action) && isInCombat(); }
  function keyFor(actionId, source) { return String(source || 'gameplay') + ':' + String(actionId); }
  function contextFor(actionId) {
    if (!CONTEXT_ACTIONS.has(actionId)) return null;
    const override = host.getContextualOverride?.(actionId) || null; // Live arch override is more authoritative than a stale input label.
    return override && !holdBlocked(override.button?.action || override.action) ? override : null;
  }
  function record(actionId, phase, source, owner) {
    lastDecision = { actionId, phase, source, owner, combat: isInCombat() }; // Diagnostic snapshot, only updated on real input events.
  }
  function register(ownerId, spec) {
    if (!ownerId || typeof spec?.resolve !== 'function') return () => {};
    const id = String(ownerId); // Stable owner id lets feature modules replace their own handler without accumulating duplicates.
    providers.set(id, { priority: Number(spec.priority) || 0, resolve: spec.resolve });
    return () => { if (providers.get(id)?.resolve === spec.resolve) providers.delete(id); };
  }
  function providerFor(actionId, source) {
    let winner = null; // Highest-priority matching provider for this semantic input.
    for (const [ownerId, entry] of providers) {
      const match = entry.resolve(actionId, { source, inCombat: isInCombat() });
      if (!match || (match.action && holdBlocked(match.action))) continue;
      if (!winner || entry.priority > winner.priority) winner = { ...match, kind: 'provider', ownerId, priority: entry.priority };
    }
    return winner;
  }
  function finish(actionId, phase, source, owned) {
    if (owned.kind === 'world-claim') {
      const remaining = (worldClaimPressCounts.get(actionId) || 1) - 1; // Keep the shared legacy hold alive while another physical device owns it.
      if (remaining > 0) worldClaimPressCounts.set(actionId, remaining);
      else {
        worldClaimPressCounts.delete(actionId);
        window.WorldActionInputClaims?.dispatch?.(actionId, phase, { source });
      }
    }
    else {
      const handler = phase === 'cancel' ? (owned.onCancel || owned.onRelease) : owned.onRelease;
      try { handler?.({ actionId, source, canceled: phase === 'cancel' }); }
      catch (error) { console.warn('[GameplayInputRouter] input release failed', owned.ownerId || owned.kind, error); }
    }
    if (owned.kind === 'context' && actionId === 'action1') host.onContextRelease?.(actionId);
    record(actionId, phase, source, owned.kind);
    return owned.kind !== 'gameplay'; // Gameplay's own combat/hold release must still receive an originally unclaimed press.
  }
  function route(actionId, phase = 'press', source = 'gameplay') {
    actionId = String(actionId || '');
    if (!actionId) return false;
    const key = keyFor(actionId, source);
    const owned = active.get(key);
    if (phase === 'release' || phase === 'cancel') {
      if (owned) { active.delete(key); return finish(actionId, phase, source, owned); }
      // Legacy press owners may have used WorldActionInputClaims directly before this module initialized.
      if (worldClaimPressCounts.has(actionId)) return false; // A stray release may not end another physical source's hold.
      const consumed = !!window.WorldActionInputClaims?.dispatch?.(actionId, phase, { source });
      if (consumed) record(actionId, phase, source, 'world-claim');
      return consumed;
    }
    if (owned) return owned.kind !== 'gameplay'; // Never dispatch auto-repeat as a second input.
    const world = window.WorldActionInputClaims?.claimFor?.(actionId);
    if (world && !holdBlocked(world.action)) {
      const count = worldClaimPressCounts.get(actionId) || 0; // One legacy world press is shared by all simultaneous physical-source owners.
      if (!count && window.WorldActionInputClaims.dispatch(actionId, 'press', { source }) !== true) return false;
      worldClaimPressCounts.set(actionId, count + 1);
      active.set(key, { kind: 'world-claim', ownerId: world.ownerId });
      if (CONTEXT_ACTIONS.has(actionId)) window.Combat?.input?.abortAllPresses?.();
      record(actionId, phase, source, 'world-claim');
      return true;
    }
    const provided = providerFor(actionId, source);
    if (provided) {
      active.set(key, provided);
      try { provided.onPress?.({ actionId, source }); }
      catch (error) { console.warn('[GameplayInputRouter] input press failed', provided.ownerId, error); }
      if (CONTEXT_ACTIONS.has(actionId)) window.Combat?.input?.abortAllPresses?.(); // A provider owning Action 1/2 is always noncombat for this press.
      record(actionId, phase, source, provided.ownerId);
      return true;
    }
    const context = contextFor(actionId);
    if (context) {
      active.set(key, { kind: 'context', action: context.button?.action || context.action });
      window.Combat?.input?.abortAllPresses?.();
      host.executeContextualOverride?.(actionId, context);
      record(actionId, phase, source, 'context');
      return true;
    }
    // Unclaimed gameplay presses are handled by their native adapter. Do not retain them here:
    // touch arch/buttons and some legacy mouse paths only call this router on contextual releases.
    record(actionId, phase, source, 'gameplay');
    return false;
  }
  function owns(actionId, source = 'gameplay') {
    const owner = active.get(keyFor(actionId, source)); // Only noncombat ownership needs an early release when a menu or minigame intercepts normal gameplay dispatch.
    return !!owner && owner.kind !== 'gameplay';
  }
  function blocksAttacks() {
    for (const [key, owned] of active) {
      const actionId = key.slice(key.lastIndexOf(':') + 1);
      if (CONTEXT_ACTIONS.has(actionId) && owned.kind !== 'gameplay') return true; // No contextual Action 1/2 provider may opt out of attack suppression.
    }
    for (const id of CONTEXT_ACTIONS) {
      const claim = window.WorldActionInputClaims?.claimFor?.(id);
      if (claim && !holdBlocked(claim.action)) return true;
      if (host.hasVisibleContextOverride ? host.hasVisibleContextOverride(id) : contextFor(id)) return true; // Live HUD state avoids rebuilding the entire world action list on every held-combat frame.
    }
    return false;
  }
  function cancelAll() {
    for (const key of [...active.keys()]) {
      const separator = key.lastIndexOf(':');
      route(key.slice(separator + 1), 'cancel', key.slice(0, separator));
    }
  }
  window.addEventListener?.('blur', cancelAll);
  window.GameplayInputRouter = Object.freeze({
    init, register, route, owns, blocksAttacks, holdBlocked, isHeldWorldAction, cancelAll,
    snapshot: () => ({ lastDecision, inCombat: isInCombat(), active: [...active.entries()].map(([key, owner]) => ({ key, owner: owner.ownerId || owner.kind, action: owner.action || null })), worldClaimPressCounts: [...worldClaimPressCounts.entries()], registered: [...providers.keys()] }),
  });
})();
